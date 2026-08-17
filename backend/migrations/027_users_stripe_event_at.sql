-- 027_users_stripe_event_at.sql
--
-- Additive and re-runnable. Apply with
--   node scripts/run-migration.mjs 027_users_stripe_event_at.sql
--
-- STRIPE DOES NOT PROMISE THE ORDER EVENTS ARRIVE IN, AND THE WEBHOOK ASSUMED
-- IT DID.
--
-- Every handler wrote whichever delivery landed last. So:
--
--   customer.subscription.updated (active)   created 12:00:00
--   customer.subscription.deleted            created 12:00:05
--
-- delivered in the other order — which a redelivery after a 500 produces on
-- its own, minutes apart — leaves a cancelled customer on `pro` permanently.
-- Every log line reads healthy, and unlike the paid-and-free bugs this one is
-- invisible from the customer's side too, because the customer is happy. It is
-- found by reading the ledger against Stripe, which is to say it is not found.
--
-- This column is the high-water mark: the `created` time of the newest event
-- that has been applied to the row. `lib/stripe-apply.js` compares and writes
-- it in ONE statement, because reading it, comparing in JavaScript and then
-- writing has a race exactly the width of the round trip — and two concurrent
-- deliveries of two events is the case the whole thing exists for.
--
-- NULLABLE, AND NO BACKFILL. A row that has never had a billing event has no
-- high-water mark, and the predicate says so explicitly
-- (`stripe_event_at IS NULL OR stripe_event_at <= $1`). Backfilling to now()
-- would reject the next real event for every existing user as stale; to
-- epoch would be a lie about a measurement that was never taken. The absence
-- IS the correct value.
--
-- UNTIL THIS IS APPLIED the code falls back to the unguarded write — the old
-- last-delivered-wins behaviour — and reports `ordered: false` rather than
-- believing itself protected. That fallback has its own test. This repo has
-- shipped a migration that sat unapplied while the code needing it failed in
-- silence (see AGENTS.md on 019); the fallback is the answer to that, not an
-- excuse to leave this unapplied.

ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_event_at TIMESTAMPTZ;

COMMENT ON COLUMN users.stripe_event_at IS
  'High-water mark: created time of the newest Stripe event applied to this row. NULL means none yet. See lib/stripe-apply.js.';
