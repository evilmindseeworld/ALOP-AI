const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EMBED_MODEL,
  EMBED_DIMS,
  MAX_EMBED_CHARS,
  embedRequestBody,
  parseEmbedding,
  toVectorLiteral,
} = require("./embeddings");

const vec = (n = EMBED_DIMS, fill = 0.1) => Array(n).fill(fill);

test("the request carries the text and the model", () => {
  const body = embedRequestBody("I work in Dubai");
  assert.equal(body.content.parts[0].text, "I work in Dubai");
  assert.equal(body.model, `models/${EMBED_MODEL}`);
  assert.equal(body.embedContentConfig.outputDimensionality, EMBED_DIMS);
});

test("a long query is cut before it is sent", () => {
  const body = embedRequestBody("x".repeat(MAX_EMBED_CHARS + 500));
  assert.equal(body.content.parts[0].text.length, MAX_EMBED_CHARS);
});

test("a well-formed response parses to a vector of the column's width", () => {
  const values = vec();
  assert.deepEqual(parseEmbedding({ embedding: { values } }), values);
});

test("a vector of the WRONG width is refused", () => {
  // The failure this exists for: swapping the model without moving the column
  // returns 1536 or 3072 numbers that are individually valid. Inserting them
  // fails loudly, but ranking against a mixed column would not.
  for (const n of [EMBED_DIMS - 1, EMBED_DIMS + 1, 1536, 0]) {
    assert.equal(parseEmbedding({ embedding: { values: vec(n) } }), null, `width ${n} was accepted`);
  }
});

test("a vector containing anything that is not a finite number is refused", () => {
  for (const bad of [NaN, Infinity, -Infinity, null, "0.1", undefined]) {
    const values = vec();
    values[400] = bad;
    assert.equal(parseEmbedding({ embedding: { values } }), null, `${String(bad)} was accepted`);
  }
});

test("every shape that is not a response at all reads as no embedding", () => {
  for (const junk of [null, undefined, {}, "", 0, { embedding: {} }, { embedding: { values: "abc" } }, { error: { message: "quota" } }]) {
    assert.equal(parseEmbedding(junk), null, `${JSON.stringify(junk)} was accepted`);
  }
});

test("the literal is pgvector's own text format", () => {
  assert.equal(toVectorLiteral([1, -0.5, 0]), "[1,-0.5,0]");
});

test("nothing to send reads as null rather than an empty vector", () => {
  // '[]' is a valid string and an invalid vector(768); it would reach Postgres
  // and fail there rather than here.
  for (const empty of [[], null, undefined, "nope"]) {
    assert.equal(toVectorLiteral(empty), null);
  }
});
