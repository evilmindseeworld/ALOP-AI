const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_GATES, mergeGates, evaluateGates, formatGates } = require("./release-gates");

/** Everything measured, everything comfortably inside its threshold. */
const GOOD = {
  cases: 22,
  acceptanceRate: 1,
  factualityPassRate: 1,
  citationRate: 1,
  latencyP95Ms: 30_000,
  costCentsPerTurn: 2,
  toolSuccessRate: 1,
  cachePrecision: 1,
};

test("a fully measured, healthy run passes every gate", () => {
  const verdict = evaluateGates(GOOD);
  assert.equal(verdict.passed, true, JSON.stringify(verdict.failed.concat(verdict.inconclusive)));
  assert.equal(verdict.results.length, DEFAULT_GATES.length);
});

test("AN UNMEASURED METRIC IS INCONCLUSIVE, NOT A PASS — zero would clear every max gate", () => {
  const verdict = evaluateGates({ ...GOOD, costCentsPerTurn: null });
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.inconclusive, ["cost-per-turn"]);
  assert.deepEqual(verdict.failed, []);
});

test("a sample smaller than minSample is inconclusive, so four cases cannot bless a release", () => {
  const verdict = evaluateGates({ ...GOOD, cases: 4 });
  assert.equal(verdict.passed, false);
  assert.ok(verdict.inconclusive.includes("acceptance"), verdict.inconclusive.join(","));
  assert.ok(verdict.results.find((r) => r.name === "acceptance").detail.includes("sample 4 < 10"));
});

test("--allow-inconclusive passes what is measured and still refuses a real failure", () => {
  const unmeasured = evaluateGates({ ...GOOD, cachePrecision: null }, { allowInconclusive: true });
  assert.equal(unmeasured.passed, true);

  const broken = evaluateGates({ ...GOOD, cachePrecision: null, acceptanceRate: 0.5 }, { allowInconclusive: true });
  assert.equal(broken.passed, false);
  assert.deepEqual(broken.failed, ["acceptance"]);
});

test("direction is enforced in both directions", () => {
  assert.equal(evaluateGates({ ...GOOD, latencyP95Ms: 75_001 }).failed.includes("latency-p95"), true);
  assert.equal(evaluateGates({ ...GOOD, latencyP95Ms: 75_000 }).passed, true, "at the threshold is a pass");
  assert.equal(evaluateGates({ ...GOOD, acceptanceRate: 0.89 }).failed.includes("acceptance"), true);
  assert.equal(evaluateGates({ ...GOOD, acceptanceRate: 0.9 }).passed, true, "at the threshold is a pass");
});

test("a threshold override is a number, and an unknown gate name is an error not a no-op", () => {
  const gates = mergeGates({ "cost-per-turn": 20 });
  assert.equal(gates.find((g) => g.name === "cost-per-turn").threshold, 20);
  assert.equal(evaluateGates({ ...GOOD, costCentsPerTurn: 12 }, { gates }).passed, true);
  assert.throws(() => mergeGates({ "cost-per-tunr": 20 }), /unknown gate/);
});

test("a disabled gate is still reported, because a report listing only what ran reads as all-clear", () => {
  const gates = mergeGates({ "cache-precision": false });
  const verdict = evaluateGates({ ...GOOD, cachePrecision: null }, { gates });
  assert.equal(verdict.passed, true);
  assert.equal(verdict.results.find((r) => r.name === "cache-precision").status, "disabled");
});

test("every gate carries a reason, so the log says why a release stopped", () => {
  for (const gate of DEFAULT_GATES) assert.ok(gate.why && gate.why.length > 20, `${gate.name} has no reason`);
  const line = formatGates(evaluateGates({ ...GOOD, acceptanceRate: 0.1 }));
  assert.match(line, /FAIL {2}acceptance/);
  assert.match(line, /unmeasured|\d/);
});
