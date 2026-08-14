'use strict';

/**
 * Admission, made idempotent and bounded.
 *
 * TWO DEFECTS, ONE MODULE.
 *
 * **It was not idempotent.** `reserve_user_spend` is atomic — the increment and
 * the limit test happen under one row lock — but atomic is not the same as
 * once. Nothing recorded that a given turn had already reserved, so any path
 * that ran the reservation twice moved a real user's balance twice, and any
 * path that ran the settlement twice refunded twice. Both paths exist:
 * `server.js` settles early when the request ceiling refuses a turn the money
 * ceiling admitted, and then falls through the same `finally`. That case is
 * guarded today by a variable being zeroed, which is a guard that lives one
 * edit away from being wrong.
 *
 * **The money ceiling failed open with no bound.** `reserveSpend`'s catch
 * returned `{ allowed: true, unmetered: true }` for every request for as long
 * as Postgres was unreachable — so a five-minute outage admitted every turn
 * from every user with no counter of any kind, and the only number anyone could
 * look at lived in the store that was down. The ARGUMENT for failing open is
 * sound and is kept: failing closed converts a partial dependency failure into
 * a total outage. What was wrong is that "open" meant "unlimited".
 *
 * So there is a degraded allowance, exactly as lib/request-budget.js has: when
 * the store is unreachable, admission continues from a small local budget and
 * STOPS when that is gone. This module is deliberately the same shape as that
 * one — two ceilings that fail differently are two ceilings someone has to
 * reason about twice.
 *
 * ponytail: the degraded counter is per PROCESS, so two instances in degraded
 * mode admit two allowances. Bounded and known, where the previous behaviour
 * was neither. If this ever runs on more than a couple of instances, divide the
 * allowance at boot rather than adding coordination to a path whose dependency
 * is already down.
 */

/** Fraction of the daily cents ceiling admitted blind while the store is down. */
const DEGRADED_FRACTION = 0.05;

/**
 * @param {object} deps
 * @param {(fn: string, args: object) => Promise<{data: any, error: any}>} deps.rpc
 * @param {{dayCents: number, monthCents: number, degradedCents?: number}} deps.limits
 * @param {(msg: string) => void} [deps.onError]
 * @param {(msg: string) => void} [deps.onWarn]
 * @param {() => number} [deps.now]
 */
function createReservationLedger({
  rpc,
  limits,
  onError = (m) => console.error(m),
  onWarn = (m) => console.warn(m),
  now = Date.now,
}) {
  if (typeof rpc !== 'function') throw new TypeError('createReservationLedger needs an rpc function');
  if (!limits || !Number.isFinite(limits.dayCents)) throw new TypeError('createReservationLedger needs numeric limits');

  const degradedCents = Number.isFinite(limits.degradedCents)
    ? Math.max(0, Math.floor(limits.degradedCents))
    : Math.max(1, Math.floor(limits.dayCents * DEGRADED_FRACTION));

  const utcDay = () => new Date(now()).toISOString().slice(0, 10);
  let degradedUsed = 0;
  let degradedDay = utcDay();
  let degraded = false;

  /* IN-PROCESS MEMORY OF WHAT THIS TURN ALREADY DID.
   *
   * The durable guard is `claim_turn_reservation`, and it is the one that
   * survives a restart and a second instance. This set is in front of it so
   * that the common case — one process, two code paths, same turn — costs no
   * round trip at all. Bounded, because a long-lived process must not grow a
   * set with one entry per turn it has ever served. */
  const seen = new Map();
  const MAX_SEEN = 5_000;
  const remember = (turnId, value) => {
    if (seen.size >= MAX_SEEN) {
      // Oldest first: Map preserves insertion order.
      const oldest = seen.keys().next().value;
      seen.delete(oldest);
    }
    seen.set(turnId, value);
    return value;
  };

  const recovered = () => {
    if (!degraded) return;
    degraded = false;
    degradedUsed = 0;
    onWarn('[SPEND] Store reachable again; metered admission resumed.');
  };

  /**
   * Claim the right to reserve for this turn, then reserve.
   *
   * @returns {Promise<{allowed: boolean, dayCents: number|null, monthCents: number|null,
   *                    duplicate?: true, degraded?: true, unmetered?: true}>}
   */
  const reserve = async ({ turnId, operationId, userId, cents, requests = 0 }) => {
    if (!turnId) throw new TypeError('reserve needs a turnId');
    const already = seen.get(turnId);
    if (already) return { ...already, duplicate: true };

    /* THE CLAIM IS BEST-EFFORT AND THE RESERVATION IS NOT.
     *
     * If the claim call fails we do NOT refuse the turn — that would make an
     * idempotency record a second thing that can take the product down. We fall
     * through to the reservation, which has its own bounded degraded path. The
     * cost of a failed claim is that a genuine duplicate could reserve twice
     * during an outage, which is strictly less bad than refusing everybody. */
    let claimed = true;
    try {
      const { data, error } = await rpc('claim_turn_reservation', {
        p_turn_id: turnId,
        p_operation_id: String(operationId || ''),
        p_user_id: userId,
        p_cents: Math.max(0, Math.floor(cents) || 0),
        p_requests: Math.max(0, Math.floor(requests) || 0),
      });
      if (error) throw new Error(error.message || String(error));
      const row = Array.isArray(data) ? data[0] : data;
      claimed = row ? row.claimed !== false : true;
      if (!claimed) {
        /* Somebody — this process before a restart, or another instance — has
         * already reserved for this turn id. The money has moved once and must
         * not move again. Admitted, because the turn WAS admitted; it simply
         * was not admitted here. */
        onWarn(`[SPEND] Turn ${turnId} was already reserved; not charging twice.`);
        return remember(turnId, { allowed: true, dayCents: null, monthCents: null, duplicate: true });
      }
    } catch (e) {
      onError(`[SPEND] Reservation claim failed (continuing, unguarded against duplicates): ${e.message}`);
    }

    try {
      const { data, error } = await rpc('reserve_user_spend', {
        p_user_id: userId,
        p_cents: cents,
        p_day_limit: limits.dayCents,
        p_month_limit: limits.monthCents,
      });
      if (error) throw new Error(error.message || String(error));
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('reserve_user_spend returned no row');
      recovered();
      return remember(turnId, {
        allowed: row.allowed !== false,
        dayCents: row.day_cents ?? null,
        monthCents: row.month_cents ?? null,
      });
    } catch (e) {
      const today = utcDay();
      if (today !== degradedDay) { degradedDay = today; degradedUsed = 0; }
      degraded = true;

      const asked = Math.max(0, Math.floor(Number(cents) || 0));
      /* Charged against the local allowance BEFORE the decision, so a turn is
       * either fully covered by it or refused. Admitting one that overruns the
       * degraded ceiling by half would make the ceiling a suggestion. */
      if (degradedUsed + asked > degradedCents) {
        onError(
          '[SPEND] Reservation failed and the degraded allowance is spent '
          + `(${degradedUsed}/${degradedCents}c); REFUSING. Cause: ${e.message}`,
        );
        return remember(turnId, {
          allowed: false, dayCents: null, monthCents: null,
          degraded: true, degradedUsed, degradedLimit: degradedCents,
        });
      }

      degradedUsed += asked;
      onError(
        '[SPEND] Reservation failed, admitting DEGRADED and UNMETERED '
        + `(${degradedUsed}/${degradedCents}c of the local allowance): ${e.message}`,
      );
      return remember(turnId, {
        allowed: true, dayCents: null, monthCents: null,
        unmetered: true, degraded: true, degradedUsed, degradedLimit: degradedCents,
      });
    }
  };

  /**
   * Settle exactly once per turn.
   *
   * NOT AWAITED BY ITS CALLER: it runs from a `finally` where the client may
   * already be gone, so every path ends in a caught promise. An unhandled
   * rejection in a `finally` ends the process under Node's default policy.
   *
   * @returns {Promise<{settled: boolean}>}
   */
  const settle = ({ turnId, userId, reservedCents, actualCents, reservedRequests = 0, actualRequests = 0 }) =>
    Promise.resolve()
      .then(async () => {
        if (!turnId) return { settled: false };
        /* Local bookkeeping first, and unconditionally: what THIS process spent
         * does not depend on whether the store answers. Without the refund the
         * degraded allowance would measure turns rather than money, because
         * `reserve` charges it the pessimistic worst case. */
        if (degraded) {
          const refund = Math.max(0, (Math.floor(reservedCents) || 0) - (Math.floor(actualCents) || 0));
          degradedUsed = Math.max(0, degradedUsed - refund);
        }

        let mayApply = true;
        try {
          const { data, error } = await rpc('settle_turn_reservation', {
            p_turn_id: turnId,
            p_cents: Math.max(0, Math.floor(actualCents) || 0),
            p_requests: Math.max(0, Math.floor(actualRequests) || 0),
          });
          if (error) throw new Error(error.message || String(error));
          const row = Array.isArray(data) ? data[0] : data;
          mayApply = row ? row.settled !== false : true;
          if (!mayApply) {
            onWarn(`[SPEND] Turn ${turnId} was already settled; not refunding twice.`);
            return { settled: false, duplicate: true };
          }
        } catch (e) {
          /* Same reasoning as the claim: an idempotency record that is down must
           * not stop a refund. The exposure is a double refund during an outage,
           * which errs towards the USER rather than towards the house — the safe
           * direction for a ceiling whose purpose is not to over-charge. */
          onError(`[SPEND] Settlement guard failed (applying anyway): ${e.message}`);
        }

        const { error } = await rpc('settle_user_spend', {
          p_user_id: userId,
          p_reserved: reservedCents,
          p_actual: actualCents,
        });
        if (error) throw new Error(error.message || String(error));
        recovered();
        return { settled: true };
      })
      .catch((e) => {
        onError(`[SPEND] Settlement failed: ${e.message}`);
        return { settled: false };
      });

  return { reserve, settle, degradedLimit: () => degradedCents, isDegraded: () => degraded };
}

module.exports = { createReservationLedger, DEGRADED_FRACTION };
