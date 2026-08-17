const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EMBED_MODEL,
  EMBED_DIMS,
  MAX_EMBED_CHARS,
  embedRequestBody,
  batchEmbedRequestBody,
  parseEmbedding,
  parseBatchEmbeddings,
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

/* THE BATCH PATH. Its failure mode is not a bad vector, it is a vector
 * attributed to the wrong passage, which no caller can detect. */

test("a batch request carries the model and the width on EVERY entry", () => {
  const body = batchEmbedRequestBody(["one", "two"]);
  assert.equal(body.requests.length, 2);
  for (const request of body.requests) {
    // The batch endpoint does not inherit these from the envelope; an entry
    // missing outputDimensionality comes back at the model's default width and
    // parseEmbedding then discards it as malformed.
    assert.equal(request.model, `models/${EMBED_MODEL}`);
    assert.equal(request.embedContentConfig.outputDimensionality, EMBED_DIMS);
  }
  assert.equal(body.requests[1].content.parts[0].text, "two");
});

test("a full batch parses positionally", () => {
  const json = { embeddings: [{ values: vec(EMBED_DIMS, 0.1) }, { values: vec(EMBED_DIMS, 0.2) }] };
  const out = parseBatchEmbeddings(json, 2);
  assert.equal(out.length, 2);
  assert.equal(out[0][0], 0.1);
  assert.equal(out[1][0], 0.2);
});

test("a SHORT batch is discarded whole, not shifted", () => {
  // The defect being prevented: one dropped embedding would slide every later
  // vector one passage to the left, and the ranking would look fine.
  const json = { embeddings: [{ values: vec(EMBED_DIMS, 0.1) }] };
  assert.deepEqual(parseBatchEmbeddings(json, 3), [null, null, null]);
});

test("a LONG batch is discarded whole too", () => {
  const json = { embeddings: [{ values: vec() }, { values: vec() }, { values: vec() }] };
  assert.deepEqual(parseBatchEmbeddings(json, 2), [null, null]);
});

test("one malformed entry costs only its own position", () => {
  const json = { embeddings: [{ values: vec() }, { values: vec(10) }, { values: vec() }] };
  const out = parseBatchEmbeddings(json, 3);
  assert.ok(Array.isArray(out[0]));
  assert.equal(out[1], null);
  assert.ok(Array.isArray(out[2]));
});

test("a response that is not a batch at all reads as no embeddings", () => {
  assert.deepEqual(parseBatchEmbeddings({}, 2), [null, null]);
  assert.deepEqual(parseBatchEmbeddings({ embeddings: "no" }, 2), [null, null]);
  assert.deepEqual(parseBatchEmbeddings(null, 1), [null]);
});
