const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { validateCase, loadDataset, gradeCase, summarise, percentile, citationsIn, isLikelyComplete, inspectCompletionMetadata, hasDiminishingValueReasoning } = require("./evaluation");

const caseOf = (expect, extra = {}) => ({ id: "c1", question: "q?", ...extra, expect });
const obs = (over = {}) => ({ id: "c1", answer: "", frames: [], latencyMs: 100, costCents: null, textSource: null, error: null, ...over });
const cacheHit = (over = {}) => obs({
  answer: "A complete cached answer.",
  textSource: "cache",
  cacheDecision: "hit",
  provenance: { route: "answer_cache" },
  accounting: {
    schemaVersion: 1,
    cache: {
      source: "turn_provenance.route",
      decision: "hit",
      lookupAttempted: true,
      bypassRequested: false,
      bypassAccepted: false,
    },
  },
  ...over,
});

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

test("mustDiscussTradeoff is a known boolean expectation", () => {
  assert.deepEqual(validateCase(caseOf({ mustDiscussTradeoff: true })), []);
  assert.ok(validateCase(caseOf({ mustDiscussTradeoff: "yes" })).some((p) => p.includes("mustDiscussTradeoff must be a boolean")));
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

test("the live BBC weather citation is extracted and matched to its canonical receipt", () => {
  const url = "https://www.bbc.com/weather/2643743";
  const grade = gradeCase(caseOf({ mustCite: true }), obs({
    answer: `London is mostly cloudy【${url}】.`,
    provenance: {
      sources: [{ title: "BBC Weather", url: `${url}#today`, via: "web_search" }],
    },
  }));
  assert.deepEqual(citationsIn(`London is mostly cloudy【${url}】.`), [url]);
  assert.equal(grade.passed, true, grade.failures.join("|"));
});

test("cache tradeoff grading accepts speed only when it is attached to caching", () => {
  const tradeoff = "(?:\\bcach(?:e|ed|ing|es)\\b[\\s\\S]{0,160}\\b(?:faster|speed|latency|performance)\\b|\\b(?:faster|speed|latency|performance)\\b[\\s\\S]{0,160}\\bcach(?:e|ed|ing|es)\\b)";
  const expect = { mustMatch: [tradeoff, "stale|out of date|invalidat"] };
  const good = gradeCase(caseOf(expect), obs({ answer: "Caching can improve speed by serving a fast result, but stale data can be wrong." }));
  const unrelated = gradeCase(caseOf(expect), obs({ answer: "The deployment speed improved, but stale data can still be wrong." }));
  assert.equal(good.passed, true, good.failures.join("|"));
  assert.equal(unrelated.passed, false);
});

/* INPUT / EXPECTED / WHY. The rubric asks one question: does the answer say
 * that additional or mutually similar seats contribute progressively less NEW
 * INFORMATION? Each positive example asserts that relation; each negative
 * example either rejects it or moves the vocabulary into another role/topic. */
const TRADEOFF_PASS_CASES = [
  ["Replica models add negligible new information.", "replica models plus negligible information"],
  ["Additional models with the same biases contribute little new evidence.", "additional models plus little evidence"],
  ["The incremental benefit falls as the models become more similar.", "benefit falls as model perspectives converge"],
  ["Marginal value approaches zero as perspectives converge.", "value approaches zero as perspectives converge"],
  ["Repeated perspectives contribute progressively less novel evidence.", "repeated perspectives plus less novelty"],
  ["An extra model repeats an existing perspective while adding latency.", "extra model repeats an existing perspective"],
  ["Duplicated reasoning adds cost while contributing almost no novelty.", "duplicated reasoning plus almost no novelty"],
  ["The models add some information, but the incremental benefit falls as their perspectives converge.", "positive contrast with a diminishing second clause"],
  ["If the new model is just a replica of the existing five (same data, same cut-offs, same biases), the marginal gain is negligible and the extra latency, cost, and complexity are not justified.", "actual live semantic answer"],
];

const TRADEOFF_FAIL_CASES = [
  ["Extra models are not redundant at all; every one adds value.", "negated redundancy"],
  ["Extra models are absolutely not redundant.", "absolute negation"],
  ["Extra models are not in any meaningful sense redundant.", "long-scope redundancy negation"],
  ["The models are not at all redundant.", "at-all negation"],
  ["The marginal benefit from another model is definitely not negligible.", "negated decrease"],
  ["It is not true that additional models add negligible information.", "negated proposition"],
  ["I would not say the models are redundant.", "speaker-level denial"],
  ["No reasonable person would call these models redundant.", "no-agent denial"],
  ["Some people call the models redundant, but that is wrong; each adds novel information.", "wrong contrast and positive-looking second clause"],
  ["Although their outputs look similar, marginal value does not diminish.", "explicitly rejects diminishing value"],
  ["The extra model repeats some context, yet its incremental benefit remains high.", "high-value contrast"],
  ["The extra seat repeats context, yet its incremental value remains high.", "high-value contrast with seat"],
  ["Models are similar in size, not in reasoning.", "similarity in the wrong attribute"],
  ["The same model version produced different insights.", "same model without diminishing value"],
  ["The duplicate file contains negligible evidence.", "evidence cannot become a council subject"],
  ["The same model returned the same answer.", "similarity without declining informational value"],
  ["More models improve diversity. Revenue declined this quarter.", "cross-sentence role leakage"],
  ["The models disagree. The duplicate file contains evidence.", "cross-sentence category collision"],
  ["The council has five models. Marginal revenue fell.", "cross-sentence value leakage"],
  ["Running more models costs more money and uses a larger compute budget for every request.", "cost without informational decrease"],
  ["Adding more models increases latency and slows the response for every user.", "latency without informational decrease"],
  ["The models disagree, and more models improve coverage and accuracy.", "benefits without diminishing value"],
  ["Additional models provide better coverage, higher accuracy and greater diversity of perspectives.", "benefits without diminishing value"],
  ["The answers are the same length as the ones we measured last week.", "similarity without value relation"],
  ["The models disagree, but the duplicate file was deleted after a long day.", "unrelated duplicate file"],
  ["The team saw a large gain in revenue after the pricing change shipped.", "unrelated value word"],
  ["Returns on the marketing spend diminished sharply after the third week.", "unrelated diminishing return"],
];

test("model-disagreement grading checks assertion polarity and bounded relation", () => {
  for (const [answer, why] of TRADEOFF_PASS_CASES) {
    assert.equal(hasDiminishingValueReasoning(answer), true, why + "\n  answer: " + answer);
  }
  for (const [answer, why] of TRADEOFF_FAIL_CASES) {
    assert.equal(hasDiminishingValueReasoning(answer), false, why + "\n  answer: " + answer);
  }
});

test("tradeoff polarity follows the final contrastive clause", () => {
  for (const answer of [
    "The models might appear redundant; however, every one contributes unique evidence.",
    "The models are redundant; however, that redundancy is only superficial and each adds new information.",
    "Some call them redundant; however, that is wrong.",
    "Some reviewers call the seats repetitive; nevertheless, each adds substantial novel insight.",
    "One could argue their value diminishes; however, the data shows every additional model improves the result materially.",
    "They share some context; yet the marginal benefit remains high.",
    "Although similar, each additional model continues contributing unique evidence.",
  ]) {
    assert.equal(hasDiminishingValueReasoning(answer), false, answer);
  }

  for (const answer of [
    "The first few seats help; however, once the models become similar, each additional one contributes less new information.",
    "Extra perspectives are useful initially; nevertheless, repeated perspectives eventually add little novel evidence.",
    "The panel benefits from diversity; yet another near-identical judge contributes almost nothing new.",
  ]) {
    assert.equal(hasDiminishingValueReasoning(answer), true, answer);
  }
});

test("implicit contribution decrease requires a council addition relation", () => {
  for (const answer of [
    "The sixth near-identical judge adds almost nothing that the first five did not already cover.",
    "Another similar model contributes very little beyond the existing panel.",
    "Each extra replica brings almost nothing new.",
    "The next aligned opinion adds little that is genuinely novel.",
  ]) {
    assert.equal(hasDiminishingValueReasoning(answer), true, answer);
  }

  for (const answer of [
    "Nothing happened after the model call.",
    "The model knows almost nothing about biology.",
    "The duplicate file adds nothing to disk usage.",
    "Another model contributes little latency.",
    "Another model adds nothing to disk usage.",
    "Another model costs almost nothing.",
    "The HTTP retry contributes little latency.",
    "The judge said nothing.",
    "Nothing was logged.",
    "Additional models were tested. Nothing happened afterward.",
  ]) {
    assert.equal(hasDiminishingValueReasoning(answer), false, answer);
  }
});

test("bounded tradeoff paraphrases remain category-safe", () => {
  const recognized = [
    "After several aligned opinions, the next opinion tends to add less that is genuinely new.",
    "The usefulness of another near-identical perspective tapers off.",
  ];
  for (const answer of recognized) {
    assert.equal(hasDiminishingValueReasoning(answer), true, answer);
  }

  const notYetRecognized = [
    "Once everyone is saying effectively the same thing, asking one more judge rarely tells you anything you did not already know.",
    "The panel eventually reaches a point where another similar answer changes very little.",
  ];
  for (const answer of notYetRecognized) {
    assert.equal(hasDiminishingValueReasoning(answer), false, answer);
  }
});

test("mustDiscussTradeoff reaches the grader and respects final stance", () => {
  const expect = { mustMatch: ["disagree|uncertain|risk|novel|different"], mustDiscussTradeoff: true };
  const passing = gradeCase(caseOf(expect), obs({
    answer: "The models disagree, but the incremental benefit falls as their perspectives converge.",
  }));
  assert.equal(passing.passed, true, passing.failures.join("|"));

  for (const answer of [
    "The models disagree, but the duplicate file was deleted after a long day.",
    "The models disagree, and more models improve coverage and accuracy.",
    "Some people call the models redundant, but that is wrong; each adds substantial novel information.",
  ]) {
    const grade = gradeCase(caseOf(expect), obs({ answer }));
    assert.equal(grade.passed, false, answer);
    assert.ok(grade.failures.some((f) => f.startsWith("mustDiscussTradeoff")), answer);
  }
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
    finishReason: "length",
  }));
  assert.equal(clippedWord.passed, false);
  assert.ok(clippedWord.failures.some((f) => f.startsWith("completeness")));

  const clippedTable = gradeCase(caseOf({}), obs({
    answer: "| Metric | Value |\n|---|---|\n| overall confidence | <",
  }));
  assert.equal(clippedTable.passed, false);
  assert.ok(clippedTable.failures.some((f) => f.startsWith("completeness")));
});

/* INPUT / EXPECTED / WHY, so a future reader can tell whether a failure means
 * the detector broke or the fixture was wrong. */
const COMPLETION_CASES = [
  ["Yes, I can", true, "ellipsis and dialogue can end on an auxiliary"],
  ["If necessary, I would", true, "conditional dialogue can end on a modal"],
  ["That is all there is", true, "there-is construction ends on a function word"],
  ["We know what this is", true, "copular complement is complete"],
  ["That is what it was", true, "relative clause is complete"],
  ["This is the person I spoke to", true, "preposition stranding is grammatical"],
  ["This is what the API is for", true, "stranded preposition has a clear antecedent"],
  ["If needed", true, "elliptical phrase"],
  ["When appropriate", true, "elliptical subordinate phrase"],
  ["Although imperfect", true, "deliberate fragment"],
  ["That said", true, "discourse marker"],
  ["Which matters", true, "relative fragment"],
  ["Who knows", true, "complete idiom"],
  ["The service is up", true, "particle ending"],
  ["The request timed out", true, "phrasal verb ending"],
  ["The risk we warned about", true, "stranded preposition with an antecedent"],
  ["The object {a: 1} can", true, "terminal modal is not a hard failure and braces in prose are not code"],
  ["The cache layer should", true, "terminal auxiliary is not a hard failure and backticks are not code"],
  ["The result of the second probe is not", true, "terminal negation is not a hard failure"],
  ["Because latency matters most", true, "full subordinate clause with a content-word ending"],
  ["if the service fails", true, "lowercase keyword in ordinary prose"],
  ["for every model", true, "for-preposition phrase in ordinary prose"],
  ["while the model responds", true, "while-clause in ordinary prose"],
  ["git push origin main", true, "punctuation-free shell command"],
  ["const result = compute(input)", true, "balanced code call"],
  ["AI", true, "short technical token"],
  ["UI", true, "short technical token"],
  ["UX", true, "short technical token"],
  ["DB", true, "short technical token"],
  ["OS", true, "short technical token"],
  ["Go", true, "short technical token"],
  ["R", true, "short technical token"],

  ["The three tradeoffs are latency, cost, and", false, "unfinished enumeration"],
  ["The result depends on", false, "clear incomplete prepositional phrase"],
  ["The following steps are", false, "unfinished enumerative construction"],
  ["You should configure the service to", false, "unfinished infinitive"],
  ["The request failed because", false, "trailing causal subordinator"],
  ["The request failed because it", false, "causal clause stopped after its subject"],
  [String.fromCharCode(96).repeat(3) + "js\nconst answer = 42;", false, "unfinished fenced code block"],
  ['{ "model": "super", "retries":', false, "broken structured JSON"],
  ["const x = a +", false, "dangling binary expression"],
  ["-", false, "empty bullet"],
  ["| Metric | Value |\n|---|---|\n| overall confidence | <", false, "cut table cell"],
  ["The array [1, 2, 3] should be transformed to", false, "stray brackets do not exempt a prose truncation"],
  ["Use <main> because it", false, "stray angle brackets do not exempt prose"],
  ["if (service.failed) {", false, "syntax-shaped conditional with an open brace"],
  ["for (const model of models) {", false, "syntax-shaped loop with an open brace"],
  ["while (running) {", false, "syntax-shaped loop with an open brace"],
];

test("completion uses conservative text evidence when metadata is absent", () => {
  for (const [input, expected, why] of COMPLETION_CASES) {
    assert.equal(isLikelyComplete(input), expected,
      why + "\n  tail: " + JSON.stringify(input.split("\n").pop().slice(-42)));
  }
});

test("completion metadata is inspected and outranks text-only continuation cues", () => {
  const clean = obs({
    answer: "If necessary, I would",
    finishReason: "stop",
    provenance: { requestState: "complete", completion: { assembled: true } },
  });
  const metadata = inspectCompletionMetadata(clean);
  assert.equal(metadata.status, "complete");
  assert.ok(metadata.fields.includes("observation.finishReason"));
  assert.ok(metadata.fields.includes("observation.provenance.requestState"));
  assert.equal(isLikelyComplete(clean.answer, clean), true);
  assert.equal(isLikelyComplete("The answer is and", obs({ finishReason: "stop" })), true,
    "a clean provider stop overrides a text-only continuation cue");
  assert.equal(isLikelyComplete("const x = a +", obs({ finishReason: "stop" })), false,
    "clean metadata cannot bless strong structural corruption");
});

test("incomplete execution metadata vetoes otherwise complete-looking text", () => {
  const variants = [
    obs({ finishReason: "length" }),
    obs({ provenance: { requestState: "aborted" } }),
    obs({ provenance: { completion: { qualified: "incomplete" } } }),
    obs({ abortReason: "turn_deadline" }),
    obs({ outputContract: { state: "incomplete" } }),
    obs({ completion: { complete: false } }),
    obs({ frames: [{ type: "chunk", text: "answer" }, { type: "done", completed: false }] }),
  ];
  for (const observation of variants) {
    const metadata = inspectCompletionMetadata(observation);
    assert.equal(metadata.status, "incomplete");
    assert.equal(isLikelyComplete("A finished answer.", observation), false, JSON.stringify(metadata));
  }
});

/* THE FIXTURE MUST PASS FOR A REASON, NOT FOR A NAME. Swapping the poem's
 * final content word for a hanging function word has to flip the verdict; if
 * it does not, something is keying on the word `fix` itself. */
test("poetry and technical endings do not use a short-word allowlist", () => {
  const poem = (tail) => "Endpoints whisper soft\nLogs scream in silent rows\nRetries spin, nothing works\nCoffee fuels the " + tail;
  for (const contentWord of ["fix", "bug", "dawn", "sky", "cat"]) {
    assert.equal(isLikelyComplete(poem(contentWord)), true, contentWord);
  }
  for (const functionWord of ["was", "not", "of", "can", "to"]) {
    assert.equal(isLikelyComplete(poem(functionWord)), true, functionWord);
  }
  assert.equal(isLikelyComplete(poem("and")), false, "coordinators are explicit continuation markers");
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
    cacheHit({ id: "k1", answer: "Canberra." }),
    cacheHit({ id: "k2", answer: "Sydney." }),
  ];
  const grades = cases.map((c) => gradeCase(c, observations.find((o) => o.id === c.id)));
  assert.equal(summarise(grades, observations).cachePrecision, 0.5);
});

test("hard metric denominators count measured receipts and proven hits independently of dataset size", () => {
  const cases = [
    caseOf({ mustInclude: ["good"] }, { id: "measured" }),
    caseOf({ mustInclude: ["not present"] }, { id: "inconclusive" }),
  ];
  const observations = [
    cacheHit({ id: "measured", answer: "A good cached answer.", costCents: 0.2 }),
    cacheHit({ id: "inconclusive", costCents: 0, error: { code: "transport" } }),
  ];
  const grades = cases.map((testCase) => gradeCase(testCase, observations.find((observation) => observation.id === testCase.id)));
  const metrics = summarise(grades, observations);
  assert.equal(metrics.cases, 2);
  assert.equal(metrics.costMeasuredCases, 2);
  assert.equal(metrics.costCentsPerTurn, 0.1);
  assert.equal(metrics.cachePrecisionCases, 1);
  assert.equal(metrics.cachePrecision, 1);
});

test("cache precision uses the same eligible hit set for numerator and denominator", () => {
  const cases = [
    caseOf({ mustInclude: ["good"] }, { id: "a" }),
    caseOf({ mustInclude: ["good"] }, { id: "b" }),
    caseOf({ mustInclude: ["good"] }, { id: "c" }),
  ];
  const observations = [
    cacheHit({ id: "a", answer: "good" }),
    cacheHit({ id: "b", answer: "good", error: { code: "transport" } }),
    cacheHit({ id: "c", answer: "good" }),
  ];
  const grades = cases.map((testCase) => gradeCase(testCase, observations.find((observation) => observation.id === testCase.id)));
  const metrics = summarise(grades, observations);
  assert.equal(metrics.cachePrecisionCases, 2);
  assert.equal(metrics.cachePrecision, 1);
});

test("cache precision excludes malformed receipts and inconclusive grades from the measured denominator", () => {
  const cases = Array.from({ length: 12 }, (_, index) => caseOf({ mustInclude: ["good"] }, { id: `sample-${index}` }));
  const observations = [
    cacheHit({ id: "sample-0", answer: "good" }),
    cacheHit({ id: "sample-1", answer: "good" }),
    cacheHit({ id: "sample-2", answer: "good", accounting: { schemaVersion: 1, cache: { decision: "hit" } } }),
    cacheHit({ id: "sample-3", answer: "good", validationRunId: "helper-run", validationCaseId: "sample-3", validationPhase: "seed" }),
    ...Array.from({ length: 8 }, (_, index) => cacheHit({
      id: `sample-${index + 4}`,
      error: { code: "transport" },
    })),
  ];
  const grades = cases.map((testCase) => gradeCase(testCase, observations.find((observation) => observation.id === testCase.id)));
  const metrics = summarise(grades, observations);
  assert.equal(metrics.cachePrecisionCases, 2);
  assert.equal(metrics.cachePrecision, 1);
  assert.equal(metrics.cachePrecisionCases < 3, true);
});

test("three valid non-inconclusive cache hits are the complete measured sample", () => {
  const cases = [
    caseOf({ mustInclude: ["good"] }, { id: "valid-a" }),
    caseOf({ mustInclude: ["good"] }, { id: "valid-b" }),
    caseOf({ mustInclude: ["good"] }, { id: "valid-c" }),
  ];
  const observations = cases.map((testCase) => cacheHit({ id: testCase.id, answer: "good" }));
  const grades = cases.map((testCase) => gradeCase(testCase, observations.find((observation) => observation.id === testCase.id)));
  assert.equal(summarise(grades, observations).cachePrecisionCases, 3);
});

test("toolSuccessRate counts tool_result frames, failures included", () => {
  const observations = [obs({
    answer: "x",
    frames: [{ type: "tool_result", ok: true }, { type: "tool_result", ok: false }, { type: "tool_result", ok: true }],
  })];
  const grades = [gradeCase(caseOf({}), observations[0])];
  assert.equal(summarise(grades, observations).toolSuccessRate, 2 / 3);
});

test("factualityPassRate uses explicit model assertions and stays separate from whole-case acceptance", () => {
  const cases = [
    caseOf({ maxLatencyMs: 50 }, {
      id: "f1",
      tags: ["factuality"],
      factualityChecks: {
        modelInvolved: true,
        stableWhy: "stable fixture",
        assertions: [{ id: "fact", claim: "the answer says four", patterns: ["\\bfour\\b"], forbiddenPatterns: [] }],
      },
    }),
    caseOf({}, { id: "x1", tags: ["style"] }),
  ];
  const observations = [obs({ id: "f1", answer: "The answer is four.", latencyMs: 100000 }), obs({ id: "x1", answer: "something else" })];
  const grades = cases.map((c) => gradeCase(c, observations.find((o) => o.id === c.id)));
  const metrics = summarise(grades, observations);
  assert.equal(metrics.factualityPassRate, 1);
  assert.equal(metrics.factualityEligibleModelCases, 1);
  assert.equal(metrics.factualityMeasuredCases, 1);
  assert.equal(metrics.factualityAssertionCount, 1);
  assert.equal(metrics.acceptanceRate, 0.5);
  assert.equal(grades[0].passed, false, "a broad whole-case failure must not erase the factuality result");
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
