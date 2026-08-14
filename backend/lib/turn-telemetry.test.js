const test = require("node:test");
const assert = require("node:assert/strict");
const { createTurnTelemetry } = require("./turn-telemetry");

test("records each turn phase without retaining prompts or answers", async () => {
  let clock = 100;
  const telemetry = createTurnTelemetry({ now: () => clock, startedAt: clock });

  await telemetry.measureContext("summary", async () => {
    clock += 4;
    return "private summary";
  });
  await assert.rejects(
    telemetry.measureRouter("search", async () => {
      clock += 6;
      throw new Error("router failed");
    }),
    /router failed/,
  );
  telemetry.recordContextCompression({
    compressed: true,
    originalMessages: 20,
    retainedMessages: 8,
    originalChars: 48_000,
    retainedChars: 11_000,
    droppedMessages: 12,
    relevantTurns: 2,
    maxChars: 12_000,
    maxMessages: 10,
  });
  telemetry.recordSeat({ phase: "council", round: 1, model: "alpha", durationMs: 120, outcome: "answered" });
  telemetry.recordSeat({ phase: "tools", round: 2, model: "beta", durationMs: 80, outcome: "timed_out" });
  telemetry.recordToolRound({ round: 1, durationMs: 210, calls: 2, aborted: false });
  telemetry.recordSynthesis(330);
  telemetry.recordFallback(90, "post_council");
  telemetry.markCeiling("round_whip");
  clock += 50;

  const row = telemetry.snapshot({ category: "council", msToFirstByte: 700, msToFirstProgress: 500 });
  assert.equal(row.telemetry, "council_turn");
  assert.equal(row.turnMs, 60);
  assert.deepEqual(row.contextReads.summary, { ms: 4, ok: true });
  assert.deepEqual(row.routerReads.search, { ms: 6, ok: false });
  assert.equal(row.contextMs, 4);
  assert.deepEqual(row.contextCompression, {
    compressed: true,
    originalMessages: 20,
    retainedMessages: 8,
    originalChars: 48_000,
    retainedChars: 11_000,
    droppedMessages: 12,
    relevantTurns: 2,
    maxChars: 12_000,
    maxMessages: 10,
  });
  assert.equal(row.synthesisMs, 330);
  assert.equal(row.toolMs, 210);
  assert.equal(row.toolRounds[0].calls, 2);
  assert.equal(row.seats[1].model, "beta");
  assert.deepEqual(row.ceiling, { hit: true, reason: "round_whip" });
  assert.deepEqual(row.fallbackCouncil, { used: true, durationMs: 90, kind: "post_council" });
  assert.equal(JSON.stringify(row).includes("private summary"), false);
});

test("the first ceiling reason wins", () => {
  const telemetry = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  telemetry.markCeiling("wall");
  telemetry.markCeiling("tool_budget");
  assert.deepEqual(telemetry.snapshot().ceiling, { hit: true, reason: "wall" });
});

test("compression telemetry clamps non-finite sizes", () => {
  const telemetry = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  telemetry.recordContextCompression({ originalChars: Infinity, retainedMessages: Number.NaN });
  assert.equal(telemetry.snapshot().contextCompression.originalChars, 0);
  assert.equal(telemetry.snapshot().contextCompression.retainedMessages, 0);
});

test("token usage is summed per phase and absent when no provider reported it", () => {
  const bare = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  assert.equal(bare.snapshot().usage, null, "a zero would read as 'this turn cost nothing'");

  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  t.recordUsage({ promptTokens: 100, completionTokens: 20, totalTokens: 120, costUsd: 0.001 }, { phase: "council" });
  t.recordUsage({ promptTokens: 50, completionTokens: 10, totalTokens: 60, costUsd: 0.0005 }, { phase: "council" });
  t.recordUsage({ promptTokens: 900, completionTokens: 400, totalTokens: 1300, costUsd: 0.004 }, { phase: "synthesis" });
  t.recordUsage(null);
  t.recordUsage(undefined, { phase: "synthesis" });

  const { usage } = t.snapshot();
  assert.equal(usage.calls, 3, "a null usage is not a call");
  assert.equal(usage.totalTokens, 1480);
  assert.equal(usage.promptTokens, 1050);
  assert.equal(usage.completionTokens, 430);
  assert.equal(usage.costUsd, 0.0055);
  assert.equal(usage.byPhase.council.calls, 2);
  assert.equal(usage.byPhase.synthesis.totalTokens, 1300);
});

test("a provider that reports no numbers does not poison the sums", () => {
  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  t.recordUsage({ promptTokens: null, completionTokens: null, totalTokens: null, costUsd: null });
  const { usage } = t.snapshot();
  assert.equal(usage.calls, 1, "the call still happened");
  assert.equal(usage.totalTokens, 0);
});
