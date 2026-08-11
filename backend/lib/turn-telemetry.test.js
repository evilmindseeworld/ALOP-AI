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
