/**
 * The embedding provider this codebase did not have.
 *
 * `user_facts.embedding` has existed since before `migrations/` as
 * `vector(1536)` — OpenAI's width, on a project with no OpenAI key. Nobody
 * chose it; it came in with the ad-hoc schema. `GOOGLE_API_KEY` is set and
 * already pays for vision, so the provider question answers itself, and 013
 * narrows the column to Google's 768 rather than padding vectors to fit a
 * number that was never a decision.
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
 * `text-embedding-004`, 768 dimensions, is Google's current general-purpose
 * text embedding and the width 013 sets the column to. If this model is ever
 * changed, the column width and every stored row change with it — a vector
 * from a different model in the same column is not comparable to its
 * neighbours, and nothing at the SQL layer can see that.
 */
const EMBED_MODEL = "text-embedding-004";

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

module.exports = {
  EMBED_MODEL,
  EMBED_DIMS,
  MAX_EMBED_CHARS,
  embedRequestBody,
  parseEmbedding,
  toVectorLiteral,
};
