-- Everything the Supabase advisors flagged that is worth acting on, and
-- explicit notes on the ones that are NOT.
--
-- Context that changes how serious all of this is: nothing reaches this
-- database except the backend, holding the service-role key, which BYPASSES
-- RLS entirely. The frontend has no Supabase client — checked, there is no
-- createClient anywhere in frontend/src. So every policy below is
-- defence-in-depth against a future direct-from-browser path, not the thing
-- currently protecting anyone's rows. That is the reason none of this is
-- urgent, and also the reason it is worth getting right BEFORE such a path
-- exists rather than after.

-- ===========================================================================
-- 1. SECURITY: rls_auto_enable was callable by anon over the public API.
-- ===========================================================================
-- It is SECURITY DEFINER, and PostgREST exposed it at
-- /rest/v1/rpc/rls_auto_enable to both `anon` and `authenticated`.
--
-- The realistic blast radius is small: it returns `event_trigger` and calls
-- pg_event_trigger_ddl_commands(), which errors outside an event-trigger
-- context, so an unauthenticated caller gets an exception rather than DDL. It
-- also already pins its own search_path. But "the exploit fails on a
-- technicality" is not a security posture — a SECURITY DEFINER function that
-- no API caller should ever invoke should not be callable by an API caller.
--
-- Revoking EXECUTE does NOT stop the event trigger firing. Event triggers are
-- invoked by the trigger manager as the function's owner and never consult
-- EXECUTE grants, so RLS still gets enabled on new tables exactly as before.
revoke execute on function public.rls_auto_enable() from anon, authenticated, public;

-- ===========================================================================
-- 2. SECURITY: pin search_path on the six functions that had none.
-- ===========================================================================
-- All six are SECURITY INVOKER (prosecdef = false, verified before writing
-- this), so they run with the caller's privileges and the escalation story
-- that makes this dangerous for DEFINER functions does not apply. This is
-- hygiene: with a mutable search_path, a schema earlier in the caller's path
-- can shadow an unqualified name and change what the function resolves to.
--
-- `pg_catalog, public` rather than the stricter `''`, deliberately: an empty
-- search_path requires every reference inside each body to be schema-qualified,
-- and rewriting six working function bodies to silence an advisory is a much
-- better way to introduce a bug than to prevent one. This pins resolution
-- without touching a single line of logic.
alter function public.current_app_user_id() set search_path = pg_catalog, public;
alter function public.increment_usage(uuid, date, integer, integer) set search_path = pg_catalog, public;
alter function public.increment_rate_limit(text, integer) set search_path = pg_catalog, public;
alter function public.decrement_rate_limit(text) set search_path = pg_catalog, public;
alter function public.sweep_search_cache() set search_path = pg_catalog, public;
alter function public.sweep_audit_logs(integer) set search_path = pg_catalog, public;

-- ===========================================================================
-- 3. PERFORMANCE + CLARITY: three overlapping ALL policies on `chats`.
-- ===========================================================================
-- `chats` carried three permissive ALL policies: `chats_owner` from migration
-- 002, plus "Users own their chats" and "Admins can manage all chats" left over
-- from the ad-hoc schema that predates migrations/. Permissive policies OR
-- together, so this was not a hole — each was correctly scoped — but every
-- query evaluated all three, and two of them re-ran a subquery against `users`
-- for EVERY ROW.
--
-- Consolidated into one policy that is the OR of what the three expressed, so
-- no capability is lost: an owner reaches their own chats, an admin reaches
-- all of them. Dropping the admin policy outright would have been the smaller
-- diff and would have silently removed admin access over any future direct
-- API path.
--
-- Both lookups are wrapped in a scalar SELECT. That is the whole of the
-- auth_rls_initplan fix: `current_setting()` inside a policy is re-evaluated
-- per row, while `(select current_setting(...))` is evaluated once per
-- statement and cached as an InitPlan.
drop policy if exists "Users own their chats" on public.chats;
drop policy if exists "Admins can manage all chats" on public.chats;
drop policy if exists chats_owner on public.chats;

create policy chats_owner on public.chats
  for all
  using (
    user_id = (select public.current_app_user_id())
    or (select coalesce((select u.is_admin from public.users u
                         where u.id = (select public.current_app_user_id())), false))
  )
  with check (
    user_id = (select public.current_app_user_id())
    or (select coalesce((select u.is_admin from public.users u
                         where u.id = (select public.current_app_user_id())), false))
  );

-- ===========================================================================
-- 4. PERFORMANCE: the indexes the Stripe webhook and the file list probe.
-- ===========================================================================
-- Open in AGENTS.md since before this session. Free at the current row count —
-- the planner will keep choosing a sequential scan over two rows whatever
-- exists — so these are for the shape of the query, not for today's latency.
--
-- CONCURRENTLY is absent ON PURPOSE and this differs from what a copy of this
-- file should do by hand: apply_migration wraps its statements in a
-- transaction, and CREATE INDEX CONCURRENTLY cannot run inside one. Same
-- decision, and same reason, as migration 007.
create index if not exists users_email on public.users (email);
create index if not exists users_stripe_customer on public.users (stripe_customer_id);
create index if not exists users_stripe_subscription on public.users (stripe_subscription_id);

-- The unindexed foreign key the advisor flagged. A delete on `users` has to
-- scan chat_files for referencing rows without it.
create index if not exists chat_files_user_id on public.chat_files (user_id);

-- ===========================================================================
-- NOT DONE, and why — so the next session does not redo this reasoning.
-- ===========================================================================
-- * "Unused index" on rate_limits_expiry, search_cache_expiry,
--   idx_audit_logs_user_id, audit_logs_action. They are unused because this
--   database has a handful of rows and the planner will not choose an index
--   over a sequential scan at that size — NOT because the queries that need
--   them do not exist. The sweeps genuinely filter on those columns. Dropping
--   them would delete work that becomes correct the moment there is traffic.
--
-- * "RLS enabled, no policy" on rate_limits, search_cache, stripe_events and
--   user_facts. This is the INTENDED posture, not an oversight. Those tables
--   are written only by the backend under the service-role key, which bypasses
--   RLS; enabled-with-no-policy means any other caller is denied everything,
--   which is exactly right. Adding a permissive policy to silence an INFO lint
--   would be strictly worse than the finding.
--
-- * "Extension vector in public". Moving it means dropping and recreating the
--   extension, which drops the `vector` type, which `user_facts.embedding`
--   depends on. A schema move that rewrites a production column to silence a
--   WARN is not a trade worth taking while nothing writes that column yet.
--   Revisit if and when Phase 2 semantic memory is built.
