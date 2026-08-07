-- One index on audit_logs (created_at DESC), under one name, on every database.
--
-- THE STATE THIS FIXES, and it is not what the migration files say it is.
--
-- Production carries two byte-identical indexes:
--
--     audit_logs_recent          btree (created_at DESC)
--     idx_audit_logs_created_at  btree (created_at DESC)
--
-- Postgres will hold both quite happily. Nothing reads faster for it; every
-- INSERT maintains both. audit_logs takes an insert on EVERY council request,
-- so the duplicate is a wasted index write on the hottest write path here.
-- The Supabase performance linter reports it as `duplicate_index` — that is
-- where this came from, not from a guess.
--
-- NEITHER NAME APPEARS IN THIS DIRECTORY. 006 creates a third name,
-- `audit_logs_created_at` (ASC), and production does not have it, because 006
-- has never been applied — it is still an open owner task in handoff.md. The
-- two indexes that exist came from an earlier ad-hoc schema that predates these
-- files. The migrations and the live database have diverged, and this file is
-- written to be correct against both rather than against either one.
--
-- Hence the CREATE below, which looks redundant and is not. Dropping the
-- duplicates alone would be right for production and WRONG for a fresh
-- database: applied in order, 006 creates `audit_logs_created_at`, this file
-- drops it, and the admin console's `audit` command
-- (order by created_at desc, limit 20) is left with no index at all. Creating
-- the survivor first makes this file idempotent and makes both paths land in
-- the same place.
--
-- DESC rather than ASC is kept because every read of this table is
-- most-recent-first. A single-column btree can be walked backwards, so the
-- direction costs nothing either way; matching the query is simply the clearer
-- thing to leave behind.
--
-- The other three indexes on audit_logs were checked and all three earn their
-- place, so none is touched here:
--   audit_logs_action      (action, created_at DESC)  -- the `council` command
--   idx_audit_logs_user_id (user_id)                  -- the ON DELETE SET NULL
--   audit_logs_pkey                                   -- primary key
--
-- The linter also flags idx_audit_logs_user_id as "unused". It is not dead: it
-- covers the foreign key, and dropping it makes deleting a user scan the whole
-- audit table. "Never used" reflects a site with almost no traffic yet.
--
-- CONCURRENTLY so none of this takes a lock on a live table. It cannot run
-- inside a transaction block, and the Supabase MCP `apply_migration` wraps
-- statements in one — so drop CONCURRENTLY at apply time and record that here,
-- exactly as 007 does. The table is small; the brief lock does not matter yet.

CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_logs_recent
  ON audit_logs (created_at DESC);

DROP INDEX CONCURRENTLY IF EXISTS idx_audit_logs_created_at;
DROP INDEX CONCURRENTLY IF EXISTS audit_logs_created_at;
