const test = require("node:test");
const assert = require("node:assert/strict");
const { readSonar, MAX_SOURCES } = require("./perplexity");

/**
 * The failure this file exists for is not a crash.
 *
 * Sonar has shipped two citation shapes. Reading only `search_results` against
 * a response that carries `citations` returns a confident written answer with
 * zero sources attached — indistinguishable, downstream and to the user, from a
 * model that made it up. So both shapes are asserted, and so is the precedence
 * between them.
 */

const answered = (content, rest = {}) => ({ choices: [{ message: { content } }], ...rest });

test("the newer shape: structured results with titles and dates", () => {
  const out = readSonar(
    answered("Dubai rents rose 18% year on year.", {
      search_results: [{ title: "Q2 rental index", url: "https://example.com/a", date: "2026-07-01" }],
    }),
    (d) => String(d || ""),
  );
  assert.equal(out.answer, "Dubai rents rose 18% year on year.");
  assert.deepEqual(out.results, [{ title: "Q2 rental index", url: "https://example.com/a", date: "2026-07-01" }]);
});

test("the older shape: bare citation URLs still become sources", () => {
  const out = readSonar(answered("Something true.", { citations: ["https://example.com/a", "https://example.com/b"] }));
  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].url, "https://example.com/a");
  assert.equal(out.results[0].title, "");
});

test("structured results win when a response carries both", () => {
  const out = readSonar(
    answered("x", {
      search_results: [{ title: "Real", url: "https://example.com/real" }],
      citations: ["https://example.com/stale"],
    }),
  );
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].url, "https://example.com/real");
});

test("an answer with no citations is an answer, not a failure", () => {
  const out = readSonar(answered("No sources returned."));
  assert.equal(out.answer, "No sources returned.");
  assert.deepEqual(out.results, []);
});

test("junk in, empty out — never a throw", () => {
  for (const bad of [null, undefined, "", 42, [], { choices: "nope" }, { citations: "not an array" }]) {
    const out = readSonar(bad);
    assert.equal(out.answer, "");
    assert.deepEqual(out.results, []);
  }
});

test("entries with no URL are dropped rather than pushed as undefined", () => {
  const out = readSonar(answered("x", { search_results: [{ title: "No link" }, { title: "Good", url: "https://example.com/g" }] }));
  assert.deepEqual(out.results.map((r) => r.url), ["https://example.com/g"]);
  const bare = readSonar(answered("x", { citations: [null, "", "https://example.com/g", 7] }));
  assert.deepEqual(bare.results.map((r) => r.url), ["https://example.com/g"]);
});

test("source count is capped", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ title: `t${i}`, url: `https://example.com/${i}` }));
  assert.equal(readSonar(answered("x", { search_results: many })).results.length, MAX_SOURCES);
  assert.equal(readSonar(answered("x", { citations: many.map((m) => m.url) })).results.length, MAX_SOURCES);
});

/* An undated source must say so rather than carry a guessed date — the same
 * rule every other provider goes through normalizeDate for. Asserted here
 * because this parser is one `|| ""` away from inventing one. */
test("dates go through the shared normaliser, and an unparseable one is empty", () => {
  const out = readSonar(answered("x", { search_results: [{ url: "https://example.com/a", date: "last tuesday" }] }), () => "");
  assert.equal(out.results[0].date, "");
});
