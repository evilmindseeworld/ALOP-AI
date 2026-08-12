'use strict';

/**
 * The account-wide OpenRouter request budget: the two database calls, and the
 * decisions that go with them.
 *
 * WHY THIS IS A MODULE AND NOT TWO FUNCTIONS IN server.js. The cost ledger's
 * `reserveSpend`/`settleSpend` live in server.js, and that was the right call
 * for them — they are two thin wrappers whose logic is all in the SQL. This one
 * carries decisions that are not in the SQL and that are worth checking: what to
 * do when the store is unreachable, when to warn, and — the one most likely to
 * be got wrong by a later edit — that the key is global rather than per user.
 * server.js calls `process.exit(1)` at import time on a missing env var, so
 * nothing defined in it is reachable from a test. Taking `rpc` as a dependency
 * is the same shape `pg-rate-limit-store.js` uses, for the same reason.
 *
 * WHAT THIS COUNTS, AND WHAT IT DOES NOT. OpenRouter requests only. Search and
 * page-fetch calls go to Brave, Tavily, Serper, Google CSE and r.jina.ai, so
 * they cost money from the cents ceiling and none of this quota. Two ceilings
 * over disjoint sets of operations, which is why both exist.
 *
 * FAILS OPEN, deliberately, and the reasoning is the same one
 * `pg-rate-limit-store.js` argues at length: failing closed converts a partial
 * dependency failure into a total outage. The exposure here is a window in which
 * the account could overrun its free-model quota — and OpenRouter's own 429 is
 * still behind us, caught by the latch above `callModel` in server.js, which
 * refuses subsequent turns outright. This ceiling exists to refuse politely
 * BEFORE the provider refuses rudely, not to be the only thing in the way.
 *
 * Every failure is logged. A ceiling that has quietly stopped applying is worse
 * than no ceiling, because the graphs stay reassuring.
 */

/**
 * @param {object} deps
 * @param {(fn: string, args: object) => Promise<{data: any, error: any}>} deps.rpc
 *        Supabase's rpc(), or anything with that shape.
 * @param {{dayRequests: number, warnRequests: number}} deps.limits
 * @param {(msg: string) => void} [deps.onError]
 * @param {(msg: string) => void} [deps.onWarn]
 */
function createRequestBudget({ rpc, limits, onError = (m) => console.error(m), onWarn = (m) => console.warn(m) }) {
  if (typeof rpc !== 'function') throw new TypeError('createRequestBudget needs an rpc function');
  if (!limits || !Number.isFinite(limits.dayRequests)) throw new TypeError('createRequestBudget needs numeric limits');

  /**
   * Take `requests` out of today's budget before the turn runs.
   *
   * NOTE WHAT IS NOT IN THE ARGUMENTS: any user id. The quota belongs to the
   * OpenRouter ACCOUNT, so every user draws from one pool and the key is the UTC
   * date alone. Adding a user id here — the obvious thing to do by analogy with
   * `reserve_user_spend` — would enforce a 1000/day cap as 1000 PER USER, which
   * is the limit multiplied by the user count and therefore no limit at all.
   *
   * @returns {Promise<{allowed: boolean, used: number|null, unmetered?: true}>}
   */
  const reserve = async (requests) => {
    try {
      const { data, error } = await rpc('reserve_or_requests', {
        p_requests: requests,
        p_day_limit: limits.dayRequests,
      });
      if (error) throw new Error(error.message || String(error));
      // Postgres RETURNS TABLE arrives as an array of one row.
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('reserve_or_requests returned no row');
      return { allowed: row.allowed !== false, used: row.used ?? null };
    } catch (e) {
      onError(`[REQUESTS] Reservation failed, ADMITTING UNMETERED: ${e.message}`);
      return { allowed: true, used: null, unmetered: true };
    }
  };

  /**
   * Hand back the reservation and charge what the turn actually spent.
   *
   * NOT AWAITED BY ITS CALLER, which is why every path here ends in a caught
   * promise: it runs from a `finally` where the client may already be gone, and
   * an unhandled rejection in a `finally` ends the process under Node's default
   * policy.
   */
  const settle = (reserved, actual) =>
    Promise.resolve()
      .then(() => rpc('settle_or_requests', { p_reserved: reserved, p_actual: actual }))
      .then(({ data, error } = {}) => {
        if (error) return onError(`[REQUESTS] Settlement failed: ${error.message || String(error)}`);
        const row = Array.isArray(data) ? data[0] : data;
        const used = Number(row?.used);
        /* VISIBILITY, NOT ENFORCEMENT — it refuses nothing. This is the line
         * that says the day is going to run out before it actually does, which
         * is the only kind of warning worth having. Read from the SETTLEMENT
         * rather than the reservation so it reports what was really spent
         * instead of what a turn might have spent. */
        if (Number.isFinite(used) && used >= limits.warnRequests) {
          onWarn(`[REQUESTS] ${used}/${limits.dayRequests} OpenRouter requests used today (warn at ${limits.warnRequests}).`);
        }
        return used;
      })
      .catch((e) => onError(`[REQUESTS] Settlement failed: ${e.message}`));

  return { reserve, settle };
}

module.exports = { createRequestBudget };
