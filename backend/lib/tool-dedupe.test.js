const test = require("node:test");
const assert = require("node:assert/strict");
const { callKey, dedupeCalls } = require("./tool-dedupe");

const same = (a, b) => assert.equal(callKey(a), callKey(b));
const differ = (a, b) => assert.notEqual(callKey(a), callKey(b));

// ===== what must collapse =====

test("identical calls share a key", () => {
  same({ name: "web_search", args: { query: "OLED" } }, { name: "web_search", args: { query: "OLED" } });
});

test("key order does not defeat it", () => {
  same({ name: "s", args: { query: "a", limit: 2 } }, { name: "s", args: { limit: 2, query: "a" } });
});

test("whitespace and case do not defeat it", () => {
  same({ name: "web_search", args: { query: "OLED  burn-in\n" } }, { name: "web_search", args: { query: "oled burn-in" } });
});

test("tool name whitespace and case do not defeat it", () => {
  same({ name: "Web_Search", args: {} }, { name: " web_search ", args: {} });
});

test("nested objects ordered differently share a key", () => {
  same(
    { name: "s", args: { opts: { deep: true, n: 1 }, query: "a" } },
    { name: "s", args: { query: "a", opts: { n: 1, deep: true } } },
  );
});

test("missing args and empty args are the same call", () => {
  same({ name: "s" }, { name: "s", args: {} });
});

// ===== what must NOT collapse =====

test("different tools with identical arguments stay separate", () => {
  differ({ name: "web_search", args: { q: "a" } }, { name: "read_url", args: { q: "a" } });
});

test("whitespace collapses but does not vanish", () => {
  // "a b" and "ab" are different search queries.
  differ({ name: "s", args: { query: "a b" } }, { name: "s", args: { query: "ab" } });
});

test("a string and a number are different arguments", () => {
  differ({ name: "s", args: { limit: "1" } }, { name: "s", args: { limit: 1 } });
});

test("array order matters", () => {
  differ({ name: "s", args: { xs: [1, 2] } }, { name: "s", args: { xs: [2, 1] } });
});

test("null, missing and empty-string are distinguished", () => {
  differ({ name: "s", args: { q: null } }, { name: "s", args: { q: "" } });
  differ({ name: "s", args: { q: null } }, { name: "s", args: {} });
});

test("a malformed call has no usable key", () => {
  assert.equal(callKey(null), "invalid");
  assert.equal(callKey({}), "invalid");
  assert.equal(callKey({ name: 7 }), "invalid");
});

// ===== the union =====

const PROPOSALS = [
  { member: "glm", calls: [{ name: "web_search", args: { query: "OLED burn-in 2026" } }] },
  { member: "kimi", calls: [{ name: "web_search", args: { query: "oled burn-in 2026" } }] },
  { member: "qwen", calls: [{ name: "web_search", args: { query: "QD-OLED vs WOLED" } }] },
  { member: "gemma", calls: [{ name: "read_url", args: { url: "https://rtings.com/monitor" } }] },
];

test("the design's own example: four proposals, three executions", () => {
  const { unique, dropped } = dedupeCalls(PROPOSALS);
  assert.equal(unique.length, 3);
  assert.equal(dropped, 0);
});

test("a shared call records every member that asked for it", () => {
  const { unique } = dedupeCalls(PROPOSALS);
  const shared = unique.find((c) => c.args.query === "OLED burn-in 2026");
  assert.deepEqual(shared.requestedBy, ["glm", "kimi"]);
});

test("the first spelling wins, so the executed args are a real member's", () => {
  const { unique } = dedupeCalls(PROPOSALS);
  const shared = unique.find((c) => c.name === "web_search" && c.requestedBy.includes("glm"));
  assert.equal(shared.args.query, "OLED burn-in 2026");
});

test("the ceiling counts UNIQUE calls, not proposals", () => {
  // Seven members asking the same thing is one call. Counting it as seven would
  // truncate a round that cost one execution — the exact case dedupe exists for.
  const sevenIdentical = Array.from({ length: 7 }, (_, i) => ({
    member: `m${i}`,
    calls: [{ name: "web_search", args: { query: "same" } }],
  }));
  const { unique, dropped } = dedupeCalls(sevenIdentical, 3);
  assert.equal(unique.length, 1);
  assert.equal(dropped, 0);
});

test("genuinely distinct calls past the ceiling are dropped and counted", () => {
  const many = Array.from({ length: 6 }, (_, i) => ({
    member: `m${i}`,
    calls: [{ name: "web_search", args: { query: `q${i}` } }],
  }));
  const { unique, dropped } = dedupeCalls(many, 4);
  assert.equal(unique.length, 4);
  assert.equal(dropped, 2);
});

test("a member already over the ceiling can still join an existing call", () => {
  // Dedupe is checked before the ceiling, so a late member asking for something
  // already scheduled is free rather than dropped.
  const { unique, dropped } = dedupeCalls(
    [
      { member: "a", calls: [{ name: "s", args: { q: "1" } }] },
      { member: "b", calls: [{ name: "s", args: { q: "2" } }] },
      { member: "c", calls: [{ name: "s", args: { q: "1" } }] },
    ],
    2,
  );
  assert.equal(unique.length, 2);
  assert.equal(dropped, 0);
  assert.deepEqual(unique[0].requestedBy, ["a", "c"]);
});

test("empty and malformed input yields an empty union rather than throwing", () => {
  for (const input of [undefined, null, [], [null], [{}], [{ member: "a" }], [{ member: "a", calls: [null, {}] }]]) {
    const { unique } = dedupeCalls(input);
    assert.deepEqual(unique, [], JSON.stringify(input));
  }
});

test("one member listed once however many times it repeats a call", () => {
  const { unique } = dedupeCalls([
    { member: "a", calls: [{ name: "s", args: { q: "1" } }, { name: "s", args: { q: "1" } }] },
  ]);
  assert.equal(unique.length, 1);
  assert.deepEqual(unique[0].requestedBy, ["a"]);
});
