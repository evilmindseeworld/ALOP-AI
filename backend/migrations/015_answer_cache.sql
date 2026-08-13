-- 015_answer_cache.sql
--
-- Additive and re-runnable. Apply with
--   node scripts/run-migration.mjs 015_answer_cache.sql
-- or through the Supabase MCP's apply_migration. Note the trap recorded in
-- AGENTS.md: apply_migration wraps statements in a transaction, so anything
-- needing CONCURRENTLY has to have it dropped at apply time. Nothing here does.
--
-- UNTIL THIS IS APPLIED THE FEATURE STILL WORKS, in-process only. lib/answer-cache.js
-- degrades to its Map tier and logs one line naming this file. The cost of not
-- applying it is that every Render deploy empties the cache — which, since
-- Render deploys on every push, means it is empty most of the time.
--
--
-- A cache of finished ANSWERS, keyed by everything that can change one.
--
-- WHY THIS EXISTS. 005 caches SEARCH RESULTS, which saves a provider fan-out
-- and still spends every model request the turn needs. Model requests are the
-- resource that actually binds this product: fifty per UTC day, per ACCOUNT,
-- shared across all users. Asking the same question twice cost two router
-- calls plus a streamed extraction the second time, for an answer already
-- written. This table is what makes the second asking free.
--
--
-- WHAT IS DELIBERATELY NOT USER-SCOPED, AND WHY THAT IS SAFE HERE.
--
-- There is no user_id column and there must never be one, for the same reason
-- 005 has none: the entire value is that one person's turn pays for the next
-- person's answer, and that only works if the rows are global.
--
-- 005 is safe because its key is a generated search query. THIS ONE IS SAFE
-- ONLY BECAUSE THE APPLICATION REFUSES TO WRITE A ROW FOR A PERSONALISED TURN.
-- A turn that read conversation history, a chat summary, stored user facts,
-- learned feedback preferences, an attached image or an attached file produces
-- an answer ABOUT THAT PERSON, and no key derived from the question alone can
-- distinguish it from a general one. server.js builds no key at all for those
-- turns; lib/answer-cache.js documents the contract; answer-cache.test.js
-- holds it. If a future change writes a personalised answer here, the failure
-- is a silent cross-user data leak that looks exactly like a cache hit — no
-- error, no log line, and invisible to both users.
--
-- THE COLUMN HOLDS MODEL OUTPUT DERIVED FROM USER QUESTIONS. RLS below denies
-- everything, so only the service role reads it. A change that made this table
-- readable by end users would expose other people's answers.

CREATE TABLE IF NOT EXISTS answer_cache (
  -- sha256 of (normalised question, language, country, plan, detail flag,
  -- branch). Not the question itself: a btree primary key over
  -- arbitrary-length user-derived text is an index-size failure waiting for an
  -- unusually long message, and a fixed 64 chars never is.
  key         TEXT PRIMARY KEY,
  answer      TEXT NOT NULL,
  stored_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Written by the application from a per-branch shelf life, not from one
  -- global TTL. A Wikipedia answer is good next week; a search-backed answer
  -- about a price carries "as of" dates and is not. See TTL_MS in
  -- lib/answer-cache.js for the ranking and the argument.
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Expiry is checked on read as well, so a stale row is never served. This
-- index exists only so the sweep does not table-scan.
CREATE INDEX IF NOT EXISTS answer_cache_expiry ON answer_cache (expires_at);

-- RLS with no policy at all: deny by default, service role only. Same
-- reasoning as 005 — this table has no owner by design, so the correct policy
-- set is the empty one, and enabling RLS without policies is the statement
-- that no end user should ever read it directly.
ALTER TABLE answer_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_cache FORCE ROW LEVEL SECURITY;

/*
 * Sweep expired rows.
 *
 * Called opportunistically from the application rather than on a schedule, for
 * the reason 005 gives: the free tier has no scheduler and a table this small
 * does not justify pg_cron. Expired rows are already ignored on read, so
 * falling behind on the sweep costs disk and nothing else.
 */
CREATE OR REPLACE FUNCTION sweep_answer_cache()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  removed INTEGER;
BEGIN
  DELETE FROM answer_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
