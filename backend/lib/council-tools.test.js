const test = require("node:test");
const assert = require("node:assert/strict");
const { firstWithResults, toolMessages } = require("./council-tools");

// ===== firstWithResults =====

test("takes the first provider that returns results", async () => {
  const calls = [];
  const p = (name, out) => async () => { calls.push(name); return out; };
  const r = await firstWithResults([p("brave", []), p("tavily", { results: [{ url: "a" }] }), p("google", [{ url: "b" }])], "q");
  assert.deepEqual(r, [{ url: "a" }]);
  assert.deepEqual(calls, ["brave", "tavily"], "google must not be called once tavily answered");
});

test("reads both the array shape and the {results} shape", async () => {
  assert.deepEqual(await firstWithResults([async () => [{ url: "a" }]], "q"), [{ url: "a" }]);
  assert.deepEqual(await firstWithResults([async () => ({ results: [{ url: "b" }] })], "q"), [{ url: "b" }]);
});

test("a provider that throws is skipped, not fatal", async () => {
  // One dead API key must not take down search.
  const r = await firstWithResults([
    async () => { throw new Error("401 bad key"); },
    async () => [{ url: "ok" }],
  ], "q");
  assert.deepEqual(r, [{ url: "ok" }]);
});

test("all providers empty or absent yields an empty array", async () => {
  assert.deepEqual(await firstWithResults([async () => [], async () => ({ results: [] }), async () => null], "q"), []);
  assert.deepEqual(await firstWithResults([], "q"), []);
  assert.deepEqual(await firstWithResults(undefined, "q"), []);
});

test("the query reaches every provider it tries", async () => {
  const seen = [];
  await firstWithResults([async (q) => { seen.push(q); return []; }, async (q) => { seen.push(q); return [{ url: "a" }]; }], "OLED burn-in");
  assert.deepEqual(seen, ["OLED burn-in", "OLED burn-in"]);
});

// ===== toolMessages =====

const registry = {
  list: () => [
    { name: "web_search", description: "Search the live web.", schema: { query: {} } },
    { name: "read_url", description: "Fetch one page as text.", schema: { url: {} } },
  ],
};
const BASE = [
  { role: "system", content: "You are an elite AI expert." },
  { role: "user", content: "Which monitor?" },
];

test("keeps the council's own system prompt and appends the catalogue", () => {
  const m = toolMessages(BASE, registry, { round: 1 });
  assert.ok(m[0].content.startsWith("You are an elite AI expert."));
  assert.ok(m[0].content.includes("web_search(query)"));
  assert.ok(m[0].content.includes("read_url(url)"));
});

test("carries the rest of the conversation through untouched", () => {
  const m = toolMessages(BASE, registry, { round: 1 });
  assert.deepEqual(m[1], { role: "user", content: "Which monitor?" });
});

test("a normal round tells the member how to request a tool", () => {
  const m = toolMessages(BASE, registry, { round: 1, isFinalRound: false });
  assert.ok(m[0].content.includes("```tool_call"));
  assert.ok(m[0].content.includes("INSTEAD of answering"));
});

test("THE FINAL ROUND FORBIDS TOOL REQUESTS", () => {
  // Without this a member spends the last round asking for a tool that can
  // never run, and contributes nothing at all — it neither answered nor
  // researched. This is the reason the loop passes isFinalRound.
  const m = toolMessages(BASE, registry, { round: 3, isFinalRound: true });
  assert.ok(m[0].content.includes("final round"));
  assert.ok(m[0].content.includes("Do NOT request"));
  assert.equal(m[0].content.includes("INSTEAD of answering"), false);
});

test("the round number is stated, so a member knows where it is", () => {
  assert.ok(toolMessages(BASE, registry, { round: 2 })[0].content.includes("round 2"));
});

test("no results means no extra turn", () => {
  assert.equal(toolMessages(BASE, registry, { round: 1 }).length, BASE.length);
});

test("results arrive as a USER turn, appended last", () => {
  // Not a late system turn: results are evidence that arrived after the
  // question, and some models weight a trailing system message above the
  // question itself, which is not what a search result is.
  const m = toolMessages(BASE, registry, {
    round: 2,
    toolResults: [{ call: { name: "web_search", args: { query: "OLED" } }, result: { ok: true, summary: "2 results", content: "body" } }],
  });
  const last = m[m.length - 1];
  assert.equal(last.role, "user");
  assert.ok(last.content.includes("web_search"));
  assert.ok(last.content.includes("body"));
  assert.ok(last.content.includes("OLED"));
});

test("a failed result is shown as failed rather than omitted", () => {
  // A member that cannot see the search failed will assume it was never run
  // and ask again, burning a round against the ceiling.
  const m = toolMessages(BASE, registry, {
    round: 2,
    toolResults: [{ call: { name: "read_url", args: { url: "https://x.test" } }, result: { ok: false, summary: "404", content: "" } }],
  });
  assert.ok(m[m.length - 1].content.includes("FAILED"));
  assert.ok(m[m.length - 1].content.includes("404"));
});

test("survives a missing or malformed base message list", () => {
  for (const base of [undefined, [], [{ role: "user", content: "hi" }]]) {
    const m = toolMessages(base, registry, { round: 1 });
    assert.equal(m[0].role, "system");
    assert.ok(m[0].content.includes("web_search"));
  }
});

test("survives an empty registry", () => {
  const m = toolMessages(BASE, { list: () => [] }, { round: 1 });
  assert.equal(m[0].role, "system");
});
