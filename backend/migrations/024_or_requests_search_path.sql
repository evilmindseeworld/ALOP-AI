-- 024: pin search_path on the two functions no migration file creates.
--
-- HOW THESE WERE FOUND, because the method is the point. 023 pinned the three
-- unpinned functions that `lib/migration-lineage.js` could see, and the check
-- it left behind reads the MIGRATION FILES. So it is structurally blind to a
-- function that exists in production and in no migration — which is exactly
-- what `reserve_or_requests(p_requests integer, p_day_limit integer)` and
-- `settle_or_requests(p_reserved integer, p_actual integer)` are. They are
-- called by `lib/request-budget.js`, they are live, and `grep` over
-- `migrations/` does not find them. They were applied by hand, like the
-- duplicate `audit_logs` index AGENTS.md records.
--
-- The lesson, stated so the next pass does not repeat it: a checker that reads
-- the files can only ever verify what the files say. Verifying the SCHEMA
-- means asking the schema — `select proname from pg_proc … where proconfig is
-- null`, which is the query `lib/migration-lineage.js` already carries and
-- nothing runs on a schedule.
--
-- Same size as 023 and no bigger: neither is SECURITY DEFINER, so this is a
-- correctness exposure and not a live escalation. Both are the OpenRouter
-- request budget — a shadowed table on THIS path is a daily request ceiling
-- read from somewhere else.
--
-- `pg_catalog, public` for the same reason 023 chose it: these bodies were
-- written unqualified and an empty search_path would take them down.
--
-- Idempotent, catalogue-only, no rewrite and no lock beyond the statement.

-- GUARDED, BECAUSE ON A REBUILD THESE FUNCTIONS DO NOT EXIST YET.
--
-- Both were created by hand in production long before `migrations/` did, which
-- is why this file could ALTER them: 025 is the migration written afterwards to
-- put their definitions under lineage, and it comes AFTER this one. Against
-- production every statement here worked; against an empty database this file
-- was one of the two remaining rebuild failures on 2026-08-18.
--
-- Nothing is lost by skipping: 025 creates both functions with
-- `SET search_path = pg_catalog, public` already on them, so a rebuilt
-- database reaches the same catalogue state this file exists to produce. The
-- ALTER matters only for the pre-existing production copies, which is exactly
-- where the guard passes.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'reserve_or_requests') THEN
    EXECUTE 'alter function public.reserve_or_requests(p_requests integer, p_day_limit integer) set search_path = pg_catalog, public';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'settle_or_requests') THEN
    EXECUTE 'alter function public.settle_or_requests(p_reserved integer, p_actual integer) set search_path = pg_catalog, public';
  END IF;
END $$;
