const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseFacts,
  newFacts,
  factsBlock,
  factKey,
  FACTS_PROMPT,
  MAX_FACT_CHARS,
  MAX_FACTS_PER_TURN,
} = require("./user-facts");

/**
 * A stored fact is replayed at system position in every future conversation.
 * That makes this the highest-leverage model output in the app: a title is
 * wrong in a sidebar for one chat, a bad fact conditions every answer the user
 * ever gets. So the interesting cases are all "the model did not follow the
 * prompt", plus the two that decide whether a fact is written at all.
 */

// ===== the shapes a model actually returns =====

test("one fact per line, markers stripped", () => {
  assert.deepEqual(parseFacts("- The user is a teacher in Dubai.\n- They are building an AI classroom app."), [
    "The user is a teacher in Dubai.",
    "They are building an AI classroom app.",
  ]);
});

test("numbered and 'Fact:' prefixes come off", () => {
  assert.deepEqual(parseFacts("1. The user writes React and Node.\nFact 2: The user prefers short answers."), [
    "The user writes React and Node.",
    "The user prefers short answers.",
  ]);
});

test("NONE means nothing was found, in the shapes models write it", () => {
  for (const raw of ["NONE", "none", "None.", "N/A", "no facts", "Nothing", "- NONE"]) {
    assert.deepEqual(parseFacts(raw), [], `expected no facts from ${JSON.stringify(raw)}`);
  }
});

test("a fact that merely contains the word none survives", () => {
  assert.deepEqual(parseFacts("The user has none of the paid plans at work."), [
    "The user has none of the paid plans at work.",
  ]);
});

test("a refusal or preamble is not a fact", () => {
  assert.deepEqual(parseFacts("I'm sorry, I cannot help with that."), []);
  assert.deepEqual(parseFacts("The user asked about renewing a trade licence."), []);
});

test("non-string input yields nothing rather than throwing", () => {
  for (const raw of [null, undefined, 42, {}, []]) assert.deepEqual(parseFacts(raw), []);
});

test("a paragraph-length line is refused, not truncated", () => {
  const long = "The user " + "x".repeat(MAX_FACT_CHARS);
  assert.deepEqual(parseFacts(long), []);
});

test("more than the per-turn cap is cut off", () => {
  const many = Array.from({ length: 12 }, (_, i) => `The user owns cat number ${i}.`).join("\n");
  assert.equal(parseFacts(many).length, MAX_FACTS_PER_TURN);
});

test("facts in non-Latin scripts survive", () => {
  assert.deepEqual(parseFacts("المستخدم يعمل معلما في دبي\n用户使用简体中文提问"), [
    "المستخدم يعمل معلما في دبي",
    "用户使用简体中文提问",
  ]);
});

// ===== deduplication =====

test("an already-known fact is not written again", () => {
  const existing = ["The user is a teacher in Dubai."];
  assert.deepEqual(newFacts(["the user is a teacher in dubai"], existing), []);
});

test("trailing punctuation and spacing do not make a new fact", () => {
  assert.equal(factKey("The user is a teacher in Dubai."), factKey("the  user is a teacher in Dubai"));
});

test("duplicates inside one batch collapse", () => {
  assert.deepEqual(newFacts(["The user writes Go.", "the user writes go"]), ["The user writes Go."]);
});

test("a genuinely new fact goes through", () => {
  assert.deepEqual(newFacts(["The user writes Go."], ["The user is a teacher in Dubai."]), [
    "The user writes Go.",
  ]);
});

/* Paraphrase is NOT deduplicated, and that is a decision rather than a gap. It
 * survived the arrival of embeddings on purpose — a wrong merge deletes
 * something the user actually said, where a wrong ranking only costs one turn.
 * Asserted so the next person meets the decision instead of filing it as a
 * bug. See factKey's header. */
test("a paraphrase is stored separately, deliberately", () => {
  assert.deepEqual(newFacts(["The user is based in Dubai."], ["The user works in Dubai."]), [
    "The user is based in Dubai.",
  ]);
});

// ===== injection =====

test("no facts renders as empty string, so the caller needs no branch", () => {
  assert.equal(factsBlock([]), "");
  assert.equal(factsBlock(), "");
});

test("facts render as a labelled list", () => {
  const block = factsBlock(["The user writes Go."]);
  assert.match(block, /- The user writes Go\./);
  assert.match(block, /do not recite it back/i);
});

// ===== the prompt itself =====

test("the prompt gives the model a way to say nothing", () => {
  assert.match(FACTS_PROMPT, /NONE/);
});

test("the prompt asks for standalone sentences, not topic summaries", () => {
  assert.match(FACTS_PROMPT, /standalone/i);
  assert.match(FACTS_PROMPT, /[Nn]ot the topic/);
});
