'use strict';

/**
 * WHICH MODEL PRODUCED THIS VECTOR, AND IS IT STILL COMPARABLE TO THE OTHERS?
 *
 * AGENTS.md states the invariant: every row in `user_facts.embedding` must come
 * from the same model, because `<=>` will rank across two incomparable
 * geometries WITHOUT ERRORING. The failure is bad memory, not a stack trace.
 * Until migration 021 nothing in a row recorded which model wrote it, so that
 * invariant was held by a constant in `embeddings.js` and by whoever remembered
 * it — and it has already been broken once at the column level, which is what
 * 013 exists to repair.
 *
 * WHAT THIS DOES. It decides three things and stores nothing:
 *
 *   1. Is a row's vector usable for THIS query — same model, same dimension.
 *   2. Which rows need work, and in what order.
 *   3. Whether a failed attempt is worth retrying, or is a row that will never
 *      embed and should stop consuming attempts.
 *
 * WHY REFUSING IS SAFE HERE AND IS NOT SAFE IN THE ROUTER. `adaptive-routing`
 * must never drop a seat, because a roster that empties during an incident is
 * no product. A vector from the wrong model is different: including it produces
 * a WRONG neighbour, silently, and the alternative is the fallback that already
 * exists — recall by recency and by lexical match, which needs no vector at all.
 */

/**
 * @param {object} row              a user_facts row
 * @param {{model: string, dim: number}} current  what this deployment embeds with
 */
function isComparable(row, { model, dim }) {
  if (!row || !row.embedding) return false;
  /* A row from BEFORE the lifecycle columns existed has no model recorded.
   * Migration 021 labels those `stale` rather than guessing, and guessing here
   * would undo that: a wrong label is trusted, and trusting it is how two
   * geometries end up in one ranking. */
  if (!row.embedding_model) return false;
  if (row.embedding_model !== model) return false;
  if (Number.isFinite(row.embedding_dim) && Number.isFinite(dim) && row.embedding_dim !== dim) return false;
  return row.embedding_status === 'ok';
}

/** Whether a row should be (re-)embedded, and why. */
function needsEmbedding(row, { model, dim, maxAttempts = 3 } = {}) {
  if (!row) return null;
  if ((Number(row.embedding_attempts) || 0) >= maxAttempts) {
    /* NOT AN ERROR, AND NOT A RETRY. Three failures on one short string is not
     * a transient provider problem, and a backfill that keeps retrying it will
     * spend the whole budget on the same row forever while the rest of the
     * backlog waits behind it. */
    return null;
  }
  if (!row.embedding) return { reason: 'missing', priority: 1 };
  if (row.embedding_status === 'failed') return { reason: 'retry', priority: 3 };
  if (!row.embedding_model || row.embedding_model !== model) return { reason: 'model_changed', priority: 2 };
  if (Number.isFinite(row.embedding_dim) && Number.isFinite(dim) && row.embedding_dim !== dim) {
    return { reason: 'dimension_changed', priority: 2 };
  }
  if (row.embedding_status === 'stale') return { reason: 'unlabelled', priority: 2 };
  return null;
}

/**
 * The backlog, in the order it should be worked.
 *
 * MISSING BEFORE MISMATCHED. A row with no vector is invisible to semantic
 * recall entirely; a row with a vector from the previous model is merely
 * ranked oddly. The first is a fact the user told us and we cannot find.
 */
function backlog(rows, opts = {}) {
  return rows
    .map((row) => ({ row, work: needsEmbedding(row, opts) }))
    .filter((entry) => entry.work)
    .sort((a, b) => a.work.priority - b.work.priority
      || (Number(a.row.embedding_attempts) || 0) - (Number(b.row.embedding_attempts) || 0))
    .map((entry) => ({ id: entry.row.id, fact: entry.row.fact, ...entry.work }));
}

/**
 * The row patch after an embedding attempt.
 *
 * ONE PLACE THAT WRITES THESE FIVE COLUMNS, because the failure mode of getting
 * it wrong is a row that looks embedded and is not: status `ok` beside a null
 * vector is invisible to the backlog query AND invisible to recall, which is a
 * fact lost with no trace anywhere.
 */
function afterAttempt({ vector, model, dim, attempts = 0, now = Date.now() } = {}) {
  const ok = Array.isArray(vector) && vector.length > 0;
  if (ok && Number.isFinite(dim) && vector.length !== dim) {
    /* A vector of the wrong width is a provider or configuration error, and
     * storing it would put two geometries in one column — the exact thing 013's
     * plain ALTER refuses to do silently. */
    return {
      embedding: null,
      embedding_status: 'failed',
      embedding_attempts: attempts + 1,
      embedding_model: model,
      embedding_dim: dim,
      embedded_at: null,
    };
  }
  return {
    embedding: ok ? vector : null,
    embedding_status: ok ? 'ok' : 'failed',
    embedding_attempts: attempts + 1,
    embedding_model: ok ? model : null,
    embedding_dim: ok ? vector.length : null,
    embedded_at: ok ? new Date(now).toISOString() : null,
  };
}

module.exports = { isComparable, needsEmbedding, backlog, afterAttempt };
