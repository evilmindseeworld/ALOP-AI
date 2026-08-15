'use strict';

/**
 * LEXICAL AND VECTOR RETRIEVAL FAIL IN OPPOSITE DIRECTIONS, SO RUN BOTH.
 *
 * `readUserFacts` already runs two reads and concatenates them — nearest first,
 * newest filling the rest — and the second read exists to paper over a hole
 * rather than to retrieve anything: a row written while the embedding provider
 * was refusing has a null vector and is invisible to `match_user_facts`
 * forever. That is a fallback, not hybrid retrieval, and it has a defect of its
 * own: concatenation means a barely-relevant nearest neighbour outranks an
 * exact-token match that the vector search could never have found.
 *
 * WHAT EACH SIDE IS FOR:
 *
 *   VECTOR   finds a fact that MEANS the same thing in different words. It
 *            cannot find a rare literal token: "AC-4471" and "AC-4477" embed to
 *            nearly the same point and are different things.
 *   LEXICAL  finds the exact token — an identifier, a filename, a flag, a
 *            surname. It cannot find a paraphrase.
 *
 * FUSED BY RECIPROCAL RANK, not by score. The two sides produce numbers that
 * are not comparable — a cosine distance and a `ts_rank` — and any attempt to
 * put them on one scale needs a weight nobody can calibrate. Reciprocal rank
 * fusion uses only the ORDER each retriever produced, which is the part both
 * are actually good at. A row found by BOTH is ranked above one found by
 * either, which is the property that makes fusion worth doing at all.
 */

/**
 * @param {object} params
 * @param {Array} params.vector   rows, best first, from the vector search
 * @param {Array} params.lexical  rows, best first, from the text search
 * @param {(row: any) => string} [params.keyOf]  what makes two rows the same row
 * @param {number} [params.k]     the RRF constant
 * @param {number} [params.limit]
 * @param {{vector?: number, lexical?: number}} [params.weights]
 */
function fuse({
  vector = [],
  lexical = [],
  keyOf = (row) => (typeof row === 'string' ? row : row?.id ?? row?.fact ?? JSON.stringify(row)),
  /* THE STANDARD CONSTANT, AND WHAT IT CONTROLS. 60 flattens the difference
   * between rank 1 and rank 2 (1/61 vs 1/62) so that agreement between the two
   * retrievers matters more than either one's confidence in its own first
   * place. A small k does the opposite and lets one retriever's top hit win
   * every time, which is the behaviour fusion exists to avoid. */
  k = 60,
  limit = 10,
  weights = {},
} = {}) {
  const wVector = Number.isFinite(weights.vector) ? weights.vector : 1;
  const wLexical = Number.isFinite(weights.lexical) ? weights.lexical : 1;

  const scores = new Map();
  const rows = new Map();
  const sources = new Map();

  const add = (list, weight, label) => {
    list.forEach((row, index) => {
      if (row === null || row === undefined) return;
      const key = keyOf(row);
      if (!key) return;
      scores.set(key, (scores.get(key) || 0) + weight / (k + index + 1));
      /* FIRST WRITER WINS on the row itself. The vector side is passed first
       * and carries the distance the caller may want to report; the lexical row
       * for the same fact is the same fact. */
      if (!rows.has(key)) rows.set(key, row);
      sources.set(key, [...(sources.get(key) || []), label]);
    });
  };

  add(vector, wVector, 'vector');
  add(lexical, wLexical, 'lexical');

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, score]) => ({
      row: rows.get(key),
      score,
      /* Which retrievers found it, in the order they ran. Reported because
       * "the vector search alone found this" and "both found it" are different
       * amounts of evidence, and the difference is invisible in the score. */
      via: sources.get(key),
    }));
}

/**
 * A PostgreSQL `websearch_to_tsquery` string from a user's question.
 *
 * The question is not a query. Sent whole it produces a tsquery that ANDs every
 * word, which matches nothing on a table of one-sentence facts. What is worth
 * looking up lexically is the part a vector search would lose: the rare
 * literal tokens — identifiers, filenames, versions, capitalised names.
 *
 * Returns '' when the question has no such token, and the caller must treat
 * that as "do not run the lexical side" rather than as an empty query, which
 * matches everything.
 */
const RARE_TOKEN = /\b(?:[A-Z][A-Za-z0-9]*[-_/][A-Za-z0-9-_/]+|[A-Za-z]+\d[\w.-]*|[A-Z]{2,}\d*|[\w-]+\.[a-z]{2,4}\b|v?\d+\.\d+(?:\.\d+)?)\b/g;

function lexicalQuery(question, { max = 6 } = {}) {
  const text = String(question || '');
  const rare = [...new Set(text.match(RARE_TOKEN) || [])].slice(0, max);
  if (!rare.length) return '';
  /* OR, not AND. Any one of these tokens appearing in a stored fact is a hit
   * worth having; requiring all of them reproduces the "matches nothing"
   * failure this function exists to avoid. Quoted so that a token containing
   * punctuation cannot be read as tsquery syntax. */
  return rare.map((token) => `"${token.replace(/"/g, '')}"`).join(' or ');
}

module.exports = { fuse, lexicalQuery };
