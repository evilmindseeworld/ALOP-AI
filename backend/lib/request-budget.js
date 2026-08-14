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
 * IT FAILED OPEN WITHOUT A BOUND, AND THAT IS THE PART THAT WAS WRONG.
 *
 * The reasoning for failing open is sound and is kept, and it is the same one
 * `pg-rate-limit-store.js` argues at length: failing closed converts a partial
 * dependency failure into a total outage. OpenRouter's own 429 is still behind
 * us, caught by the latch above `callModel` in server.js, which refuses
 * subsequent turns outright. This ceiling exists to refuse politely BEFORE the
 * provider refuses rudely, not to be the only thing in the way.
 *
 * What was wrong is that "open" meant UNLIMITED. A Supabase outage of any
 * length admitted every turn from every user with no counter of any kind, so
 * the account's whole daily allowance could be spent inside it — and invisibly,
 * because the only number anyone can look at lives in the store that is down.
 * "Temporarily unmetered" is a reasonable trade for a few seconds and is not
 * one for an hour.
 *
 * SO THERE IS NOW A DEGRADED MODE WITH A CEILING OF ITS OWN. When the store is
 * unreachable, admission continues from a small local allowance
 * (`degradedRequests`, defaulting to a strict fraction of the day's) and STOPS
 * when that is gone. The service keeps answering through a blip and cannot
 * empty the account through an outage. A successful reservation clears the
 * state, so recovery needs no intervention.
 *
 * ponytail: the local counter is per PROCESS. Two instances in degraded mode
 * admit two allowances. That is bounded and known, where the previous behaviour
 * was neither; if this ever runs on more than a couple of instances, divide
 * `degradedRequests` by the instance count at boot rather than adding
 * coordination to the path whose dependency is already down.
 *
 * Every failure is logged. A ceiling that has quietly stopped applying is worse
 * than no ceiling, because the graphs stay reassuring.
 */

/**
 * @param {object} deps
 * @param {(fn: string, args: object) => Promise<{data: any, error: any}>} deps.rpc
 *        Supabase's rpc(), or anything with that shape.
 * @param {{dayRequests: number, warnRequests: number, degradedRequests?: number}} deps.limits
 * @param {(msg: string) => void} [deps.onError]
 * @param {(msg: string) => void} [deps.onWarn]
 * @param {() => number} [deps.now]  injectable clock, so the UTC-day reset is testable
 */
function createRequestBudget({ rpc, limits, onError = (m) => console.error(m), onWarn = (m) => console.warn(m), now = Date.now }) {
  if (typeof rpc !== 'function') throw new TypeError('createRequestBudget needs an rpc function');
  if (!limits || !Number.isFinite(limits.dayRequests)) throw new TypeError('createRequestBudget needs numeric limits');

  /* THE DEGRADED ALLOWANCE. Five per cent of the day, floor of one, so a small
   * limit still admits something rather than failing closed the moment the
   * store blinks. Overridable because the right fraction depends on how much of
   * the day's quota the owner is willing to spend blind. */
  const degradedRequests = Number.isFinite(limits.degradedRequests)
    ? Math.max(0, Math.floor(limits.degradedRequests))
    : Math.max(1, Math.floor(limits.dayRequests * 0.05));

  /* Reset with the UTC day, matching the store's own key. Without this a
   * process that degraded once would carry a spent local allowance across
   * midnight and refuse on a day whose real budget is untouched. */
  const utcDay = () => new Date(now()).toISOString().slice(0, 10);
  let degradedUsed = 0;
  let degradedDay = utcDay();
  let degraded = false;

  const recovered = () => {
    if (!degraded) return;
    degraded = false;
    degradedUsed = 0;
    onWarn('[REQUESTS] Store reachable again; metered admission resumed.');
  };

  /**
   * Take `requests` out of today's budget before the turn runs.
   *
   * NOTE WHAT IS NOT IN THE ARGUMENTS: any user id. The quota belongs to the
   * OpenRouter ACCOUNT, so every user draws from one pool and the key is the UTC
   * date alone. Adding a user id here — the obvious thing to do by analogy with
   * `reserve_user_spend` — would enforce a 1000/day cap as 1000 PER USER, which
   * is the limit multiplied by the user count and therefore no limit at all.
   *
   * @returns {Promise<{allowed: boolean, used: number|null, unmetered?: true, degraded?: true, degradedUsed?: number, degradedLimit?: number}>}
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
      recovered();
      return { allowed: row.allowed !== false, used: row.used ?? null };
    } catch (e) {
      const today = utcDay();
      if (today !== degradedDay) { degradedDay = today; degradedUsed = 0; }
      degraded = true;

      const asked = Math.max(0, Math.floor(Number(requests) || 0));
      /* Counted against the LOCAL allowance before the decision, so a turn is
       * either fully covered by it or refused. Admitting a turn that overruns
       * the degraded ceiling by half would make the ceiling a suggestion. */
      if (degradedUsed + asked > degradedRequests) {
        onError(
          '[REQUESTS] Reservation failed and the degraded allowance is spent '
          + `(${degradedUsed}/${degradedRequests}); REFUSING. Cause: ${e.message}`,
        );
        return { allowed: false, used: null, degraded: true, degradedUsed, degradedLimit: degradedRequests };
      }

      degradedUsed += asked;
      onError(
        '[REQUESTS] Reservation failed, admitting DEGRADED and UNMETERED '
        + `(${degradedUsed}/${degradedRequests} of the local allowance): ${e.message}`,
      );
      return { allowed: true, used: null, unmetered: true, degraded: true, degradedUsed, degradedLimit: degradedRequests };
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
      .then(() => {
        /* THE LOCAL LEDGER IS SETTLED TOO, or the degraded allowance measures
         * turns rather than requests. `reserve` charges it the WORST case and
         * most turns spend less; without this refund a handful of cheap turns
         * would exhaust an allowance they barely touched. Applied before the
         * store call because it is local bookkeeping either way — whether the
         * store answers has no bearing on what this process actually spent. */
        if (degraded) {
          const refund = Math.max(0, Math.floor(Number(reserved) || 0) - Math.max(0, Math.floor(Number(actual) || 0)));
          degradedUsed = Math.max(0, degradedUsed - refund);
        }
        return rpc('settle_or_requests', { p_reserved: reserved, p_actual: actual });
      })
      .then(({ data, error } = {}) => {
        if (error) return onError(`[REQUESTS] Settlement failed: ${error.message || String(error)}`);
        recovered();
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
