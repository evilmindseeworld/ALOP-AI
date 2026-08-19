-- 030_publishing_ledger.sql
--
-- Additive and re-runnable. Apply with
--   node scripts/run-migration.mjs 030_publishing_ledger.sql
-- or through the Supabase MCP apply_migration.
--
-- ONE ROW PER INTENDED PUBLICATION, AND ONE OWNER PER REEL/PLATFORM.
--
-- Two schedulers now exist. Metricool holds the batch already in its planner;
-- Buffer is being added for capacity, because Metricool's monthly allowance is
-- the ceiling and Buffer Free's is a standing queue depth that refills as posts
-- publish. The failure mode that creates is obvious and expensive: both of them
-- publishing the same reel to the same account, which is not a bug the audience
-- forgives.
--
-- THE GUARD IS THE INDEX, NOT THE APPLICATION. A check-then-insert in JS loses
-- the race it exists to prevent, and the two writers here are separate
-- processes on separate schedules. `publishing_ledger_active_owner` makes the
-- second writer's INSERT fail with 23505 instead, which is a refusal the caller
-- cannot forget to handle.
--
-- WHICH STATUSES ARE "ACTIVE", and why `published` is one of them: a published
-- reel is still owned. Releasing the pair on publish would let the other
-- scheduler post the same video to the same channel the next day, which is the
-- duplicate this table exists to stop. `failed` and `cancelled` are excluded so
-- a dead claim frees the slot for a retry — that is the whole reason the index
-- is partial rather than a plain UNIQUE on (reel_id, platform).

CREATE TABLE IF NOT EXISTS publishing_ledger (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_id           TEXT        NOT NULL,
  platform          TEXT        NOT NULL,
  scheduler         TEXT        NOT NULL,
  /* NULL between the claim and the scheduler answering with an id. The row is
   * already active at that point on purpose: the claim is what reserves the
   * pair, so a crash between INSERT and the API call leaves the pair held by a
   * row that says `claimed` with no post id — visible, and releasable — rather
   * than leaving it free for a second writer mid-flight. */
  scheduler_post_id TEXT,
  scheduled_at      TIMESTAMPTZ NOT NULL,
  status            TEXT        NOT NULL,
  media_url         TEXT        NOT NULL,
  caption_hash      TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT publishing_ledger_platform_known
    CHECK (platform IN ('instagram', 'tiktok', 'youtube')),
  CONSTRAINT publishing_ledger_scheduler_known
    CHECK (scheduler IN ('metricool', 'buffer')),
  CONSTRAINT publishing_ledger_status_known
    CHECK (status IN ('claimed', 'scheduled', 'published', 'failed', 'cancelled'))
);

-- THE DUPLICATE GUARD. One active owner per (reel, platform), whichever
-- scheduler got there first.
CREATE UNIQUE INDEX IF NOT EXISTS publishing_ledger_active_owner
  ON publishing_ledger (reel_id, platform)
  WHERE status IN ('claimed', 'scheduled', 'published');

-- The queue planner's read: "what is already owned", newest first.
CREATE INDEX IF NOT EXISTS publishing_ledger_scheduled
  ON publishing_ledger (scheduled_at DESC);

COMMENT ON TABLE publishing_ledger IS
  'One row per intended publication of a reel to a platform. The partial unique index publishing_ledger_active_owner is what stops Metricool and Buffer both owning the same pair. See 030.';
COMMENT ON COLUMN publishing_ledger.caption_hash IS
  'sha256 of the exact caption text handed to the scheduler. Catches the soft duplicate: same reel, same platform, reworded caption, scheduled twice.';
COMMENT ON COLUMN publishing_ledger.media_url IS
  'The exact URL given to the scheduler. Buffer fetches media at PUBLISH time, so a queued post referencing a moved or unpublished object fails silently later — this column is what makes that diagnosable.';

-- `updated_at` is maintained here rather than by every caller, for the same
-- reason the uniqueness is: a writer that forgets is the normal case.
CREATE OR REPLACE FUNCTION public.publishing_ledger_touch()
RETURNS TRIGGER LANGUAGE plpgsql
-- Pinned, like every other function here: an unpinned search_path lets a
-- schema earlier in the path shadow what this body resolves to. 011 is the
-- migration that says why, and migration-lineage.test.js is what enforces it.
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS publishing_ledger_touch ON publishing_ledger;
CREATE TRIGGER publishing_ledger_touch
  BEFORE UPDATE ON publishing_ledger
  FOR EACH ROW EXECUTE FUNCTION public.publishing_ledger_touch();

-- SERVICE ROLE ONLY. This table is operator tooling: no end user reads or
-- writes it, so RLS is on with no policy at all, which denies every anon and
-- authenticated request while the service role continues to bypass it. Same
-- shape as the other operator tables.
ALTER TABLE publishing_ledger ENABLE ROW LEVEL SECURITY;
-- FORCE as well as ENABLE, matching `answer_cache` in 015: ENABLE alone leaves
-- the table owner exempt, and the service role reaches this table through
-- BYPASSRLS rather than through ownership, so forcing costs the scripts nothing
-- and closes the owner-exempt hole.
ALTER TABLE publishing_ledger FORCE ROW LEVEL SECURITY;
