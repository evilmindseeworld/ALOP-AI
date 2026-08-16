-- 023: pin search_path on the three functions that were added after 011.
--
-- WHAT HAPPENED, because it is worth naming precisely: nobody made a mistake
-- here. Migration 011 pinned `search_path` on the six functions that existed on
-- 2026-08-12 and explained why. Eleven functions have been created since, in
-- seven files, and each of those files was reviewed against itself. Eight of
-- them pin their own search_path in the definition; three do not. A property
-- that spans a directory is the one thing a per-file review structurally cannot
-- check, which is why lib/migration-lineage.js now checks it and a test fails
-- when the next one slips through.
--
-- THE THREE:
--   reserve_user_spend(uuid, integer, integer, integer)   014
--   settle_user_spend(uuid, integer, integer)             014
--   sweep_answer_cache()                                  015
--
-- THE SIZE OF IT, stated honestly rather than inflated: none of the three is
-- SECURITY DEFINER, so this is not a live privilege escalation. With a mutable
-- search_path a schema earlier in the caller's path can shadow a table or
-- operator that an unqualified body names, which on an INVOKER function is a
-- correctness bug — the first two are the money path, so a correctness bug
-- there is a spend ceiling reading somebody else's table. The distance between
-- "correctness bug" and "breach" is one ALTER that makes it SECURITY DEFINER,
-- which is exactly the kind of change that gets made later by someone who did
-- not read this file.
--
-- `pg_catalog, public` rather than `''`, and the difference matters: an empty
-- search_path requires every reference inside the body to be schema-qualified,
-- and these three bodies were written unqualified. 019 and later use `''`
-- because they were written for it. Setting `''` here would leave three
-- functions that parse and fail at runtime — a hardening change that takes the
-- money path down.
--
-- Idempotent, and safe to re-run: ALTER FUNCTION … SET is a catalogue update
-- with no rewrite and no lock beyond the statement.

alter function public.reserve_user_spend(uuid, integer, integer, integer)
  set search_path = pg_catalog, public;

alter function public.settle_user_spend(uuid, integer, integer)
  set search_path = pg_catalog, public;

alter function public.sweep_answer_cache()
  set search_path = pg_catalog, public;
