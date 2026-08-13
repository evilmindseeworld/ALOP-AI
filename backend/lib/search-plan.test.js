const test = require("node:test");
const assert = require("node:assert");
const { parseSearchPlan, parseRoutePlan } = require("./search-plan");

test("a single query comes back as a single query", () => {
  assert.deepEqual(parseSearchPlan("iphone 17 pro price uae"), ["iphone 17 pro price uae"]);
});

test("two queries are both kept", () => {
  assert.deepEqual(parseSearchPlan("framework 16 availability 2026\nframework 16 price uae"), [
    "framework 16 availability 2026",
    "framework 16 price uae",
  ]);
});

test("NO means no search", () => {
  for (const r of ["NO", "no", "No.", "  no  "]) {
    assert.equal(parseSearchPlan(r), null, r);
  }
});

test("NO followed by musing is still NO", () => {
  // A model that decides and then muses — "NO\nBut you could search for X" —
  // would otherwise have its musing run as a query, searching for the thing it
  // just said was unnecessary.
  assert.equal(parseSearchPlan("NO\nBut you could search for tcp slow start"), null);
});

test("a query containing the word 'no' survives", () => {
  // Why the NO check matches the whole line and not a substring.
  assert.deepEqual(parseSearchPlan("no fault divorce uk"), ["no fault divorce uk"]);
});

test("list decoration is stripped", () => {
  assert.deepEqual(parseSearchPlan('1. "iphone 17 price"\n2. iphone 17 release date'), [
    "iphone 17 price",
    "iphone 17 release date",
  ]);
  assert.deepEqual(parseSearchPlan("- rust async runtime 2026\n* tokio vs smol"), [
    "rust async runtime 2026",
    "tokio vs smol",
  ]);
  assert.deepEqual(parseSearchPlan("Query 1: nvidia rtx 6090 specs"), ["nvidia rtx 6090 specs"]);
});

test("numbering is stripped before quotes, which is the order that works", () => {
  // Removing quotes first leaves `1.` glued to an opening quote that is no
  // longer there to anchor the pattern, and the number ends up in the query.
  assert.deepEqual(parseSearchPlan('1. "gpu prices"'), ["gpu prices"]);
});

test("duplicates collapse", () => {
  // Two identical fan-outs cost double the provider quota for one result set.
  assert.deepEqual(parseSearchPlan("gpu prices\nGPU Prices"), ["gpu prices"]);
});

test("never more than two queries", () => {
  const plan = parseSearchPlan("one a\ntwo b\nthree c\nfour d");
  assert.equal(plan.length, 2);
});

test("an explanation is not a query", () => {
  // The failure this prevents is silent: the sentence gets sent to a search API
  // and returns results about the explanation rather than the question.
  assert.equal(
    parseSearchPlan("This question does not require a web search because it is about a mathematical concept"),
    null,
  );
});

test("an explanation next to a real query drops only the explanation", () => {
  assert.deepEqual(
    parseSearchPlan("Here is the search that would answer this question the best:\ngpu prices 2026"),
    ["gpu prices 2026"],
  );
});

test("empty and non-string input is no search, not a crash", () => {
  for (const r of ["", "   ", "\n\n", null, undefined, 42, {}]) {
    assert.equal(parseSearchPlan(r), null, String(r));
  }
});

test("a very long line is cut rather than sent whole", () => {
  const long = Array.from({ length: 8 }, () => "supercalifragilistic").join(" ");
  assert.ok(parseSearchPlan(long)[0].length <= 200);
});

/**
 * A MODEL ANSWERING IN ITS NATIVE TOOL-CALL SYNTAX.
 *
 * Reported by the owner as a bad answer in production: a question about the
 * monitor model XG27AQWMG came back "I do not have sufficient information...
 * please clarify". The telemetry for that turn shows the search router ran
 * (`routerReads.search` ok, 4009ms) and the council then answered from memory.
 *
 * The cause is here. gemma-4-26b-a4b, asked to reply with a search query,
 * sometimes replies with the function-call mechanism it has for exactly that:
 *
 *   <|tool_call>call:google_search:search{queries:["ASUS ROG XG27AQWMG specs"]}<tool_call|>
 *
 * That is one line, under ten words, and not "NO", so every existing guard let
 * it through as the query — and the product searched the web for a string of
 * control tokens. Reproduced live on two of four phrasings of the same
 * question, so it is a coin flip rather than a property of the prompt.
 */
test("a native tool-call reply yields the query inside it, not the control tokens", () => {
  const wrapped = '<|tool_call>call:google_search:search{queries:["ASUS ROG Swift XG27AQWMG specs price"]}<tool_call|>';
  assert.deepEqual(parseSearchPlan(wrapped), ["ASUS ROG Swift XG27AQWMG specs price"]);
});

test("the control tokens never reach a search provider", () => {
  // The failure this prevents, stated as the thing that must not happen rather
  // than as the shape that happens to be produced today. Any future wrapper
  // that leaks its own syntax fails here too.
  const wrapped = '<|tool_call>call:google_search:search{queries:["monitor specs"]}<tool_call|>';
  for (const q of parseSearchPlan(wrapped) || []) {
    assert.ok(!/tool_call|call:|queries\s*:/i.test(q), `control syntax reached the query: ${q}`);
  }
});

test("both queries survive a two-query tool call", () => {
  const wrapped = '<|tool_call>call:google_search:search{queries:["a specs","b price"]}<tool_call|>';
  assert.deepEqual(parseSearchPlan(wrapped), ["a specs", "b price"]);
});

test("a tool call with nothing quoted searches for NOTHING rather than for tokens", () => {
  // Dropping is a silent no-search, which is bad. Sending the raw blob is a
  // search for garbage that then reads as a confident answer, which is worse.
  assert.equal(parseSearchPlan('<|tool_call>call:google_search:search{queries:[]}<tool_call|>'), null);
});

test("the unwrapping does not disturb an ordinary reply", () => {
  // The regression that would matter most: a plain query containing a colon or
  // a quoted phrase must be untouched.
  assert.deepEqual(parseSearchPlan("iphone 17 price"), ["iphone 17 price"]);
  assert.deepEqual(parseSearchPlan('"iphone 17" price'), ["iphone 17\" price"]);
  assert.equal(parseSearchPlan("NO"), null);
});

/**
 * THE MODEL ANSWERING INSTEAD OF PLANNING.
 *
 * Measured 2026-08-13 against the search prompt as it then stood: six of nine
 * representative questions came back as the ANSWER rather than as a plan, and
 * every one went to the search providers as the query. The prompt now
 * demonstrates its format and scores 9/9, so these are a second line of
 * defence — kept because the failure is silent. Search still returns something,
 * the council still answers, and nothing in any log says the query was a
 * fragment of an answer.
 */
test("a markdown heading is an answer, not a query", () => {
  assert.equal(parseSearchPlan("### 1. The Competitive Choice"), null);
});

test("LaTeX is an answer, not a query", () => {
  assert.equal(parseSearchPlan("The derivative of $x^2$ is $2x$."), null);
});

test("a prose opener is an answer, not a query", () => {
  for (const line of ["Here is the breakdown", "Sure, I can help", "Certainly! Try this"]) {
    assert.equal(parseSearchPlan(line), null, line);
  }
});

test("the rejections do not eat legitimate queries", () => {
  // The risk in the rule above. A bare number and a short noun phrase are real
  // things people type into a search box, so neither is guessed at.
  assert.deepEqual(parseSearchPlan("iphone 17 price"), ["iphone 17 price"]);
  assert.deepEqual(parseSearchPlan("2026 tax brackets"), ["2026 tax brackets"]);
  assert.deepEqual(parseSearchPlan("XG27AQWMG specs"), ["XG27AQWMG specs"]);
  assert.deepEqual(parseSearchPlan("here comes the sun lyrics"), ["here comes the sun lyrics"]);
});

/**
 * ONE ROUTER CALL, TWO DECISIONS — `parseRoutePlan`, landed 2026-08-13.
 *
 * The turn used to open with two FAST_MODEL calls, a memory check and a search
 * plan. They ran concurrently so the merge saves no time; it saves one
 * OpenRouter REQUEST on every non-greeting turn, which is the resource the
 * account actually runs out of.
 *
 * THE RISK THE MERGE INTRODUCES is that one malformed reply now damages both
 * decisions. Everything below is about containing that, and the asymmetry is
 * the point: a false MEMORY sends a live question to a branch that answers from
 * conversation history and cannot search — a confidently empty answer with no
 * error anywhere. A missed MEMORY merely costs the turn a search it did not
 * need. So MEMORY is hard to say by accident and anything ambiguous degrades to
 * the search decision that existed before the merge.
 */
test("parseRoutePlan — the memory branch", () => {
  assert.deepEqual(parseRoutePlan("MEMORY"), { memory: true, queries: null });
  assert.deepEqual(parseRoutePlan("memory"), { memory: true, queries: null });
  assert.deepEqual(parseRoutePlan("  MEMORY.  "), { memory: true, queries: null });
  // Decorated as a list item, which is how a model volunteers structure.
  assert.deepEqual(parseRoutePlan("- MEMORY"), { memory: true, queries: null });
  // A memory turn never carries queries: the branch returns before search.
  assert.equal(parseRoutePlan("MEMORY\nsomething else").queries, null);
});

test("parseRoutePlan — MEMORY must be the whole first line", () => {
  /* Stricter than how `NO` is read, deliberately. `NO` is honoured anywhere in
   * the reply because a model that decides and then muses has still decided.
   * A stray `MEMORY` mid-reply is far more likely to be the model discussing
   * the word — and acting on it routes a live question to the wrong branch. */
  const notMemory = [
    "memory bandwidth ddr5 2026",           // a legitimate query about memory
    "what is MEMORY in computing",
    "NO\nMEMORY",                            // decided NO first
    "The answer is MEMORY",
    "MEMORY: yes",
  ];
  for (const raw of notMemory) {
    assert.equal(parseRoutePlan(raw).memory, false, raw);
  }
});

test("parseRoutePlan — everything that is not MEMORY routes exactly as before", () => {
  /* The containment property, asserted directly: for any reply that does not
   * open with MEMORY, the queries must be identical to what the two-call
   * version produced, because they come from the same parser on the same text.
   * If this ever diverges, the merge has changed routing rather than merging
   * requests. */
  const replies = [
    "iphone 17 pro price uae",
    "framework 16 availability 2026\nframework 16 price uae",
    "NO",
    "NO\nBut you could search for tcp slow start",
    "no fault divorce uk",
    '1. "iphone 17 price"\n2. iphone 17 release date',
    "- rust async runtime 2026\n* tokio vs smol",
    "This question does not require a web search because the answer is stable.",
    "",
    "memory bandwidth ddr5 2026",
  ];
  for (const raw of replies) {
    assert.deepEqual(parseRoutePlan(raw).queries, parseSearchPlan(raw), raw);
  }
});

test("parseRoutePlan — a non-string reply is not a crash", () => {
  // The router's `.catch` already covers a failed call; this covers a call that
  // succeeded and returned something unexpected.
  for (const bad of [null, undefined, 42, {}]) {
    assert.deepEqual(parseRoutePlan(bad), { memory: false, queries: null });
  }
});
