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
 *     maxRounds        3     search → read → refine covers nearly every question
 *     maxUniqueCalls   8     per turn, across all rounds
 *     perCallMs        8000
 *     totalToolMs      25000 wall clock for tool work, all rounds together
 *
 * On hitting any of them the loop stops, hands back what it has, and SAYS SO in
 * `truncated`. A truncated answer presented as a complete one is worse than a
 * slow one — the caller must be able to tell the synthesiser that the research
 * was cut short, so the answer can hedge instead of asserting.
 *
 * Nothing here touches the network. `askMember` and `registry` are injected, so
 * the whole loop is tested against fakes.
 */

const { parseToolRequests } = require("./tool-protocol");
const { dedupeCalls } = require("./tool-dedupe");

const DEFAULTS = {
  maxRounds: 3,
  maxUniqueCalls: 8,
  perCallMs: 8000,
  totalToolMs: 25000,
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

  const budgetLeft = () => cfg.totalToolMs - (now() - startedAt);
  let active = [...(members || [])];

  while (active.length > 0 && round < cfg.maxRounds) {
    round++;
    const isFinalRound = round === cfg.maxRounds;

    // Every still-active member is asked concurrently. A member that throws is
    // dropped from the round rather than failing the turn: a council of seven
    // does not need all seven, and one gateway hiccup must not lose the answer.
    const replies = await Promise.all(
      active.map(async (member) => {
        try {
          const raw = await askMember(member, { round, toolResults: transcript, isFinalRound });
          return { member, ...parseToolRequests(raw) };
        } catch (err) {
          return { member, calls: [], text: "", isFinal: true, error: err.message };
        }
      }),
    );

    for (const reply of replies) {
      if (reply.isFinal && reply.text) answers.set(reply.member, reply.text);
    }

    // A member that gave a final answer is done. One that errored is dropped —
    // it has nothing to contribute and asking it again next round would just
    // spend the budget on the same failure.
    const stillAsking = replies.filter((r) => !r.isFinal);
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

    const { unique, dropped } = dedupeCalls(stillAsking, remaining);
    if (unique.length === 0) break;
    if (dropped > 0) truncated = `Dropped ${dropped} call(s) at the ${cfg.maxUniqueCalls}-call ceiling.`;
    uniqueCallsUsed += unique.length;

    // Executed in parallel, once each, with the per-call ceiling additionally
    // clamped to whatever is left of the total budget — otherwise eight 8s
    // calls could run to 64s inside a 25s budget.
    const perCall = Math.max(250, Math.min(cfg.perCallMs, budgetLeft()));
    const executed = await Promise.all(
      unique.map(async (call) => {
        onEvent({ type: "tool_start", round, name: call.name, summary: describe(call) });
        const result = await registry.execute(call, { timeoutMs: perCall });
        onEvent({ type: "tool_result", round, name: call.name, ok: result.ok, summary: result.summary });
        return { call, result };
      }),
    );

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
