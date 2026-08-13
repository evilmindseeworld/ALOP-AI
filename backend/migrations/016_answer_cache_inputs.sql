-- 016_answer_cache_inputs.sql
--
-- Additive and re-runnable. Apply with
--   node scripts/run-migration.mjs 016_answer_cache_inputs.sql
-- or through the Supabase MCP's apply_migration. The partial index below is
-- transaction-safe; unlike CREATE INDEX CONCURRENTLY, it does not need to be
-- dropped when apply_migration wraps this file in a transaction.
--
-- 015 stored only a hash, answer, and shelf-life timestamps. The brain needs
-- the original inputs to ask a search-backed question again, so this table now
-- holds user-derived QUESTION TEXT as well as the hash. That increases what a
-- table leak would expose. RLS remains enabled and forced, with no policies:
-- service-role only. Only non-personalised turns are ever written here;
-- server.js builds no key at all for a personalised turn.

ALTER TABLE answer_cache
  ADD COLUMN IF NOT EXISTS question_text TEXT,
  ADD COLUMN IF NOT EXISTS lang TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS plan TEXT,
  ADD COLUMN IF NOT EXISTS detailed BOOLEAN,
  ADD COLUMN IF NOT EXISTS branch TEXT,
  ADD COLUMN IF NOT EXISTS used_live_web BOOLEAN;

-- answer_cache_expiry already covers the expiry range, but it also indexes
-- stable/non-search rows that the refresh job can never use. This partial index
-- keeps the same range key while excluding those rows, so the hourly query
-- scans only search-backed candidates. Nullable legacy rows are harmless:
-- used_live_web IS TRUE selects only new, explicitly marked search answers.
CREATE INDEX IF NOT EXISTS answer_cache_search_expiry
  ON answer_cache (expires_at)
  WHERE used_live_web IS TRUE;

-- Keep the service-role-only boundary explicit for fresh databases and for
-- databases where 015 was applied before this additive migration.
ALTER TABLE answer_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_cache FORCE ROW LEVEL SECURITY;
