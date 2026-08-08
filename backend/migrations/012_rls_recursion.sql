-- THE RLS LAYER HAS NEVER WORKED. Every policy in it recursed.
--
-- Found by actually exercising the policies rather than reading them:
--
--   set local role authenticated;
--   set request.jwt.claims to a real user;
--   select count(*) from chats;
--   -->  ERROR: 54001 stack depth limit exceeded
--        CONTEXT: SQL function "current_app_user_id" during startup  (x~400)
--
-- The cycle, from migration 002:
--
--   policy chats_owner        →  current_app_user_id()
--   current_app_user_id()     →  SELECT id FROM users WHERE clerk_id = ...
--   that SELECT               →  policy users_self_read
--   users_self_read           →  current_app_user_id()          ← round again
--
-- It applies to `users`, `chats`, `chat_files` and `usage` — every table with
-- a policy. So the answer to "are we protected at the row level" was no, and
-- had been since 002 shipped.
--
-- WHY NOBODY NOTICED, and why this is a latent bug rather than an incident:
-- the backend holds the service-role key, which BYPASSES RLS, and the frontend
-- has no Supabase client at all. Nothing has ever taken the path that recurses.
-- The policies are defence-in-depth for a direct-from-browser path that does
-- not exist yet — which is exactly why this had to be found now. The day
-- someone adds that path is the worst possible day to discover that the guard
-- rail throws instead of denying.
--
-- THE FIX is the standard one for RLS helpers, and it is one word: the helper
-- has to be SECURITY DEFINER so that its own lookup does not re-enter the
-- policy that called it. A SECURITY INVOKER helper that reads a table
-- protected by a policy that calls that helper cannot terminate.
--
-- Safe to make it DEFINER: it reads exactly one row, selected by the caller's
-- OWN JWT subject, and returns only that row's id. It cannot be steered at
-- another user's row, because the only input is a claim the caller already
-- proved. search_path is pinned in the same statement, which is also what
-- migration 011 was pinning it for.

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select id from public.users
  where clerk_id = nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')
  limit 1
$$;

-- The admin check, as its own DEFINER helper for the same reason.
--
-- The chats policy previously inlined `select is_admin from users where ...`,
-- which re-entered the `users` policy on every evaluation. Reading it through a
-- definer function means the policy depends on ONE function it controls rather
-- than on another table's policy — the coupling that produced the cycle in the
-- first place.
--
-- coalesce to false: a NULL is_admin, or no matching row at all, is "not an
-- admin". A policy that evaluates to NULL denies, which is the right outcome
-- here, but saying so explicitly means the next reader does not have to know
-- that rule to be sure.
create or replace function public.current_app_is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (select u.is_admin from public.users u
     where u.clerk_id = nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')
     limit 1),
    false)
$$;

-- EXECUTE MUST BE GRANTED, and the first version of this migration got that
-- exactly backwards.
--
-- The reasoning that was wrong: "these are only called from inside policies,
-- where grants are not consulted, so revoke them from the API roles." The
-- second half is false. A policy expression is evaluated AS THE CALLING ROLE,
-- so a function it calls is subject to that role's EXECUTE privilege. Revoking
-- turned every policy from "denies correctly" into:
--
--   ERROR: 42501 permission denied for function current_app_user_id
--
-- which is a different broken, not a fixed. Caught by running the test rather
-- than by reading the migration.
--
-- Granting is safe, and not merely acceptable: both functions take NO
-- arguments and derive everything from `request.jwt.claims`, a value the
-- caller has already proved. There is no parameter to steer at another user's
-- row. The most a caller learns by invoking one directly is their own id and
-- their own admin flag, both of which they are entitled to.
grant execute on function public.current_app_user_id() to anon, authenticated;
grant execute on function public.current_app_is_admin() to anon, authenticated;

-- Rewritten to use the admin helper instead of reaching into `users`.
-- Still wrapped in scalar SELECTs so both are InitPlans evaluated once per
-- statement rather than once per row — the auth_rls_initplan finding.
drop policy if exists chats_owner on public.chats;
create policy chats_owner on public.chats
  for all
  using (user_id = (select public.current_app_user_id()) or (select public.current_app_is_admin()))
  with check (user_id = (select public.current_app_user_id()) or (select public.current_app_is_admin()));

-- The other three policies were recursing for the same reason and are fixed by
-- the helper alone. Rewritten anyway so each one gets the InitPlan treatment.
drop policy if exists users_self_read on public.users;
create policy users_self_read on public.users
  for select using (id = (select public.current_app_user_id()) or (select public.current_app_is_admin()));

drop policy if exists users_self_update on public.users;
create policy users_self_update on public.users
  for update using (id = (select public.current_app_user_id()));

drop policy if exists chat_files_owner on public.chat_files;
create policy chat_files_owner on public.chat_files
  for all
  using (user_id = (select public.current_app_user_id()))
  with check (user_id = (select public.current_app_user_id()));

drop policy if exists usage_owner_read on public.usage;
create policy usage_owner_read on public.usage
  for select using (user_id = (select public.current_app_user_id()));
