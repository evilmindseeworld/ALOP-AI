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

/* The failure this came from: a synthesis answer named the council — "Expert 1
 * emphasis", "Both experts agree" — in a turn whose system prompt forbids ever
 * mentioning it, and gradeCase reported a clean structural pass. The model had
 * written U+202F NARROW NO-BREAK SPACE between "Expert" and "1", so the plain
 * `includes` never saw it. Measured on a real output, 2026-08-19. */
test("an exotic space between the words does not hide a forbidden string", () => {
  const NNBSP = String.fromCharCode(0x202f);
  const NBSP = String.fromCharCode(0x00a0);
  const IDEOGRAPHIC = String.fromCharCode(0x3000);
  for (const space of [NNBSP, NBSP, IDEOGRAPHIC]) {
    const grade = gradeCase(caseOf({ mustNotInclude: ["Expert 1"] }),
      obs({ answer: `| Aspect | Expert${space}1 emphasis | What decides |` }));
    assert.equal(grade.passed, false, `U+${space.charCodeAt(0).toString(16)} hid the violation`);
    assert.ok(grade.failures.some((f) => f.startsWith("mustNotInclude")));
  }
});

test("an exotic space does not hide a required string either", () => {
  const grade = gradeCase(caseOf({ mustInclude: ["57.8 percent"] }),
    obs({ answer: `The answer is 57.8${String.fromCharCode(0x202f)}percent of the total.` }));
  assert.equal(grade.passed, true, grade.failures.join("|"));
});

test("a line break between the words of a needle is still a match", () => {
  const grade = gradeCase(caseOf({ mustNotInclude: ["as an AI"] }),
    obs({ answer: "I should say, as an\nAI, that this is a limitation." }));
  assert.equal(grade.passed, false);
});

test("mustCite requires every answer URL to be backed by a recorded public source receipt", () => {
  assert.equal(citationsIn("see https://example.com/a and http://b.org").length, 2);
  const noUrl = gradeCase(caseOf({ mustCite: true }), obs({ answer: "Node 24 is current." }));
  assert.equal(noUrl.passed, false);
  assert.ok(noUrl.failures.some((f) => f.startsWith("mustCite")));

  const ungrounded = gradeCase(caseOf({ mustCite: true }), obs({ answer: "Node 24 is current: https://example.com/a" }));
  assert.equal(ungrounded.passed, false);
  assert.ok(ungrounded.failures.some((f) => f.startsWith("mustCite")));

  const grounded = gradeCase(caseOf({ mustCite: true }), obs({
    answer: "Node 24 is current: https://example.com/a.",
    provenance: { sources: [{ title: "Node release", url: "https://example.com/a", via: "web_search" }] },
  }));
  assert.equal(grounded.passed, true, grounded.failures.join("|"));

  const mixed = gradeCase(caseOf({ mustCite: true }), obs({
    answer: "Node 24 is current: https://example.com/a and https://unrelated.example/b",
    provenance: { sources: [{ title: "Node release", url: "https://example.com/a", via: "web_search" }] },
  }));
  assert.equal(mixed.passed, false);
  assert.ok(mixed.failures.some((f) => f.startsWith("mustCite")));
});

test("cache tradeoff grading accepts speed only when it is attached to caching", () => {
  const tradeoff = "(?:\\bcach(?:e|ed|ing|es)\\b[\\s\\S]{0,160}\\b(?:faster|speed|latency|performance)\\b|\\b(?:faster|speed|latency|performance)\\b[\\s\\S]{0,160}\\bcach(?:e|ed|ing|es)\\b)";
  const expect = { mustMatch: [tradeoff, "stale|out of date|invalidat"] };
  const good = gradeCase(caseOf(expect), obs({ answer: "Caching can improve speed by serving a fast result, but stale data can be wrong." }));
  const unrelated = gradeCase(caseOf(expect), obs({ answer: "The deployment speed improved, but stale data can still be wrong." }));
  assert.equal(good.passed, true, good.failures.join("|"));
  assert.equal(unrelated.passed, false);
});

test("model-disagreement grading accepts inflected diminishing language without accepting unrelated prose", () => {
  const value = "(?:(?:extra|additional|more|another)\\s+(?:model|vote|answer|round)[^.!?\\n]{0,80}\\b(?:redundant|duplicate|diminish\\w*)\\b|(?:gain|benefit|value|utility|returns?|confidence)[^.!?\\n]{0,80}\\b(?:redundant|duplicate|diminish\\w*)\\b|\\b(?:redundant|duplicate|diminish\\w*)\\b[^.!?\\n]{0,80}\\b(?:model|vote|answer|round|gain|benefit|value|utility|returns?|confidence)\\b)";
  const expect = { mustMatch: ["disagree|uncertain|risk|novel|different", value] };
  for (const wording of ["the gain diminishes", "diminishing returns", "the extra vote is redundant", "the answer is a duplicate"]) {
    const grade = gradeCase(caseOf(expect), obs({ answer: `More models help when the first answers disagree; ${wording}.` }));
    assert.equal(grade.passed, true, wording + ": " + grade.failures.join("|"));
  }
  const unrelated = gradeCase(caseOf(expect), obs({ answer: "The models disagree, but the duplicate file was deleted after a long day." }));
  assert.equal(unrelated.passed, false);
  const noValue = gradeCase(caseOf(expect), obs({ answer: "More models help when the first answers disagree; the result is stable." }));
  assert.equal(noValue.passed, false);
});

test("mustMatch folds curly apostrophes and Unicode hyphens without flattening line boundaries", () => {
  const grade = gradeCase(caseOf({ mustMatch: ["don't have|can't|self-host"] }), obs({
    answer: "I don’t have access to the private figures.\nA self‑hosted copy is not recommended.",
  }));
  assert.equal(grade.passed, true, grade.failures.join("|"));
});

test("mustMatch treats a space before percent sign as typography", () => {
  const grade = gradeCase(caseOf({ mustMatch: ["\\b1%|\\b0\\.9"] }), obs({
    answer: "About 1 % chance; roughly 1 %.",
  }));
  assert.equal(grade.passed, true, grade.failures.join("|"));
});

test("clear answer fragments fail completeness even when they meet minChars", () => {
  const fragment = gradeCase(caseOf({ minChars: 20 }), obs({
    answer: "The rollout should begin with a controlled baseline and",
  }));
  assert.equal(fragment.passed, false);
  assert.ok(fragment.failures.some((f) => f.startsWith("completeness")));

  const openFence = gradeCase(caseOf({}), obs({ answer: "```js\nconst answer = 42;" }));
  assert.equal(openFence.passed, false);
  assert.ok(openFence.failures.some((f) => f.startsWith("completeness")));

  const clippedWord = gradeCase(caseOf({}), obs({
    answer: "A replica adds operational cost and consistency concerns, but at this traffic level it gives you mo",
  }));
  assert.equal(clippedWord.passed, false);
  assert.ok(clippedWord.failures.some((f) => f.startsWith("completeness")));

  const clippedTable = gradeCase(caseOf({}), obs({
    answer: "| Metric | Value |\n|---|---|\n| overall confidence | <",
  }));
  assert.equal(clippedTable.passed, false);
  assert.ok(clippedTable.failures.some((f) => f.startsWith("completeness")));
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

test("an unexpected error is inconclusive, while an expected error is graded", () => {
  const unmeasured = gradeCase(caseOf({ mustInclude: ["x"] }), obs({ error: { code: "model_quota_exhausted" } }));
  assert.equal(unmeasured.passed, false);
  assert.equal(unmeasured.inconclusive, true);
  assert.deepEqual(unmeasured.failures, []);

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
    obs({
      id: "s1",
      answer: "https://example.com says so",
      provenance: { sources: [{ title: "Example", url: "https://example.com", via: "web_search" }] },
    }),
    obs({ id: "a1", answer: "2 + 2 is 4" }),
  ];
  const grades = cases.map((c) => gradeCase(c, observations.find((o) => o.id === c.id)));
  const metrics = summarise(grades, observations);
  assert.equal(metrics.citationRate, 1);
  assert.equal(metrics.cases, 2);
  assert.equal(metrics.evaluatedCases, 2);
  assert.equal(metrics.coverageRate, 1);
});

test("provider errors leave content rates and timing unmeasured", () => {
  const cases = [caseOf({ mustInclude: ["4"] }, { id: "ok" }), caseOf({ mustInclude: ["4"] }, { id: "quota" })];
  const observations = [
    obs({ id: "ok", answer: "4", latencyMs: 100 }),
    obs({ id: "quota", answer: "", latencyMs: 2000, error: { code: "model_quota_exhausted" } }),
  ];
  const grades = cases.map((c) => gradeCase(c, observations.find((o) => o.id === c.id)));
  const metrics = summarise(grades, observations);
  assert.equal(metrics.passed, 1);
  assert.equal(metrics.failed, 0);
  assert.equal(metrics.inconclusive, 1);
  assert.equal(metrics.evaluatedCases, 1);
  assert.equal(metrics.coverageRate, 0.5);
  assert.equal(metrics.acceptanceRate, 1);
  assert.equal(metrics.latencyP50Ms, 100);
  assert.equal(metrics.latencyP95Ms, 100);
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

test("fresh-execution timing fields stay null until the runner observes them", () => {
  const cases = [caseOf({}, { id: "t1" }), caseOf({}, { id: "t2" })];
  const observations = [
    obs({ id: "t1", answer: "ok", firstByteMs: 50, firstAnswerTokenMs: 200, firstUsefulStageMs: 20 }),
    obs({ id: "t2", answer: "ok", firstByteMs: 100, firstAnswerTokenMs: 300, firstUsefulStageMs: 40 }),
  ];
  const grades = cases.map((c) => gradeCase(c, observations.find((o) => o.id === c.id)));
  const metrics = summarise(grades, observations);
  assert.equal(metrics.firstByteP50Ms, 50);
  assert.equal(metrics.firstByteP95Ms, 100);
  assert.equal(metrics.firstAnswerTokenP50Ms, 200);
  assert.equal(metrics.firstAnswerTokenP95Ms, 300);
  assert.equal(metrics.firstUsefulStageP50Ms, 20);
  assert.equal(metrics.firstUsefulStageP95Ms, 40);
});
