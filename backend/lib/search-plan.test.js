const test = require("node:test");
const assert = require("node:assert");
const { parseSearchPlan } = require("./search-plan");

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
