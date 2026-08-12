-- 014_user_spend.sql
--
-- Additive and re-runnable. Apply with
--   node scripts/run-migration.mjs 014_user_spend.sql
--
-- A per-user spend ceiling: $5/day, $20/month, set by the owner 2026-08-12.
--
-- WHY THIS EXISTS. The rate limiters key on the authenticated user now rather
-- than the IP, which stopped one account multiplying itself across addresses.
-- But a request RATE is not a spend ceiling: an account inside 30 turns/minute
-- can still run the bill up, and a council turn is seven paid model calls plus
-- search plus a possible fallback whip. Sol's attack review named this as the
-- remaining half and the owner set the numbers.
--
-- ONE ROW PER USER PER DAY, and the month is a SUM over those rows rather than
-- a second counter. Two counters for one quantity is two things that can
-- disagree, and the disagreement is silent — the month would drift from the
-- days it is supposedly made of and no query would notice. At most 31 rows per
-- user per month, which is nothing.

CREATE TABLE IF NOT EXISTS user_spend (
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day      DATE NOT NULL,
  cents    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- The month sum reads a contiguous range of one user's rows. The primary key
-- already orders by (user_id, day), so this index is not added: the PK serves
-- the only query shape there is. Twice in this project an index has been
-- proposed that already existed under another name — read pg_indexes first.

/*
 * RESERVE, ATOMICALLY, OR REFUSE.
 *
 * The obvious implementation is SELECT the totals, compare them in the
 * application, then UPDATE. That has a window between the read and the write in
 * which a second concurrent turn reads the same totals and both are admitted —
 * and concurrency is precisely how someone would attack a spend ceiling. The
 * check and the increment therefore happen in one statement, under the row lock
 * INSERT .. ON CONFLICT DO UPDATE takes.
 *
 * The order matters and is easy to get wrong: the row is incremented FIRST and
 * the limits are tested against the result. Testing before incrementing would
 * reintroduce the same window one line further down.
 *
 * On refusal the increment is undone in the same transaction, so a refused turn
 * leaves the balance exactly as it found it. A refused caller must not be
 * charged for being refused, or a user at their ceiling would be pushed further
 * past it by every retry.
 *
 * Returns the post-decision balances so the caller can report them without a
 * second round trip.
 */
CREATE OR REPLACE FUNCTION reserve_user_spend(
  p_user_id      UUID,
  p_cents        INTEGER,
  p_day_limit    INTEGER,
  p_month_limit  INTEGER
)
RETURNS TABLE (allowed BOOLEAN, day_cents INTEGER, month_cents INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_today   DATE := (now() AT TIME ZONE 'utc')::date;
  v_day     INTEGER;
  v_month   INTEGER;
BEGIN
  INSERT INTO user_spend AS s (user_id, day, cents)
  VALUES (p_user_id, v_today, GREATEST(p_cents, 0))
  ON CONFLICT (user_id, day) DO UPDATE
    SET cents = s.cents + GREATEST(p_cents, 0)
  RETURNING s.cents INTO v_day;

  SELECT COALESCE(SUM(cents), 0) INTO v_month
  FROM user_spend
  WHERE user_id = p_user_id
    AND day >= date_trunc('month', v_today)::date;

  IF v_day > p_day_limit OR v_month > p_month_limit THEN
    -- Undo. Same transaction, so nothing else can observe the intermediate
    -- state, and the refused caller is not charged for the refusal.
    UPDATE user_spend
       SET cents = GREATEST(cents - GREATEST(p_cents, 0), 0)
     WHERE user_id = p_user_id AND day = v_today;

    SELECT cents INTO v_day FROM user_spend WHERE user_id = p_user_id AND day = v_today;
    SELECT COALESCE(SUM(cents), 0) INTO v_month
      FROM user_spend
     WHERE user_id = p_user_id
       AND day >= date_trunc('month', v_today)::date;

    RETURN QUERY SELECT FALSE, v_day, v_month;
  ELSE
    RETURN QUERY SELECT TRUE, v_day, v_month;
  END IF;
END;
$$;

/*
 * SETTLE: adjust a reservation to what the turn actually cost.
 *
 * A turn reserves a pessimistic worst case at admission — full roster, fallback
 * council, full tool budget — because admission control has to commit to a
 * number before knowing what the turn will do. Almost every turn then costs
 * less, and the difference has to come back or the ceiling would be a fraction
 * of its stated value in practice.
 *
 * The delta is signed and clamped at zero: a refund cannot take a user's
 * balance negative, which would otherwise let a run of cheap turns bank credit
 * against a later expensive one.
 *
 * It is deliberately NOT an error for the row to be missing. The reservation
 * and the settlement are separated by the whole turn, and a day boundary can
 * fall between them; charging a fresh day for yesterday's refund would be
 * worse than letting a rare refund go unclaimed.
 */
CREATE OR REPLACE FUNCTION settle_user_spend(
  p_user_id   UUID,
  p_reserved  INTEGER,
  p_actual    INTEGER
)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE user_spend
     SET cents = GREATEST(cents + (GREATEST(p_actual, 0) - GREATEST(p_reserved, 0)), 0)
   WHERE user_id = p_user_id
     AND day = (now() AT TIME ZONE 'utc')::date;
$$;

-- Service-role only, like rate_limits and stripe_events. No policy at all:
-- default deny is the spec. A user reading their own balance would be
-- reasonable one day; it would go through the backend, not through RLS.
ALTER TABLE user_spend ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_spend FORCE ROW LEVEL SECURITY;

-- Housekeeping. Balances older than the current month are never read by
-- `reserve_user_spend`, which sums from date_trunc('month'). Keeping a couple
-- of months is useful for answering "what did this user cost in June"; beyond
-- that it is dead weight:
--   DELETE FROM user_spend WHERE day < (now() - interval '3 months')::date;
