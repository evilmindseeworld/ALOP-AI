-- 022_jobs.sql
--
-- Additive and re-runnable. NOT YET APPLIED — read the live schema through the
-- Supabase MCP first; `migrations/` is not what production looks like (004, 005
-- and 006 have never run). Apply with `apply_migration`, dropping CONCURRENTLY,
-- as 007 records.
--
--
-- THE WORK A TURN LEAVES BEHIND, AND WHY LOSING IT STOPPED BEING ACCEPTABLE.
--
-- Everything learned from a turn is fire-and-forget today:
--
--     updateChatSummary(...).catch(() => {});
--     updateUserFacts(...).catch(() => {});
--
-- That was a reasonable trade when the work was one summary. It is now the
-- summary, the extracted facts, their embeddings, the cache warmer and the
-- brain's refreshes — and the failure mode is invisible BY CONSTRUCTION,
-- because nothing records that the job existed, so nothing can report that it
-- did not run. A deploy mid-turn loses all of them silently, and on Render's
-- free tier the process is stopped when idle, which is exactly when this work
-- happens.
--
-- WHY A TABLE RATHER THAN A QUEUE SERVICE. The database is already here, is
-- already the thing that must be up for a turn to work, and the volume is a
-- handful of jobs per turn. A second piece of infrastructure would be a second
-- thing to be down.
--
-- THE LEASE IS A TIMESTAMP, NOT A BOOLEAN, and that is the whole design: a
-- worker that dies leaves a lease that EXPIRES rather than a row locked
-- forever. See lib/job-queue.js for the rest of the reasoning.

CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Nullable: a cache-warm job belongs to nobody. Where they ARE set, they are
  -- how a user's jobs get deleted with the user, and how a job's spend is
  -- attributed to the account that caused it.
  user_id uuid,
  chat_id uuid,

  -- IDEMPOTENCY, ENFORCED WHERE A RACE CANNOT REACH IT. Two enqueues of "the
  -- summary for chat X through turn 12" must collide, and the only reliable
  -- place for that is a unique index: a check-then-insert in the application
  -- has a window between the two halves, and every terminal path in the route
  -- can enqueue concurrently.
  dedupe_key text NOT NULL,

  status text NOT NULL DEFAULT 'pending',
  priority int NOT NULL DEFAULT 5,
  attempts int NOT NULL DEFAULT 0,

  -- When the job becomes due. A future value is how a job is DELAYED — a
  -- setTimeout does not survive the deploy that is the reason this table exists.
  run_at timestamptz,

  -- Who holds it and until when. Both null when nobody does.
  lease_until timestamptz,
  claimed_by text,
  claimed_at timestamptz,

  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  dead_at timestamptz,

  CONSTRAINT jobs_status_check
    CHECK (status IN ('pending', 'running', 'done', 'dead')),
  CONSTRAINT jobs_kind_check
    CHECK (kind IN ('chat_summary', 'fact_extraction', 'embedding_backfill',
                    'cache_warm', 'brain_refresh', 'evaluation'))
);

-- ONE LIVE JOB PER PIECE OF WORK. Partial, so that a completed job does not
-- block the same work being enqueued again later — "summarise chat X through
-- turn 12" is done once, but "warm the cache for question Q" recurs, and a
-- unique index over all rows would make the second one impossible forever.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS jobs_dedupe_live
  ON public.jobs (dedupe_key)
  WHERE status IN ('pending', 'running');

-- The claim query: due, unheld, in priority order. Partial for the same reason
-- the backlog index in 021 is — the rows it selects are meant to be the
-- minority, and a full index would be mostly finished jobs.
CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_claimable
  ON public.jobs (priority, run_at)
  WHERE status IN ('pending', 'running');

-- "Which jobs are failing and why" is the only question worth asking about a
-- queue. This is the index behind it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_dead
  ON public.jobs (kind, dead_at DESC)
  WHERE status = 'dead';

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs FORCE ROW LEVEL SECURITY;
-- No policy, which means no direct client access at all. The server connects
-- with the service key and is the only writer. 011 records the same posture for
-- the other service-only tables.

COMMENT ON TABLE public.jobs IS
  'Durable background work: summaries, fact extraction, embeddings, cache warming, brain refreshes. Leased with an expiring timestamp so a dead worker releases its job. See lib/job-queue.js.';
COMMENT ON COLUMN public.jobs.dedupe_key IS
  'One live job per piece of work, enforced by the partial unique index jobs_dedupe_live. Built by lib/job-queue.js dedupeKey() from the ENQUEUER''s identifying parts, never from the whole payload.';
COMMENT ON COLUMN public.jobs.lease_until IS
  'A timestamp rather than a boolean on purpose: a worker that dies leaves an expiring lease instead of a permanently locked row.';
