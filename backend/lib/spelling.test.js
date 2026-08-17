const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { normaliseForRouting, correctionFor, editDistance, ROUTER_VOCABULARY } = require("./spelling");

const fix = (text) => normaliseForRouting(text).text;

test("a mistyped router keyword is corrected, so the volatile question searches", () => {
  assert.equal(fix("whats the latst version of node"), "whats the latest version of node");
  assert.equal(fix("curent ceo of openai"), "current ceo of openai");
  assert.equal(fix("recomend a vacuum"), "recommend a vacuum");
  assert.equal(fix("what did we discus earlier"), "what did we discuss earlier");
  assert.equal(fix("give me a detaild explantion"), "give me a detailed explanation");
});

test("a transposition costs one edit, because it is the commonest typo there is", () => {
  assert.equal(editDistance("laetst", "latest", 2), 1);
  assert.equal(fix("laetst news"), "latest news");
});

test("nothing under five characters is corrected, and that rule prevents a wrong answer", () => {
  // `and` is one edit from `add`. Correcting it would let the arithmetic parser
  // read "average of 4 and 10" as 4 + 10 and answer 14 to a question it should
  // have refused.
  assert.equal(fix("average of 4 and 10"), "average of 4 and 10");
  assert.equal(fix("3 x 8"), "3 x 8");
  assert.equal(correctionFor("and", new Set(ROUTER_VOCABULARY), ROUTER_VOCABULARY), null);
});

test("a correctly spelled vocabulary word is never touched", () => {
  for (const word of ROUTER_VOCABULARY) {
    assert.equal(fix(`tell me the ${word} thing`), `tell me the ${word} thing`, word);
  }
});

test("product names and SKUs are left exactly as typed", () => {
  // This is the failure a general spell checker would introduce: "correcting" a
  // model designation into an English word, on the one question shape that
  // depends on it reaching the search planner intact.
  assert.equal(fix("the price of the xg27aqwmg"), "the price of the xg27aqwmg");
  assert.equal(fix("is tienco s7 or s9 beter for mopping"), "is tienco s7 or s9 better for mopping");
  assert.equal(fix("15ixr10 legion 5 rtx 5060"), "15ixr10 legion 5 rtx 5060");
});

test("case, punctuation and spacing survive, because two other decisions read them", () => {
  // hasNamedEntity reads capitalisation and classifyRequest counts words.
  assert.equal(fix("Latst news, today?"), "Latest news, today?");
  assert.equal(fix("  spaced   out  "), "  spaced   out  ");
  assert.equal(normaliseForRouting("").text, "");
});

test("an ambiguous word is left alone rather than guessed at", () => {
  const vocabulary = ["recent", "recept"];
  assert.equal(correctionFor("recept", new Set(vocabulary), vocabulary), null, "exact match is never corrected");
  assert.equal(correctionFor("recemt", new Set(vocabulary), vocabulary), null, "equally close to both — refuse");
});

test("the corrections are reported, so the log says what the router actually read", () => {
  const out = normaliseForRouting("the latst pricce");
  assert.deepEqual(out.corrections, [{ from: "latst", to: "latest" }, { from: "pricce", to: "price" }]);
});

/* ── wiring ──────────────────────────────────────────────────────────────── */

const SERVER = readFileSync(join(__dirname, "..", "server.js"), "utf8");

test("every routing decision reads the corrected copy", () => {
  for (const call of [
    "tryArithmetic(routingText)",
    "wantsDetailedAnswer(routingText)",
    "classifyRequest(routingText,",
    "routeByRule(routingText,",
    "planTurn(routingText,",
  ]) {
    assert.ok(SERVER.includes(call), `${call} is not wired to the corrected copy`);
  }
});

test("THE CORRECTED COPY NEVER BECOMES THE QUESTION A MODEL IS ASKED", () => {
  // The whole safety of this module rests on this. Answering a rewritten
  // question is answering a question the user did not ask, and it would look
  // completely healthy in every log.
  assert.ok(SERVER.includes("{ role: 'user', content: pv.value }"), "an answer prompt stopped using the user's own words");
  assert.ok(!/content: routingText/.test(SERVER), "routingText reached a prompt body");
  assert.ok(!/question: routingText/.test(SERVER), "routingText reached a stored question");
});
