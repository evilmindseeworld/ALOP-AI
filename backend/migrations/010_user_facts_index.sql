-- 010: index user_facts for the only two queries that touch it.
--
-- `user_facts` predates this directory. It has existed in production with
-- exactly one index — its primary key — and zero references anywhere in the
-- repository, which is why the performance advisor has been reporting
-- `user_id` as an unindexed foreign key and why that finding was correct here
-- and wrong for chat_files.
--
-- Both reads are the same shape: this user's facts, newest first, limited.
-- `(user_id, created_at DESC)` serves the filter and the sort from one index,
-- and covers the foreign key as a side effect. Confirmed against pg_indexes
-- before writing: only user_facts_pkey existed. Named to match
-- feedback_notes_user_recent and chats_user_recent, which are the same query
-- against the same shape of table.
--
-- CONCURRENTLY is right for a rebuild under load and CANNOT be applied through
-- the Supabase MCP, which wraps statements in a transaction. Applied without
-- it on 2026-08-08 against an empty table, where the lock is instant. Kept in
-- the file because the next environment to run this may not be empty. Same
-- split as 007 — see AGENTS.md.

CREATE INDEX CONCURRENTLY IF NOT EXISTS user_facts_user_recent
  ON public.user_facts (user_id, created_at DESC);
