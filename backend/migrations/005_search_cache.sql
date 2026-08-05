-- 005_search_cache.sql
--
-- Additive and re-runnable. Apply with
--   node scripts/run-migration.mjs 005_search_cache.sql
--
-- A search cache that survives a deploy.
--
-- WHY THIS EXISTS. The cache is a 50-entry Map with a 5 minute TTL living in
-- the process. Every deploy empties it, and Render deploys on every push. In
-- practice that means the cache is almost always cold, and the very first
-- person after a deploy pays the full 600ms-plus fan-out for a question
-- somebody already asked ten minutes ago.
--
-- It is also per-process, so it cannot be shared the moment there is more than
-- one instance — the same problem 004 exists to solve for rate limits.
--
-- WHAT IS DELIBERATELY NOT USER-SCOPED. There is no user_id column and there
-- must never be one. The entire value of this table is that one person's
-- search pays for the next person's answer, which only works if the rows are
-- global. That is safe ONLY because the cache key is the generated search
-- query and nothing else: region is already baked into that query string by
-- getSearchQuery, so a UAE price query and a US one are different keys and
-- cannot serve each other's results.
--
-- The consequence to keep in mind: query_text holds text derived from user
-- messages. It is not more exposed than the messages themselves — RLS below
-- denies everything, so only the service role reads it — but a change that
-- made this table readable by users would leak other people's search terms.

CREATE TABLE IF NOT EXISTS search_cache (
  -- sha256 of the query, not the query itself. A btree primary key over
  -- arbitrary-length user-derived text is an index-size failure waiting for
  -- an unusually long question; a fixed 64 chars never is.
  query_hash  TEXT PRIMARY KEY,
  -- Kept for the admin console and for debugging a bad cached answer. Nothing
  -- reads it to make a decision.
  query_text  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Expiry is checked on read as well, so a stale row is never served. This
-- index exists only so the sweep does not table-scan.
CREATE INDEX IF NOT EXISTS search_cache_expiry ON search_cache (expires_at);

-- RLS with no policy at all: deny by default, service role only.
--
-- Every other table in this schema has an owner policy because every other
-- table has an owner. This one has no owner by design (see above), so the
-- correct policy set is the empty one. Enabling RLS without policies is not an
-- oversight here — it is the statement that no end user should ever read this
-- table directly.
ALTER TABLE search_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_cache FORCE ROW LEVEL SECURITY;

/*
 * Sweep expired rows.
 *
 * Called opportunistically from the application rather than on a schedule,
 * because the free tier has no scheduler and a table this small does not
 * justify pg_cron. Expired rows are already ignored on read, so falling behind
 * on the sweep costs disk and nothing else.
 */
CREATE OR REPLACE FUNCTION sweep_search_cache()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  removed INTEGER;
BEGIN
  DELETE FROM search_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
