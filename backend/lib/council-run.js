/**
 * The council, running, and reporting who is speaking while it happens.
 *
 * WHAT THIS EXTRACTED, AND THE REASON IT MOVED. `runCouncilWithWhip` lived
 * inline in server.js, which cannot be `require`d in a test — it calls
 * process.exit(1) at import time on a missing env var. So the single most
 * intricate piece of concurrency in this product, the one that decides how long
 * a user waits and how many opinions their answer is built from, had no test at
 * all. It has one now.
 *
 * WHAT IS NEW: `onSeat`. The runner always knew exactly when each seat started,
 * when it settled, whether it answered, skipped or failed, and whether the
 * quorum released the whole thing early. Every bit of that was thrown away into
 * console.log. Meanwhile the client, whose entire reason for choosing this
 * product is that seven models deliberate rather than one, saw "Researching..."
 * and then an answer.
 *
 * That is the gap this closes. The lifecycle is reported as it happens, the
 * route streams it, and the interface draws the council actually deliberating.
 * No new model calls, no extra latency: it is the information the loop already
 * had, no longer discarded.
 *
 * ---
 *
 * THE WHIP, unchanged and worth restating because it is the subtle part.
 *
 * Seats run in parallel and the runner resolves on the FIRST of three things:
 * enough valid answers to make quorum, every seat settled, or the whip timer.
 * It deliberately does not wait for the slowest model. A council of seven where
 * one provider is having a bad afternoon should answer in the time the other
 * six took, and quorum is what makes that safe rather than arbitrary.
 *
 * A seat that returns "skip" is not a failure and not an answer. It is a model
 * declining to add anything, which is a legitimate and useful outcome: it keeps
 * a redundant seventh opinion out of the synthesis. It counts as settled and
 * not as valid.
 */

/** Every state a seat can be in, and the whole vocabulary the client renders. */
const { childAbortController } = require("./abort");

const SEAT_STATES = Object.freeze({
  THINKING: "thinking",
  ANSWERED: "answered",
  SKIPPED: "skipped",
  FAILED: "failed",
});

/**
 * Run the council.
 *
 * @param {Array<{model: string, temperature: number}>} members
 * @param {Array} messages
 * @param {number} whipMs        how long the slowest seat may hold the room
 * @param {number} quorum        valid answers that release it early
 * @param {number} tokenLimit
 * @param {object} deps
 * @param {Function} deps.callModel
 * @param {(event: {model: string, state: string}) => void} [deps.onSeat]
 *   Called at least twice per seat: once on start, once on settle. Must never
 *   throw — see the wrapper below for why that is enforced here rather than
 *   trusted.
 * @returns {Promise<Array<{model: string, content: string}>>}
 */
/**
 * Is this reply an ANSWER, or a seat declining?
 *
 * Exported because three places needed the same judgement and only this one
 * had it: the council's own quorum count, the agent loop's quorum release, and
 * the route that filters what reaches the synthesiser. The agent loop counted
 * any non-empty string, so a bare "skip" could make quorum and release the room
 * without a single usable answer in it.
 *
 * The skip regex is ANCHORED so an answer that merely begins with the word is
 * not mistaken for a decline, and anything at three characters or under is an
 * empty completion rather than a reply.
 */
const isUsableAnswer = (content) => {
  const trimmed = (content || "").trim();
  return trimmed.length > 3 && !/^skip[.!]?$/i.test(trimmed);
};

async function runCouncil(members, messages, whipMs, quorum, tokenLimit, deps = {}) {
  const { callModel, onSeat, onSeatTiming, onFinish, signal, now = Date.now } = deps;
  if (typeof callModel !== "function") throw new Error("runCouncil needs callModel");

  const child = childAbortController(signal);
  const councilSignal = child.signal;

  /**
   * A reporter that cannot take the council down with it.
   *
   * `onSeat` writes to an HTTP response in production. A client that
   * disconnects mid-turn, a serialisation error, anything at all in there must
   * not reject a promise inside the seat loop and lose an answer the user
   * already paid a model call for. Reporting is strictly best-effort and the
   * council is not.
   */
  const report = (model, state) => {
    if (!onSeat) return;
    try {
      onSeat({ model, state });
    } catch {
      /* the room keeps talking whether or not anyone is listening */
    }
  };

  const results = [];
  let settledCount = 0;
  let validCount = 0;
  let resolved = false;
  const seatRecords = [];

  return new Promise((resolve) => {
    let whipTimer = null;
    const onParentAbort = () => finish("aborted");
    const reportTiming = (record) => {
      try {
        onSeatTiming?.(record);
      } catch {
        /* telemetry is best effort, like the progress reporter */
      }
    };
    const finish = (reason = "all_settled") => {
      if (resolved) return;
      resolved = true;
      if (whipTimer) clearTimeout(whipTimer);
      if (signal) signal.removeEventListener("abort", onParentAbort);
      child.controller.abort(reason);
      for (const record of seatRecords) {
        if (record.timingDone) continue;
        record.timingDone = true;
        reportTiming({ model: record.model, round: 1, durationMs: now() - record.startedAt, outcome: reason === "quorum" ? "quorum" : reason === "aborted" ? "aborted" : "timed_out" });
      }
      try {
        onFinish?.({ reason, durationMs: seatRecords.length ? Math.max(...seatRecords.map((r) => now() - r.startedAt)) : 0 });
      } catch {
        /* the release and the answer do not depend on telemetry */
      }
      child.dispose();
      resolve(results);
    };

    whipTimer = setTimeout(() => finish("whip"), whipMs);

    const checkDone = () => {
      if (resolved) return;
      if (validCount >= quorum) return finish("quorum");
      if (settledCount >= members.length) return finish("all_settled");
    };

    if (signal) signal.addEventListener("abort", onParentAbort, { once: true });
    if (signal?.aborted) return finish("aborted");

    for (const { model, temperature, effort } of members) {
      const record = { model, startedAt: now(), timingDone: false };
      seatRecords.push(record);
      report(model, SEAT_STATES.THINKING);
      Promise.resolve()
        /* `effort` IS A PER-SEAT PROPERTY, not a council-wide one, and this is
         * the only place it can be applied. Every seat on the free roster
         * ignores it — reasoning effort is not among their supported
         * parameters — but the native tool seat is on this path too whenever a
         * complex question does NOT need tools, and it was added to the council
         * precisely because it thinks harder. Without this it would sit here at
         * the provider's default effort: the expensive seat, bought and not
         * used. `exclude` keeps the reasoning out of the draft, exactly as the
         * default request already does. */
        .then(() => callModel(
          model,
          messages,
          temperature,
          whipMs,
          tokenLimit,
          councilSignal,
          effort ? { reasoning: { effort, exclude: true } } : undefined,
        ))
        .then((content) => {
          if (resolved) return;
          settledCount++;
          const trimmed = (content || "").trim();
          // A bare "skip" is the model declining, and the regex is anchored so
          // an answer that merely BEGINS with the word is not mistaken for one.
          const isSkip = /^skip[.!]?$/i.test(trimmed);
          if (isSkip) {
            report(model, SEAT_STATES.SKIPPED);
          } else if (isUsableAnswer(trimmed)) {
            validCount++;
            results.push({ model, content });
            report(model, SEAT_STATES.ANSWERED);
          } else {
            // Too short to be an answer and not a skip: an empty completion.
            // Reported as failed rather than skipped, because the model did not
            // choose it.
            report(model, SEAT_STATES.FAILED);
          }
          if (!record.timingDone) {
            record.timingDone = true;
            reportTiming({ model, round: 1, durationMs: now() - record.startedAt, outcome: isSkip ? "skipped" : isUsableAnswer(trimmed) ? "answered" : "empty" });
          }
          checkDone();
        })
        .catch(() => {
          if (resolved) return;
          settledCount++;
          report(model, SEAT_STATES.FAILED);
          if (!record.timingDone) {
            record.timingDone = true;
            reportTiming({ model, round: 1, durationMs: now() - record.startedAt, outcome: councilSignal.aborted ? "aborted" : "failed" });
          }
          checkDone();
        });
    }

    // Zero members would otherwise hang until the whip fires. Not reachable
    // through the current selection logic, and cheap to make impossible.
    if (members.length === 0) finish();
  });
}

module.exports = { runCouncil, SEAT_STATES, isUsableAnswer };
