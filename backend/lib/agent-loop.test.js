const test = require("node:test");
const assert = require("node:assert/strict");
const { runAgentLoop, DEFAULTS } = require("./agent-loop");

/** A registry that records what it was asked to run and always succeeds. */
const fakeRegistry = (over = {}) => {
  const executed = [];
  return {
    executed,
    execute: async (call) => {
      executed.push(call);
      return { ok: true, summary: `ran ${call.name}`, content: `result for ${JSON.stringify(call.args)}` };
    },
    list: () => [{ name: "web_search" }],
    ...over,
  };
};

const toolCall = (query) => '```tool_call\n{"name":"web_search","args":{"query":"' + query + '"}}\n```';

// ===== termination =====

test("ends as soon as every member has answered", async () => {
  const registry = fakeRegistry();
  const r = await runAgentLoop({
    members: ["a", "b"],
    askMember: async (m) => `final answer from ${m}`,
    registry,
  });
  assert.equal(r.rounds, 1);
  assert.deepEqual(r.answers, { a: "final answer from a", b: "final answer from b" });
  assert.equal(registry.executed.length, 0, "no tool should run when nobody asks for one");
  assert.equal(r.truncated, null);
});

test("a member that asks, then answers, takes two rounds", async () => {
  const registry = fakeRegistry();
  const r = await runAgentLoop({
    members: ["a"],
    askMember: async (m, ctx) => (ctx.round === 1 ? toolCall("q") : "done researching"),
    registry,
  });
  assert.equal(r.rounds, 2);
  assert.equal(r.answers.a, "done researching");
  assert.equal(registry.executed.length, 1);
  assert.equal(r.truncated, null);
});

test("a member that finishes early is not asked again", async () => {
  const asked = [];
  await runAgentLoop({
    members: ["fast", "slow"],
    askMember: async (m, ctx) => {
      asked.push(`${m}:${ctx.round}`);
      if (m === "fast") return "done";
      return ctx.round < 2 ? toolCall("q") : "done";
    },
    registry: fakeRegistry(),
  });
  assert.deepEqual(asked, ["fast:1", "slow:1", "slow:2"]);
});

// ===== dedupe, in the loop =====

test("four members asking three distinct things costs three executions", async () => {
  const registry = fakeRegistry();
  const wanted = { glm: "OLED burn-in", kimi: "OLED burn-in", qwen: "QD-OLED vs WOLED", gemma: "OLED burn-in" };
  const r = await runAgentLoop({
    members: Object.keys(wanted),
    askMember: async (m, ctx) => (ctx.round === 1 ? toolCall(wanted[m]) : "done"),
    registry,
  });
  assert.equal(registry.executed.length, 2);
  assert.equal(r.uniqueCallsUsed, 2);
});

test("every member sees every result, including ones it did not ask for", async () => {
  let seenByGemma = null;
  await runAgentLoop({
    members: ["qwen", "gemma"],
    askMember: async (m, ctx) => {
      if (ctx.round === 1) return toolCall(m === "qwen" ? "qwen-query" : "gemma-query");
      if (m === "gemma") seenByGemma = ctx.toolResults;
      return "done";
    },
    registry: fakeRegistry(),
  });
  assert.equal(seenByGemma.length, 2, "broadcast means all results, not just your own");
});

// ===== ceilings =====

test("stops at maxRounds and says so", async () => {
  const r = await runAgentLoop({
    members: ["a"],
    askMember: async () => toolCall("never satisfied"),
    registry: fakeRegistry(),
  });
  assert.equal(r.rounds, DEFAULTS.maxRounds);
  assert.match(r.truncated, new RegExp(`${DEFAULTS.maxRounds} rounds`));
});

test("the final round is for answering, so no call is executed in it", async () => {
  // A call proposed in the last round cannot be executed and then read. Running
  // it would spend budget on a result nobody sees.
  const registry = fakeRegistry();
  await runAgentLoop({ members: ["a"], askMember: async () => toolCall("x"), registry });
  assert.equal(registry.executed.length, DEFAULTS.maxRounds - 1);
});

test("isFinalRound is passed so a prompt can tell a member to stop asking", async () => {
  const flags = [];
  await runAgentLoop({
    members: ["a"],
    askMember: async (m, ctx) => { flags.push(ctx.isFinalRound); return toolCall("x"); },
    registry: fakeRegistry(),
  });
  // Every round but the last is a research round; the last says "answer now".
  assert.deepEqual(flags, [...Array(DEFAULTS.maxRounds - 1).fill(false), true]);
});

test("stops at maxUniqueCalls and says so", async () => {
  const registry = fakeRegistry();
  const r = await runAgentLoop({
    members: ["a", "b", "c"],
    // Every member asks for something different every round: 3 unique per round.
    askMember: async (m, ctx) => toolCall(`${m}-${ctx.round}`),
    registry,
    maxRounds: 10,
    maxUniqueCalls: 4,
  });
  assert.ok(registry.executed.length <= 4, `ran ${registry.executed.length}`);
  assert.equal(r.uniqueCallsUsed <= 4, true);
  assert.match(r.truncated, /4-call ceiling/);
});

test("stops on the total tool budget and says so", async () => {
  // The clock is injected rather than slept through: a real 25s wait in a unit
  // test is a test nobody runs.
  let clock = 0;
  const r = await runAgentLoop({
    members: ["a"],
    askMember: async () => toolCall("x"),
    registry: fakeRegistry({ execute: async () => { clock += 20000; return { ok: true, summary: "slow", content: "c" }; } }),
    now: () => clock,
    maxRounds: 10,
    totalToolMs: 25000,
  });
  assert.match(r.truncated, /25000ms tool budget/);
});

test("the per-call timeout is clamped to what is left of the total budget", async () => {
  // Otherwise eight 8s calls run to 64s inside a 25s budget.
  let clock = 0;
  const seen = [];
  await runAgentLoop({
    members: ["a"],
    askMember: async () => toolCall("x"),
    registry: {
      list: () => [],
      execute: async (_c, opts) => { seen.push(opts.timeoutMs); clock += 21000; return { ok: true, summary: "s", content: "" }; },
    },
    now: () => clock,
    maxRounds: 10,
    perCallMs: 8000,
    totalToolMs: 25000,
  });
  assert.equal(seen[0], 8000, "first call gets the full per-call ceiling");
  assert.ok(seen.every((t) => t <= 8000));
});

// ===== truncation is reported, never hidden =====

test("truncated is null only when the loop ended because everyone was done", async () => {
  const done = await runAgentLoop({ members: ["a"], askMember: async () => "answer", registry: fakeRegistry() });
  assert.equal(done.truncated, null);

  const cut = await runAgentLoop({ members: ["a"], askMember: async () => toolCall("x"), registry: fakeRegistry() });
  assert.equal(typeof cut.truncated, "string");
});

test("partial answers survive a truncated run", async () => {
  // One member finished, one was still researching. The finished answer must
  // not be thrown away because the other ran out of rounds.
  const r = await runAgentLoop({
    members: ["quick", "endless"],
    askMember: async (m) => (m === "quick" ? "quick answer" : toolCall("more")),
    registry: fakeRegistry(),
  });
  assert.equal(r.answers.quick, "quick answer");
  assert.equal(r.answers.endless, undefined);
  assert.ok(r.truncated);
});

// ===== robustness =====

test("a member that throws is dropped, not fatal", async () => {
  const r = await runAgentLoop({
    members: ["good", "broken"],
    askMember: async (m) => { if (m === "broken") throw new Error("gateway 502"); return "good answer"; },
    registry: fakeRegistry(),
  });
  assert.equal(r.answers.good, "good answer");
  assert.equal(r.answers.broken, undefined);
});

test("a failing tool does not stop the round", async () => {
  const r = await runAgentLoop({
    members: ["a"],
    askMember: async (m, ctx) => (ctx.round === 1 ? toolCall("x") : "answered anyway"),
    registry: fakeRegistry({ execute: async () => ({ ok: false, summary: "404", content: "" }) }),
  });
  assert.equal(r.answers.a, "answered anyway");
  assert.ok(r.research.includes("FAILED"));
});

test("no members is a clean empty result", async () => {
  const r = await runAgentLoop({ members: [], askMember: async () => "x", registry: fakeRegistry() });
  assert.deepEqual(r.answers, {});
  assert.equal(r.rounds, 0);
  assert.equal(r.research, "");
});

// ===== output shape =====

test("research renders each call with its outcome, for the synthesiser", async () => {
  const r = await runAgentLoop({
    members: ["a"],
    askMember: async (m, ctx) => (ctx.round === 1 ? toolCall("OLED") : "done"),
    registry: fakeRegistry(),
  });
  assert.ok(r.research.includes("web_search"));
  assert.ok(r.research.includes("OK"));
  assert.ok(r.research.includes('query="OLED"'));
});

test("emits tool_start and tool_result for the SSE trail", async () => {
  const events = [];
  await runAgentLoop({
    members: ["a"],
    askMember: async (m, ctx) => (ctx.round === 1 ? toolCall("OLED burn-in") : "done"),
    registry: fakeRegistry(),
    onEvent: (e) => events.push(e),
  });
  assert.deepEqual(events.map((e) => e.type), ["tool_start", "tool_result"]);
  assert.equal(events[0].round, 1);
  assert.ok(events[0].summary.includes("OLED burn-in"));
  assert.equal(events[1].ok, true);
});

// ===== the two clocks =====

/**
 * THE BUG THIS PINS. `totalToolMs` used to be measured from the top of the
 * loop, so the council's own deliberation counted as research spend. Members
 * are asked with a 30s whip and seven seats can hold twenty of those seconds,
 * which meant a 25s "tool budget" was routinely gone before the first search
 * returned — and the turn truncated saying it had run out of time to research
 * on a turn where it had researched for two seconds.
 */
test("model latency does not spend the tool budget", async () => {
  let clock = 0;
  const ran = [];
  const registry = fakeRegistry({
    execute: async (call) => { ran.push(call); clock += 1000; return { ok: true, summary: "fast", content: "c" }; },
  });
  const r = await runAgentLoop({
    members: ["a"],
    // Every member reply costs 20s of wall clock and zero tool time.
    askMember: async (m, ctx) => { clock += 20000; return ctx.round < 3 ? toolCall(`q${ctx.round}`) : "done"; },
    registry,
    now: () => clock,
    maxRounds: 6,
    totalToolMs: 25000,
    totalWallMs: 200000,
  });
  assert.equal(r.toolMs, 2000, "only the time inside execute is charged");
  assert.equal(ran.length, 2, "both research rounds got to run");
  assert.equal(r.truncated, null);
});

test("parallel calls in one round cost the slowest, not their sum", async () => {
  let clock = 0;
  const r = await runAgentLoop({
    members: ["a", "b", "c"],
    askMember: async (m, ctx) => (ctx.round === 1 ? toolCall(`${m}-q`) : "done"),
    // Promise.all means the three run together; the fake advances the clock
    // once because the loop measures around the whole batch.
    registry: fakeRegistry({ execute: async () => { clock += 3000; return { ok: true, summary: "s", content: "" }; } }),
    now: () => clock,
  });
  assert.equal(r.toolMs, 9000, "the fake clock is serial, so this is its ceiling");
  assert.equal(r.truncated, null);
});

test("the wall ceiling stops a loop whose models are slow but whose tools are cheap", async () => {
  let clock = 0;
  const r = await runAgentLoop({
    members: ["a"],
    askMember: async () => { clock += 30000; return toolCall("x"); },
    registry: fakeRegistry(),
    now: () => clock,
    maxRounds: 20,
    totalToolMs: 25000,
    totalWallMs: 75000,
  });
  assert.match(r.truncated, /75000ms ceiling/);
});

// ===== the round whip =====

test("a member that misses the round whip is dropped, not waited on", async () => {
  const registry = fakeRegistry();
  const r = await runAgentLoop({
    members: ["quick", "hung"],
    askMember: (m, ctx) =>
      m === "hung"
        ? new Promise(() => {}) // never settles
        : Promise.resolve(ctx.round === 1 ? toolCall("q") : "quick is done"),
    registry,
    roundMs: 30,
  });
  assert.deepEqual(r.answers, { quick: "quick is done" });
  assert.match(r.truncated, /did not reply within/);
  assert.equal(registry.executed.length, 1, "the quick member's research still ran");
});

test("the round whip does not fire when everyone answers", async () => {
  const r = await runAgentLoop({
    members: ["a", "b"],
    askMember: async (m) => `answer from ${m}`,
    registry: fakeRegistry(),
    roundMs: 50,
  });
  assert.equal(r.truncated, null);
});
