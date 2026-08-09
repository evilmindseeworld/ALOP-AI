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
async function runCouncil(members, messages, whipMs, quorum, tokenLimit, deps = {}) {
  const { callModel, onSeat } = deps;
  if (typeof callModel !== "function") throw new Error("runCouncil needs callModel");

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

  return new Promise((resolve) => {
    const finish = () => {
      resolved = true;
      clearTimeout(whipTimer);
      resolve(results);
    };

    const whipTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(results);
      }
    }, whipMs);

    const checkDone = () => {
      if (resolved) return;
      if (validCount >= quorum) return finish();
      if (settledCount >= members.length) return finish();
    };

    for (const { model, temperature } of members) {
      report(model, SEAT_STATES.THINKING);
      callModel(model, messages, temperature, whipMs, tokenLimit)
        .then((content) => {
          settledCount++;
          const trimmed = (content || "").trim();
          // A bare "skip" is the model declining, and the regex is anchored so
          // an answer that merely BEGINS with the word is not mistaken for one.
          const isSkip = /^skip[.!]?$/i.test(trimmed);
          if (isSkip) {
            report(model, SEAT_STATES.SKIPPED);
          } else if (trimmed.length > 3) {
            validCount++;
            results.push({ model, content });
            report(model, SEAT_STATES.ANSWERED);
          } else {
            // Too short to be an answer and not a skip: an empty completion.
            // Reported as failed rather than skipped, because the model did not
            // choose it.
            report(model, SEAT_STATES.FAILED);
          }
          checkDone();
        })
        .catch(() => {
          settledCount++;
          report(model, SEAT_STATES.FAILED);
          checkDone();
        });
    }

    // Zero members would otherwise hang until the whip fires. Not reachable
    // through the current selection logic, and cheap to make impossible.
    if (members.length === 0) finish();
  });
}

module.exports = { runCouncil, SEAT_STATES };
