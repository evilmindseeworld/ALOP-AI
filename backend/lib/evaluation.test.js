const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { validateCase, loadDataset, gradeCase, summarise, percentile, citationsIn } = require("./evaluation");

const caseOf = (expect, extra = {}) => ({ id: "c1", question: "q?", ...extra, expect });
const obs = (over = {}) => ({ id: "c1", answer: "", frames: [], latencyMs: 100, costCents: null, textSource: null, error: null, ...over });

/* ---- the dataset is code, and a typo in it grades nothing ------------ */

test("an unknown expectation key is refused, because a typo grades nothing", () => {
  const problems = validateCase(caseOf({ mustContain: ["57.8"] }));
  assert.ok(problems.some((p) => p.includes('unknown expectation "mustContain"')), problems.join("|"));
});

test("a duplicate id is refused, because every report cites ids", () => {
  const { problems } = loadDataset({ name: "d", cases: [caseOf({}), caseOf({})] });
  assert.ok(problems.some((p) => p.includes("duplicate id")));
});

test("a mustMatch that is not a regex is refused before anything is spent", () => {
  const problems = validateCase(caseOf({ mustMatch: ["(unclosed"] }));
  assert.ok(problems.some((p) => p.includes("not a regex")));
});

test("the shipped release dataset validates", () => {
  const raw = JSON.parse(readFileSync(join(__dirname, "..", "evals", "core-v1.json"), "utf8"));
  const { cases, problems } = loadDataset(raw);
  assert.deepEqual(problems, []);
  assert.ok(cases.length >= 20, `only ${cases.length} cases`);
});

/* ---- graders --------------------------------------------------------- */

test("mustInclude is case-insensitive and mustNotInclude is not fooled by case", () => {
  const grade = gradeCase(caseOf({ mustInclude: ["canberra"], mustNotInclude: ["SYDNEY is the capital"] }),
    obs({ answer: "The capital is Canberra, not Sydney." }));
  assert.equal(grade.passed, true, grade.failures.join("|"));
});

test("mustCite counts URLs in the answer, and no URL is a failure", () => {
  assert.equal(citationsIn("see https://example.com/a and http://b.org").length, 2);
  const grade = gradeCase(caseOf({ mustCite: true }), obs({ answer: "Node 24 is current." }));
  assert.equal(grade.passed, false);
  assert.ok(grade.failures.some((f) => f.startsWith("mustCite")));
});

test("expectTools reads the tool_start frames rather than the answer text", () => {
  const searched = obs({ answer: "x", frames: [{ type: "tool_start", name: "web_search" }] });
  assert.equal(gradeCase(caseOf({ expectTools: ["web_search"] }), searched).passed, true);
  const claimedOnly = obs({ answer: "I searched the web for you.", frames: [] });
  assert.equal(gradeCase(caseOf({ expectTools: ["web_search"] }), claimedOnly).passed, false);
});

test("expectNoTools fails a turn that searched, which is the routing regression", () => {
  const grade = gradeCase(caseOf({ expectNoTools: true }),
    obs({ answer: "Yes, I can use Canva.", frames: [{ type: "tool_start", name: "web_search" }] }));
  assert.equal(grade.passed, false);
});

test("an error frame fails every case except one that asked for that code", () => {
  const failed = gradeCase(caseOf({ mustInclude: ["x"] }), obs({ error: { code: "model_quota_exhausted" } }));
  assert.equal(failed.passed, false);
  assert.ok(failed.failures.some((f) => f.startsWith("noError")));

  const expected = gradeCase(caseOf({ expectErrorCode: "model_quota_exhausted" }), obs({ error: { code: "model_quota_exhausted" } }));
  assert.equal(expected.passed, true, expected.failures.join("|"));
});

test("an empty answer fails even with no expectations at all", () => {
  assert.equal(gradeCase(caseOf({}), obs({ answer: "   " })).passed, false);
});

test("an unmeasured latency is inconclusive, never a pass", () => {
  const grade = gradeCase(caseOf({ maxLatencyMs: 1000 }), obs({ answer: "ok", latencyMs: null }));
  assert.equal(grade.passed, false);
  assert.equal(grade.inconclusive, true);
  assert.deepEqual(grade.failures, []);
});

/* ---- metrics --------------------------------------------------------- */

test("percentile is nearest-rank, so p95 is a number a case actually produced", () => {
  const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
  assert.equal(percentile(values, 95), 1000);
  assert.equal(percentile(values, 50), 500);
  assert.equal(percentile([], 95), null);
});

test("citationRate is measured only over the cases that must cite", () => {
  const cases = [
    caseOf({ mustCite: true }, { id: "s1" }),
    caseOf({ mustInclude: ["4"] }, { id: "a1" }),
  ];
  const observations = [
    obs({ id: "s1", answer: "https://example.com says so" }),
    obs({ id: "a1", answer: "2 + 2 is 4" }),
  ];
  const grades = cases.map((c) => gradeCase(c, observations.find((o) => o.id === c.id)));
  const metrics = summarise(grades, observations);
  assert.equal(metrics.citationRate, 1);
  assert.equal(metrics.cases, 2);
});

test("an unmeasured metric is null, not zero — zero passes every max gate", () => {
  const grades = [gradeCase(caseOf({}), obs({ answer: "hello" }))];
  const metrics = summarise(grades, [obs({ answer: "hello" })]);
  assert.equal(metrics.costCentsPerTurn, null);
  assert.equal(metrics.cachePrecision, null);
  assert.equal(metrics.toolSuccessRate, null);
});

test("a cache hit that answers wrongly is a precision failure, not a hit", () => {
  const cases = [caseOf({ mustInclude: ["Canberra"] }, { id: "k1" }), caseOf({ mustInclude: ["Canberra"] }, { id: "k2" })];
  const observations = [
    obs({ id: "k1", answer: "Canberra.", textSource: "cache" }),
    obs({ id: "k2", answer: "Sydney.", textSource: "cache" }),
  ];
  const grades = cases.map((c) => gradeCase(c, observations.find((o) => o.id === c.id)));
  assert.equal(summarise(grades, observations).cachePrecision, 0.5);
});

test("toolSuccessRate counts tool_result frames, failures included", () => {
  const observations = [obs({
    answer: "x",
    frames: [{ type: "tool_result", ok: true }, { type: "tool_result", ok: false }, { type: "tool_result", ok: true }],
  })];
  const grades = [gradeCase(caseOf({}), observations[0])];
  assert.equal(summarise(grades, observations).toolSuccessRate, 2 / 3);
});

test("factualityPassRate reads the tag, so an untagged failure cannot dilute it", () => {
  const cases = [
    caseOf({ mustInclude: ["4"] }, { id: "f1", tags: ["factuality"] }),
    caseOf({ mustInclude: ["nope"] }, { id: "x1", tags: ["style"] }),
  ];
  const observations = [obs({ id: "f1", answer: "4" }), obs({ id: "x1", answer: "something else" })];
  const grades = cases.map((c) => gradeCase(c, observations.find((o) => o.id === c.id)));
  const metrics = summarise(grades, observations);
  assert.equal(metrics.factualityPassRate, 1);
  assert.equal(metrics.acceptanceRate, 0.5);
});
