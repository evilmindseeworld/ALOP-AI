-- 026_stripe_event_state.sql
--
-- Additive and re-runnable. Apply with
--   node scripts/run-migration.mjs 026_stripe_event_state.sql
--
-- THE LEDGER RECORDED THAT AN EVENT ARRIVED, NOT THAT IT WAS APPLIED, AND THE
-- WEBHOOK TREATED THOSE AS THE SAME THING.
--
-- `stripe_events` (002) is claimed FIRST, before the user row is touched, so
-- that a duplicate delivery can be dropped. The claim is never released. So:
--
--   1. checkout.session.completed arrives. The row is inserted.
--   2. The `users` update throws — Supabase blip, a timeout, anything.
--   3. The handler answers 500, which is correct: Stripe must retry.
--   4. Stripe retries. The insert hits the primary key, the handler says
--      "duplicate, already processed", and answers 200.
--
-- The customer has paid and `plan` stays `free`, permanently, and every log
-- line on the retry says the healthy thing. At-least-once delivery only helps
-- if the second delivery can still do the work.
--
-- These three columns are the difference between "seen" and "done". The
-- webhook skips only rows that reached `done`; a row still in `processing`
-- after the in-flight window is a previous attempt that died, and is
-- reprocessed.
--
-- BACKFILL TO 'done' RATHER THAN THE DEFAULT. Every row that exists when this
-- runs was written by the old code, where existence meant processed. Leaving
-- them at the column default would mark the entire history reprocessable.
-- Stripe would never redeliver them — its retry window is days — but a ledger
-- that misdescribes its own rows is how the next reader gets it wrong.

ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS status     TEXT NOT NULL DEFAULT 'processing';
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS attempts   INTEGER NOT NULL DEFAULT 1;
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Idempotent: only rows predating the column, which are the ones with the
-- default still in place and a processed_at older than this migration.
UPDATE stripe_events SET status = 'done'
 WHERE status = 'processing'
   AND processed_at < now() - interval '1 hour';

-- The webhook reads by primary key, so no index is needed for it. This one is
-- for the question a human asks: what has been stuck.
CREATE INDEX IF NOT EXISTS stripe_events_unfinished
    ON stripe_events (processed_at)
 WHERE status <> 'done';

-- RLS is already ENABLE + FORCE with no policy from 002. Service role only;
-- nothing here changes that.
