-- 004_rate_limits.sql
--
-- Additive and re-runnable. Apply with
--   node scripts/run-migration.mjs 004_rate_limits.sql
--
-- A rate-limit counter shared across instances.
--
-- WHY THIS EXISTS. express-rate-limit's default store is in-memory and
-- per-process, so every limit is multiplied by the instance count. On one
-- instance the limits hold exactly as measured (135 requests, 19 × 429). The
-- moment the service scales to two, "120 per minute" silently becomes 240, and
-- scaling on Render is a dropdown — there is no deploy, no review, and nothing
-- that would flag it.
--
-- It is NOT enabled by setting this up. server.js only uses it when
-- RATE_LIMIT_STORE=postgres, because a shared store costs a database round trip
-- on every request and one instance does not need to pay that. The table exists
-- so that turning it on is one variable rather than a migration under pressure.

CREATE TABLE IF NOT EXISTS rate_limits (
  key         TEXT PRIMARY KEY,
  count       INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Sweeping expired rows. They are also ignored on read, so a stale row is
-- harmless — this only stops the table growing without bound.
CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits (expires_at);

/*
 * One statement, so it cannot race.
 *
 * The obvious implementation — SELECT, then UPDATE or INSERT from the
 * application — has a window between the read and the write in which another
 * instance does the same thing, and both write 1. That is the exact bug a
 * shared store is being introduced to fix, so doing it in two round trips would
 * reintroduce it at a different layer.
 *
 * INSERT .. ON CONFLICT DO UPDATE is atomic under Postgres' row lock. The
 * window check inside the UPDATE is what makes it a rate limiter rather than a
 * counter: if the stored window has passed, the row RESTARTS at 1 instead of
 * continuing to climb, so a caller is never permanently locked out by a burst
 * from an hour ago.
 */
CREATE OR REPLACE FUNCTION increment_rate_limit(p_key TEXT, p_window_ms INTEGER)
RETURNS TABLE (total_hits INTEGER, reset_at TIMESTAMPTZ)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO rate_limits AS r (key, count, expires_at)
  VALUES (p_key, 1, now() + make_interval(secs => p_window_ms / 1000.0))
  ON CONFLICT (key) DO UPDATE
    SET count = CASE WHEN r.expires_at <= now() THEN 1 ELSE r.count + 1 END,
        expires_at = CASE
          WHEN r.expires_at <= now() THEN now() + make_interval(secs => p_window_ms / 1000.0)
          ELSE r.expires_at
        END
  RETURNING r.count, r.expires_at;
END;
$$;

-- Used by the store's decrement(), which express-rate-limit calls when a
-- request turns out not to have counted (skipSuccessfulRequests and friends).
CREATE OR REPLACE FUNCTION decrement_rate_limit(p_key TEXT)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE rate_limits SET count = greatest(count - 1, 0) WHERE key = p_key;
$$;

-- Service-role only, like stripe_events. No policy at all: default deny is the
-- spec, and nothing browser-side has any business reading this.
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits FORCE ROW LEVEL SECURITY;

-- Housekeeping, to run from a scheduled job or by hand:
--   DELETE FROM rate_limits WHERE expires_at < now() - interval '1 hour';
