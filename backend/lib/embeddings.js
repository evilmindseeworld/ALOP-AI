/**
 * The embedding provider this codebase did not have.
 *
 * `user_facts.embedding` has existed since before `migrations/` as
 * `vector(1536)` — OpenAI's width, on a project with no OpenAI key. Nobody
 * chose it; it came in with the ad-hoc schema. Google documents
 * `gemini-embedding-001` for `embedContent`, with configurable output width,
 * so the request keeps the live column at 768 rather than padding vectors to
 * fit a number that was never a decision.
 *
 * WHAT THIS FILE IS AND IS NOT. The request body, the response parse and the
 * width check — the parts that can be checked without a network. The `fetch`
 * lives in server.js, which owns the shared clients, the same split
 * `user-facts.js` documents for the extraction prompt.
 *
 * THE ONE PROPERTY EVERYTHING ELSE DEPENDS ON: a bad embedding must read as
 * *no* embedding, never as a usable one. A truncated or wrongly-shaped vector
 * that reaches the database is not a degraded answer, it is a column that no
 * longer means what the next query assumes, and `<=>` will happily rank
 * against it. `parseEmbedding` returns null for anything it cannot vouch for
 * and every caller treats null as "store the fact without a vector".
 */

/**
 * `gemini-embedding-001` supports `embedContent` and can return 768 values.
 * The model change from `text-embedding-004` keeps the SQL dimension unchanged,
 * but the embedding spaces are not comparable: existing non-null rows need a
 * full re-embed before semantic recall is trustworthy. Do not mix old and new
 * rows in the column during that backfill.
 */
const EMBED_MODEL = "gemini-embedding-001";

/** Not configurable. It is the column's width. */
const EMBED_DIMS = 768;

/**
 * A fact is one sentence (`MAX_FACT_CHARS` is 200), and a query is a user
 * turn, which is not. Cut before spending a request on it: the provider's
 * limit is thousands of tokens, but the first paragraph decides the topic and
 * a whole essay embeds to a blurrier point than its opening does.
 */
const MAX_EMBED_CHARS = 2000;

/** @param {string} text @returns {object} body for `:embedContent`. */
const embedRequestBody = (text) => ({
  model: `models/${EMBED_MODEL}`,
  content: { parts: [{ text: String(text).slice(0, MAX_EMBED_CHARS) }] },
  embedContentConfig: { outputDimensionality: EMBED_DIMS },
});

/**
 * @param {unknown} json whatever the endpoint returned.
 * @returns {number[]|null} a vector of exactly EMBED_DIMS finite numbers, or
 *   null. Null is not an error worth failing a turn over — it costs the fact
 *   its semantic recall and nothing else.
 */
function parseEmbedding(json) {
  const values = json?.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBED_DIMS) return null;
  // NaN and Infinity survive JSON.parse from `1e999` and would poison every
  // distance computed against the row, silently and forever.
  for (const v of values) if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return values;
}

/**
 * pgvector's text input format.
 *
 * Sent as a string rather than a JSON array on purpose: PostgREST casts both,
 * but only one of them has a single unambiguous reading, and this value is
 * being handed to a typed `vector(768)` parameter where a silent
 * misinterpretation shows up as bad ranking rather than as an error.
 */
const toVectorLiteral = (vec) => (Array.isArray(vec) && vec.length ? `[${vec.join(",")}]` : null);

/**
 * MANY STRINGS, ONE ROUND TRIP.
 *
 * `embedRequestBody` is one text per request, which is right for a fact written
 * after the user has been answered and wrong for anything on a path the user is
 * waiting on. Re-ranking N document passages with it is N sequential HTTPS
 * round trips inside a single tool call; `:batchEmbedContents` is one.
 *
 * Each element of `requests` is a whole EmbedContentRequest, model and config
 * included — the batch endpoint does not inherit them from the envelope.
 */
const batchEmbedRequestBody = (texts) => ({
  requests: (Array.isArray(texts) ? texts : []).map((text) => embedRequestBody(text)),
});

/**
 * POSITION IS PART OF THE PAYLOAD HERE, AND THAT IS THE WHOLE DANGER.
 *
 * A single embedding that comes back malformed costs one fact its vector.
 * A batch that comes back the WRONG LENGTH costs every passage after the gap
 * its identity: vector i is silently attributed to passage i, so a short array
 * does not degrade the ranking, it ranks passages against other passages'
 * meanings and reports the result as a match. There is nothing in the response
 * that would let a caller notice.
 *
 * So a length mismatch is not repaired and not partially used. The whole batch
 * reads as no embeddings, and every caller's fallback for that is the lexical
 * ranking it already had.
 *
 * @param {unknown} json whatever the endpoint returned.
 * @param {number} expected how many texts were sent.
 * @returns {Array<number[]|null>} exactly `expected` entries, aligned by index.
 */
function parseBatchEmbeddings(json, expected) {
  const count = Number.isInteger(expected) && expected > 0 ? expected : 0;
  const empty = new Array(count).fill(null);
  const list = json?.embeddings;
  if (!Array.isArray(list) || list.length !== count) return empty;
  // Reuses the single parser so there is one definition of a usable vector.
  return list.map((embedding) => parseEmbedding({ embedding }));
}

module.exports = {
  EMBED_MODEL,
  EMBED_DIMS,
  MAX_EMBED_CHARS,
  embedRequestBody,
  batchEmbedRequestBody,
  parseEmbedding,
  parseBatchEmbeddings,
  toVectorLiteral,
};
