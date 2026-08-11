/**
 * propose → dedupe → broadcast, until every member is done or a ceiling stops it.
 *
 * Each round every member either emits tool requests or a final answer. The
 * loop unions the requests, executes each UNIQUE call exactly once, and gives
 * every result to every member. Cost is O(unique calls), not O(members × calls)
 * — with seven members asking overlapping questions, which is what a council
 * does, the dedupe is most of the saving.
 *
 * CEILINGS ARE THE POINT, not a safety net bolted on afterwards. A model that
 * can call tools can call them forever, and this loop is inside an HTTP request
 * that a user is waiting on, holding a streaming connection open:
 *
 *     maxRounds        4     search → read → refine, and a round to answer in
 *     maxUniqueCalls   12    per turn, across all rounds
 *     perCallMs        8000
 *     totalToolMs      25000 time spent INSIDE tools, all rounds together
 *     roundMs          18000 how long one round may wait on its members
 *     quorum           0     answers that release the LAST round early (off)
 *     totalWallMs      75000 hard stop on the whole loop, model time included
 *
 * On hitting any of them the loop stops, hands back what it has, and SAYS SO in
 * `truncated`. A truncated answer presented as a complete one is worse than a
 * slow one — the caller must be able to tell the synthesiser that the research
 * was cut short, so the answer can hedge instead of asserting.
 *
 * WHY THERE ARE TWO CLOCKS, and it is the fix for the commonest complaint this
 * feature had: "I couldn't research deeply enough before running out of time"
 * on questions where barely a tool had run. `totalToolMs` used to be measured
 * from the top of the loop, so it counted MODEL latency as tool spend. The
 * members are asked with the council's whip (30s), and a single round of seven
 * seats deliberating can take twenty of those seconds on its own — so the 25s
 * "tool budget" was routinely exhausted before the first search returned, and
 * the loop truncated blaming a budget it had never spent. It now accrues only
 * the wall time inside `registry.execute`, which is what the name always said,
 * and a separate `totalWallMs` is what stops the whole thing running forever.
 * The user gets the full 25 seconds of actual research they were promised.
 *
 * AND WHY A ROUND HAS A WHIP. `Promise.all` over the members made every round
 * exactly as slow as its slowest seat — the problem runCouncilWithWhip exists
 * to solve for the plain council, unsolved here. A member that has not replied
 * by `roundMs` is dropped exactly as an erroring one is: a council of seven
 * does not need all seven, and the seat that is having a bad minute must not
 * spend the research budget of the six that are not.
 *
 * AND WHY THE LAST ROUND HAS A QUORUM. Capping a round at 18s still means
 * paying 18s for one bad seat, and on the last round every member is answering
 * — the user is waiting on all seven to hear from any of them. `quorum`
 * releases that round as soon as enough answers are in hand, exactly as
 * runCouncilWithWhip has always released the plain council. It is deliberately
 * inert on research rounds: releasing there would drop the members that had
 * asked for a tool, which is not a latency saving, it is turning the feature
 * off when the council wanted it most.
 *
 * Nothing here touches the network. `askMember` and `registry` are injected, so
 * the whole loop is tested against fakes.
 */

const { parseToolRequests } = require("./tool-protocol");
const { dedupeCalls } = require("./tool-dedupe");
const { settleByDeadline } = require("./deadline");

const DEFAULTS = {
  maxRounds: 4,
  maxUniqueCalls: 12,
  perCallMs: 8000,
  totalToolMs: 25000,
  roundMs: 18000,
  totalWallMs: 75000,
  /* 0 = wait for every member. server.js passes the council's own quorum. */
  quorum: 0,
};

/** Tool results, rendered for the next round's prompt. */
const renderResults = (executed) =>
  executed
    .map(({ call, result }) => {
      const args = Object.entries(call.args)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ");
      const head = `[${call.name} ${args}] ${result.ok ? "OK" : "FAILED"} — ${result.summary}`;
      return result.content ? `${head}\n${result.content}` : head;
    })
    .join("\n\n---\n\n");

/**
 * @param {object} opts
 * @param {string[]} opts.members              model names
 * @param {(member, context) => Promise<any>} opts.askMember
 *        context = { round, toolResults, isFinalRound }. `isFinalRound` is
 *        passed so the prompt can tell a member to stop asking and answer —
 *        without it, a member spends the last round requesting a tool that will
 *        never run and contributes nothing at all.
 * @param {{execute: Function, list: Function}} opts.registry
 * @param {(event) => void} [opts.onEvent]     tool_start / tool_result, for SSE
 * @param {() => number} [opts.now]            injectable clock, so budget tests
 *                                             do not have to actually wait 25s
 */
async function runAgentLoop({ members, askMember, registry, onEvent = () => {}, now = Date.now, ...limits } = {}) {
  const cfg = { ...DEFAULTS, ...limits };
  const startedAt = now();

  const answers = new Map(); // member -> final text
  const transcript = []; // every executed call, for the synthesiser and the log
  let round = 0;
  let uniqueCallsUsed = 0;
  let truncated = null;

  // Only the time actually spent inside registry.execute. See the note at the
  // top: measuring this from the top of the loop counted the council's own
  // deliberation as research spend, and truncated turns that had not searched.
  let toolMsUsed = 0;
  const budgetLeft = () => cfg.totalToolMs - toolMsUsed;
  const wallLeft = () => cfg.totalWallMs - (now() - startedAt);
  let active = [...(members || [])];

  while (active.length > 0 && round < cfg.maxRounds) {
    round++;
    const isFinalRound = round === cfg.maxRounds;

    // Counted before the round so quorum is CUMULATIVE: a member that answered
    // in round one is an answer in hand, and requiring the quorum to be met
    // again from scratch in the last round would wait on members whose
    // contribution the loop already has.
    const priorAnswers = answers.size;

    // Every still-active member is asked concurrently. A member that throws is
    // dropped from the round rather than failing the turn: a council of seven
    // does not need all seven, and one gateway hiccup must not lose the answer.
    // A member that is merely SLOW is dropped the same way, at the round whip —
    // `settleByDeadline` never rejects and ignores stragglers rather than
    // cancelling them, so a late reply cannot become an unhandled rejection.
    const { results: replies } = await settleByDeadline(
      active.map((member) => ({
        fallback: { member, calls: [], text: "", isFinal: false, timedOut: true },
        promise: (async () => {
          try {
            const raw = await askMember(member, { round, toolResults: transcript, isFinalRound });
            return { member, ...parseToolRequests(raw) };
          } catch (err) {
            return { member, calls: [], text: "", isFinal: true, error: err.message };
          }
        })(),
      })),
      {
        // Never longer than what is left of the whole loop: a round that
        // outlives its own hard stop is the hang the hard stop exists to
        // prevent.
        deadlineMs: Math.max(250, Math.min(cfg.roundMs, wallLeft())),
        /* QUORUM RELEASE, the council's own trade applied to the round.
         *
         * A round costs the SLOWEST member even after the whip caps it, and the
         * round that matters is the last one — every member is answering, and
         * the user is waiting on all seven to hear from any of them.
         * `runCouncilWithWhip` has always released the plain council the moment
         * `quorum` valid answers landed; this is the same release, in the path
         * that replaced it when tools are on, where it was simply missing.
         *
         * ONLY ON THE LAST ROUND, and that restriction is the whole safety of
         * it. In a research round a quorum of quick answers would release the
         * members that had asked for a tool, and the turn would silently stop
         * using tools precisely when some of the council thought it needed
         * them. Speed is worth a seat's answer; it is not worth the feature. */
        enough:
          isFinalRound && cfg.quorum > 0
            ? (r) => priorAnswers + r.filter((x) => x && x.isFinal && x.text).length >= cfg.quorum
            : undefined,
      },
    );

    for (const reply of replies) {
      if (reply.isFinal && reply.text) answers.set(reply.member, reply.text);
    }

    const lateCount = replies.filter((r) => r.timedOut).length;
    // A member left outstanding by a QUORUM RELEASE was not slow — the room was
    // released without it, which is what quorum means and is not a truncation.
    // Reporting it as one would have the synthesiser hedge an answer that was
    // never short of anything.
    const releasedAtQuorum = isFinalRound && cfg.quorum > 0 && answers.size >= cfg.quorum;
    if (lateCount > 0 && !releasedAtQuorum) {
      truncated = truncated || `${lateCount} member(s) did not reply within the ${cfg.roundMs}ms round.`;
    }

    // A member that gave a final answer is done. One that errored, or missed
    // the whip, is dropped — it has nothing to contribute and asking it again
    // next round would just spend the budget on the same failure.
    const stillAsking = replies.filter((r) => !r.isFinal && !r.timedOut);
    active = stillAsking.map((r) => r.member);
    if (active.length === 0) break;

    // The last round is for answering. Any call proposed there cannot be
    // executed and then read, so the loop stops instead of pretending.
    if (isFinalRound) {
      truncated = truncated || `Stopped after ${cfg.maxRounds} rounds; ${active.length} member(s) still wanted to research.`;
      break;
    }

    const remaining = cfg.maxUniqueCalls - uniqueCallsUsed;
    if (remaining <= 0) {
      truncated = `Reached the ${cfg.maxUniqueCalls}-call ceiling for this turn.`;
      break;
    }
    if (budgetLeft() <= 0) {
      truncated = `Reached the ${cfg.totalToolMs}ms tool budget for this turn.`;
      break;
    }
    if (wallLeft() <= 0) {
      truncated = `Reached the ${cfg.totalWallMs}ms ceiling for this turn.`;
      break;
    }

    const { unique, dropped } = dedupeCalls(stillAsking, remaining);
    if (unique.length === 0) break;
    if (dropped > 0) truncated = `Dropped ${dropped} call(s) at the ${cfg.maxUniqueCalls}-call ceiling.`;
    uniqueCallsUsed += unique.length;

    // Executed in parallel, once each, with the per-call ceiling additionally
    // clamped to whatever is left of the total budget — otherwise eight 8s
    // calls could run to 64s inside a 25s budget.
    const perCall = Math.max(250, Math.min(cfg.perCallMs, budgetLeft(), wallLeft()));
    const toolsStartedAt = now();
    const executed = await Promise.all(
      unique.map(async (call) => {
        onEvent({ type: "tool_start", round, name: call.name, summary: describe(call) });
        const result = await registry.execute(call, { timeoutMs: perCall });
        onEvent({ type: "tool_result", round, name: call.name, ok: result.ok, summary: result.summary });
        return { call, result };
      }),
    );
    // The calls ran in parallel, so the round costs the SLOWEST of them, not
    // their sum — charging the budget the sum would bill eight parallel 2s
    // searches as sixteen seconds of a twenty-five second budget.
    toolMsUsed += now() - toolsStartedAt;

    transcript.push(...executed);

    if (budgetLeft() <= 0 && round < cfg.maxRounds) {
      truncated = truncated || `Reached the ${cfg.totalToolMs}ms tool budget for this turn.`;
      break;
    }
  }

  // Members still mid-research when a ceiling hit have no final answer. Their
  // absence is the truncation, and it is reported rather than papered over.
  if (active.length > 0 && !truncated) {
    truncated = `Stopped after ${round} round(s) with ${active.length} member(s) still researching.`;
  }

  return {
    answers: Object.fromEntries(answers),
    rounds: round,
    uniqueCallsUsed,
    /** Milliseconds actually spent inside tools, for the audit row. */
    toolMs: toolMsUsed,
    toolResults: transcript,
    /** Ready to paste into the synthesis prompt; empty when no tool ran. */
    research: transcript.length ? renderResults(transcript) : "",
    /** null when the loop ended because everyone was done. A string otherwise. */
    truncated,
  };
}

/** A short human-readable form of a call, for the SSE trail and the log. */
const describe = (call) => {
  const first = Object.values(call.args || {})[0];
  return typeof first === "string" ? `${call.name}: ${first.slice(0, 80)}` : call.name;
};

module.exports = { runAgentLoop, DEFAULTS };
