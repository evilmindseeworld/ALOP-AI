-- 025: write the OpenRouter request budget back into the migration lineage.
--
-- WHAT THIS IS. `or_request_budget`, `reserve_or_requests` and
-- `settle_or_requests` exist in production, are called on every turn by
-- `lib/request-budget.js`, and were created by no file in this directory —
-- applied by hand, like the duplicate `audit_logs` index AGENTS.md records.
-- A database rebuilt from `migrations/` alone had no request budget at all and
-- failed at its first RPC.
--
-- This file is a TRANSCRIPT of what production already has, not a redesign.
-- The bodies below were dumped with `pg_get_functiondef` on 2026-08-16 and are
-- reproduced verbatim apart from formatting, so applying it to production is a
-- no-op and applying it to an empty database produces the same objects.
--
-- ONE DELIBERATE DIVERGENCE FROM THE HOUSE STYLE, named rather than smuggled:
-- production has `ENABLE ROW LEVEL SECURITY` on this table and NOT
-- `FORCE`, where every other service-only table here is forced. This file
-- reproduces production. Forcing it is a behaviour change on the request path
-- and belongs in its own migration, decided on its own evidence — a lineage
-- repair that quietly alters production is the opposite of what this fixes.
-- There are no policies, so anon and authenticated are denied either way.
--
-- `pg_catalog, public` rather than `''`, matching 023/024 and what production
-- carries: these bodies name `public.or_request_budget` qualified but declare
-- their volatility and types unqualified.
--
-- Idempotent and safe to re-run.

CREATE TABLE IF NOT EXISTS or_request_budget (
  -- One row per UTC day. The whole account's OpenRouter request count, not a
  -- per-user one: the ceiling being defended is the account's daily free-tier
  -- allowance, which no single user owns.
  day      DATE PRIMARY KEY,
  requests INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE or_request_budget ENABLE ROW LEVEL SECURITY;

/*
 * TAKE A REQUEST SLOT, OR REFUSE.
 *
 * Increments first and rolls back over the ceiling, rather than reading and
 * then writing: two turns arriving together must not both read "one slot left"
 * and both take it. The rollback is what makes the refusal free.
 */
CREATE OR REPLACE FUNCTION reserve_or_requests(p_requests integer, p_day_limit integer)
RETURNS TABLE(allowed boolean, used integer)
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_used  integer;
begin
  insert into public.or_request_budget as b (day, requests)
  values (v_today, greatest(p_requests, 0))
  on conflict (day) do update
    set requests = b.requests + greatest(p_requests, 0)
  returning b.requests into v_used;

  if v_used > p_day_limit then
    update public.or_request_budget
       set requests = greatest(requests - greatest(p_requests, 0), 0)
     where day = v_today
    returning requests into v_used;
    return query select false, v_used;
  else
    return query select true, v_used;
  end if;
end;
$function$;

/*
 * GIVE BACK WHAT THE TURN DID NOT SPEND.
 *
 * `greatest(…, 0)` on the result, because a settlement arriving after the day
 * rolls over would otherwise drive the new day negative and hand out free
 * requests.
 */
CREATE OR REPLACE FUNCTION settle_or_requests(p_reserved integer, p_actual integer)
RETURNS TABLE(used integer)
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_used  integer;
begin
  update public.or_request_budget
     set requests = greatest(requests - greatest(p_reserved, 0) + greatest(p_actual, 0), 0)
   where day = v_today
  returning requests into v_used;

  return query select coalesce(v_used, 0);
end;
$function$;
