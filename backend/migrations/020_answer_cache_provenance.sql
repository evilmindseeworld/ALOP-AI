-- 020_answer_cache_provenance.sql
--
-- Additive and re-runnable. Apply with
--   node scripts/run-migration.mjs 020_answer_cache_provenance.sql
--
-- WHERE A CACHED ANSWER CAME FROM, HOW GOOD IT WAS, AND HOW TO KILL IT.
--
-- Migration 016 added the inputs needed to ask a question AGAIN. What is still
-- missing is everything about the answer that was stored:
--
--   * WHICH MODEL wrote it and whether the text came from a real `content`
--     field or was rescued from excluded reasoning (see lib/reasoning-rescue.js
--     — the two are trusted differently and used to be indistinguishable).
--   * HOW MUCH THE SEATS AGREED, which is the only quality signal this system
--     produces for free and which nothing was keeping.
--   * WHETHER ANYONE EVER READS IT. A cache with no hit counter cannot tell a
--     popular answer from a row that has been re-earned weekly for a month and
--     served to nobody.
--   * A WAY TO INVALIDATE ONE ROW. `clear()` empties the process's memory tier
--     and leaves Postgres untouched, so the only durable invalidation available
--     was waiting for the TTL. A prompt change, a wrong answer reported by a
--     user, or a source that turns out to have been lying all need a row gone
--     NOW, and none of them should require a deploy.
--
-- NULLABLE THROUGHOUT, and every reader treats null as "not recorded". Rows
-- written before this migration are not wrong, they are unlabelled, and a
-- backfill that guessed at their provenance would be worse than the gap.

ALTER TABLE answer_cache
  -- Model, textSource, retrieval mode, source count, the turn that produced it.
  -- JSONB rather than six columns because nothing queries on the parts; they
  -- are read whole, by a person, when an answer turns out to be wrong.
  ADD COLUMN IF NOT EXISTS provenance JSONB,
  -- 0..1. Today this is the council's own agreement score
  -- (lib/progressive-council.js). Null means nothing measured it — which is
  -- honest, and a default of 1 would not be.
  ADD COLUMN IF NOT EXISTS quality REAL,
  -- Reads, so a TTL can be extended for an answer people actually want and a
  -- row nobody has ever read can be dropped first.
  ADD COLUMN IF NOT EXISTS hit_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_hit_at TIMESTAMPTZ,
  -- Set to kill a row before its TTL. A timestamp rather than a boolean: "when
  -- was this invalidated" is the question anyone actually asks of it.
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invalidated_reason TEXT;

-- The invalidation sweep and the "what is worth keeping" query both filter on
-- these. Partial, because the overwhelming majority of rows are live and
-- indexing them would be indexing the whole table twice.
CREATE INDEX IF NOT EXISTS answer_cache_invalidated
  ON answer_cache (invalidated_at)
  WHERE invalidated_at IS NOT NULL;

/*
 * COUNT A READ WITHOUT BLOCKING ONE.
 *
 * Called fire-and-forget from the read path, so it must be cheap and must never
 * be the reason a cache hit is slow. One indexed primary-key update.
 *
 * SET search_path = '' for the reason 019 spells out: a function that resolves
 * `answer_cache` through a caller-supplied search_path can be pointed at a
 * different table.
 */
CREATE OR REPLACE FUNCTION note_answer_cache_hit(p_key TEXT)
RETURNS VOID
LANGUAGE sql
SET search_path = ''
AS $$
  UPDATE public.answer_cache
     SET hit_count = hit_count + 1,
         last_hit_at = now()
   WHERE key = p_key;
$$;

/*
 * INVALIDATE, BY KEY OR BY BRANCH.
 *
 * Rows are marked rather than deleted. Deleting loses the evidence in the one
 * case where anybody cares — "why was this answer being served" — and the
 * expiry sweep already removes them in the ordinary course.
 *
 * A NULL branch means every branch, which is the dangerous form and is
 * therefore the one that requires passing NULL explicitly rather than the one
 * you get by forgetting an argument.
 */
CREATE OR REPLACE FUNCTION invalidate_answer_cache(
  p_branch TEXT,
  p_reason TEXT,
  p_before TIMESTAMPTZ DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  UPDATE public.answer_cache
     SET invalidated_at = now(),
         invalidated_reason = COALESCE(p_reason, 'unspecified')
   WHERE invalidated_at IS NULL
     AND (p_branch IS NULL OR branch = p_branch)
     AND (p_before IS NULL OR stored_at < p_before);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;
