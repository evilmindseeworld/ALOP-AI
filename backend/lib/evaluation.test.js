const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { validateCase, loadDataset, gradeCase, summarise, percentile, citationsIn, isLikelyComplete, hasDiminishingValueReasoning } = require("./evaluation");

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
 * INFORMATION? Everything here is judged against that sentence. */
const TRADEOFF_CASES = [
  // --- the relation, in many different wordings ---
  ["The new model is essentially a replica of the existing ones, so the marginal gain is negligible.",
    true, "similarity qualifier on the subject plus an informational value that is negligible"],
  ["Because they share the same biases and cutoffs, extra models add little new information.",
    true, "addition qualifier plus `little` bound to `information`"],
  ["An extra model repeats the same perspective while adding latency, so the value it contributes falls.",
    true, "repetition of a perspective, and the value explicitly falls"],
  ["Duplicated reasoning adds cost with very little novelty for the panel.",
    true, "redundancy stated of the subject itself"],
  ["The incremental benefit falls as the models become more similar.",
    true, "the paraphrase that the previous matcher missed: benefit + falls, models + more similar"],
  ["Marginal value approaches zero as the perspectives converge.",
    true, "convergence of perspectives with value going to zero"],
  ["Repeated perspectives contribute progressively less new evidence.",
    true, "repetition plus less informational evidence"],
  ["Additional replicas add negligible marginal information to the panel.",
    true, "addition plus negligible information"],
  ["An additional seat repeats an existing perspective while adding latency.",
    true, "redundancy bound to the added seat"],
  ["If the new model is just a replica of the existing five (same data, same cut-offs, same biases), the marginal gain is negligible and the extra latency, cost, and complexity are not justified.",
    true, "the shipped question's own subject matter, phrased as a reader would"],
  ["The first answers disagree, so the gain diminishes as more models repeat the same view.",
    true, "gain diminishes as models repeat"],
  ["When models are uncertain, an extra model adds little new information and limited value.",
    true, "extra model, little information"],
  ["Different perspectives help, but the same biases mean little incremental value from another vote.",
    true, "same biases, little value"],
  ["Risk is lower when answers differ; duplicated reasoning adds cost without useful novelty.",
    true, "duplicated reasoning bound to the subject"],

  // --- negation must not read as diminishment ---
  ["Extra models are not redundant at all; every one of them adds real value.",
    false, "the redundancy claim is NEGATED — this asserts the opposite relation"],
  ["You should ask more models, not fewer, whenever the stakes are high.",
    false, "opposite conclusion; `not` is a negator, never evidence of diminishing value"],
  ["These models should not be trusted blindly by anyone on the team.",
    false, "`not` near a subject, on an entirely unrelated point"],
  ["The marginal gain from another model is not negligible on hard questions.",
    false, "explicitly denies the diminishing relation"],

  // --- one leg of the relation missing ---
  ["Running more models costs more money and uses a larger compute budget for every request.",
    false, "cost only: money is not informational value"],
  ["Adding more models increases latency and slows the response for every user.",
    false, "latency only, with no informational-value relation"],
  ["The models disagree, and more models improve coverage and accuracy.",
    false, "benefits only, nothing diminishing"],
  ["Additional models provide better coverage, higher accuracy and greater diversity of perspectives.",
    false, "benefits only"],
  ["The answers are the same length as the ones we measured last week.",
    false, "similarity with no value claim at all"],

  // --- vocabulary present, relation absent ---
  ["The models disagree, but the duplicate file was deleted after a long day.",
    false, "`duplicate` modifies a file, not the seats"],
  ["The team saw a large gain in revenue after the pricing change shipped.",
    false, "a value word with no subject and no decrease"],
  ["Returns on the marketing spend diminished sharply after the third week.",
    false, "diminishing returns about marketing, not about models"],
];

test("model-disagreement grading checks the relationship, not a magic phrase", () => {
  for (const [answer, expected, why] of TRADEOFF_CASES) {
    assert.equal(hasDiminishingValueReasoning(answer), expected, `${why}\n  answer: ${answer}`);
  }
});

test("mustDiscussTradeoff reaches the grader and names itself on failure", () => {
  const expect = { mustMatch: ["disagree|uncertain|risk|novel|different"], mustDiscussTradeoff: true };
  const passing = gradeCase(caseOf(expect), obs({
    answer: "The first answers disagree, so the gain diminishes as more models repeat the same view.",
  }));
  assert.equal(passing.passed, true, passing.failures.join("|"));

  for (const answer of [
    "The models disagree, but the duplicate file was deleted after a long day.",
    "The models disagree, and more models improve coverage and accuracy.",
    "Extra models are not redundant at all; different answers each add real value.",
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
  }));
  assert.equal(clippedWord.passed, false);
  assert.ok(clippedWord.failures.some((f) => f.startsWith("completeness")));

  const clippedTable = gradeCase(caseOf({}), obs({
    answer: "| Metric | Value |\n|---|---|\n| overall confidence | <",
  }));
  assert.equal(clippedTable.passed, false);
  assert.ok(clippedTable.failures.some((f) => f.startsWith("completeness")));
});

/* Long enough to clear the 80-character floor the mid-word stub check uses,
 * so each fixture below is judged on its ENDING and nothing else. */
const BODY = "This is a substantive answer about council design and model selection that runs past the length floor. ";

/* INPUT / EXPECTED / WHY, so a future reader can tell whether a failure means
 * the detector broke or the fixture was wrong. */
const COMPLETION_CASES = [
  // --- legitimately complete ---
  ["Endpoints whisper soft\nLogs scream in silent rows\nRetries spin, nothing works\nCoffee fuels the fix",
    true, "poetry: no punctuation, and `fix` is a content word that can end an utterance"],
  [BODY + "\nThe morning breaks and lifts the empty sky",
    true, "poetry: three-letter content-word tail is not a hanging tail"],
  [BODY + "\n## The Future of AI",
    true, "markdown heading ending on an initialism"],
  [BODY + "\n- Call the public API",
    true, "bullet ending on an initialism"],
  [BODY + "\ngit push origin main",
    true, "shell command, no terminal punctuation, content-word tail"],
  [BODY + "\nconst result = compute(input)",
    true, "code line closing its own call"],
  [BODY + "\nThink different",
    true, "slogan: deliberate fragment, content-word tail"],
  [BODY + "\n# Getting started with the app",
    true, "markdown heading"],
  [BODY + "\nBecause latency matters most",
    true, "requested terse fragment: subordinator has a full clause after it"],
  [BODY + "\nThe council streams the synthesised answer to every connected reader",
    true, "punctuation-free prose ending on a noun"],
  [BODY + "\n- Cache the compiled result",
    true, "list item ending on a content word"],
  [BODY + "\nThe root cause was a race condition, not a bug",
    true, "three-letter content tail after a comma clause"],
  [BODY + "\nAfter the restart the service came back up",
    true, "particle `up` legitimately ends a clause and must not read as a preposition"],
  [BODY + "\nOf all the constraints, latency matters most",
    true, "bare comparative legitimately ends a clause"],
  [BODY + "\nreturn fix",
    true, "code-shaped line, content-word tail"],

  // --- genuinely truncated ---
  [BODY + "\nThe primary reason this architecture fails is because it",
    false, "subordinate clause opened by `because` never got a predicate"],
  [BODY + "\nYou should configure the service to",
    false, "infinitival `to` with no verb"],
  [BODY + "\nThree main tradeoffs are latency, cost, and",
    false, "coordinator with no third conjunct"],
  [BODY + "\nThe result of the second probe is not",
    false, "negation particle with nothing negated (three letters, so length alone missed it)"],
  [BODY + "\nThe reason the second attempt failed was",
    false, "copula with no complement"],
  [BODY + "\nThe next thing the team should do is add",
    false, "copula plus bare transitive verb whose object never arrived"],
  [BODY + "\nEvery seat that answered in time has",
    false, "auxiliary with no participle"],
  [BODY + "\nThe only component that reads this file can",
    false, "modal with no verb"],
  [BODY + "\nDepending on the provider the request may",
    false, "modal with no verb"],
  ["```js\nconst answer = 42;",
    false, "unbalanced code fence"],
  [BODY + '\n{ "model": "super", "retries":',
    false, "JSON object cut after a key"],
  [BODY + "\nconst total = price *",
    false, "binary operator missing its right operand"],
  [BODY + "\n-",
    false, "list marker with no item"],
  [BODY + "\nThe answer depends entirely on the number of",
    false, "preposition with no object"],
  [BODY + "\n- The first consideration is the",
    false, "determiner with no noun, inside a bullet"],
  ["A replica adds operational cost and consistency concerns, but at this traffic level it gives you mo",
    false, "stream stopped mid-word; `mo` is not an English word"],
  ["| Metric | Value |\n|---|---|\n| overall confidence | <",
    false, "table row cut inside a cell"],
  ["The rollout should begin with a controlled baseline and",
    false, "coordinator with no second conjunct, below the length floor"],

  // --- prose that merely CONTAINS code punctuation earns no exemption ---
  [BODY + "\nThe array [1, 2, 3] should be transformed to",
    false, "square brackets in prose must not buy a structural exemption"],
  [BODY + "\nUse <main> because it",
    false, "angle brackets in prose must not buy a structural exemption"],
  [BODY + "\nThe object {a: 1} can",
    false, "braces in prose must not buy a structural exemption"],
  [BODY + "\nThe `cache` layer should",
    false, "backticks in prose must not buy a structural exemption"],
];

test("completion is judged on grammatical shape, not on tail length", () => {
  for (const [input, expected, why] of COMPLETION_CASES) {
    assert.equal(isLikelyComplete(input), expected,
      `${why}\n  tail: ${JSON.stringify(input.split("\n").pop().slice(-42))}`);
  }
});

/* THE FIXTURE MUST PASS FOR A REASON, NOT FOR A NAME. Swapping the poem's
 * final content word for a hanging function word has to flip the verdict; if
 * it does not, something is keying on the word `fix` itself. */
test("the poetry fixture passes on word class, not on the word", () => {
  const poem = (tail) => `Endpoints whisper soft\nLogs scream in silent rows\nRetries spin, nothing works\nCoffee fuels the ${tail}`;
  for (const contentWord of ["fix", "bug", "dawn", "sky", "cat"]) {
    assert.equal(isLikelyComplete(poem(contentWord)), true, `${contentWord} is a content word`);
  }
  for (const functionWord of ["was", "not", "and", "of", "can"]) {
    assert.equal(isLikelyComplete(poem(functionWord)), false, `${functionWord} still owes a complement`);
  }
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
