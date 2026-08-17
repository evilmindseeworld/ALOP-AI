'use strict';

/**
 * APPLYING A BILLING EVENT TO A USER, WITHOUT LETTING AN OLD ONE WIN.
 *
 * STRIPE DOES NOT PROMISE ORDER. Its own documentation says events may arrive
 * out of order, and a redelivery after a 500 arrives minutes after the event
 * that followed it. Nothing in this codebase compared timestamps: the handler
 * took whichever delivery landed last and wrote its plan. So
 *
 *   customer.subscription.updated (active)   created 12:00:00
 *   customer.subscription.deleted            created 12:00:05
 *
 * delivered in the other order leaves a cancelled customer on `pro`, forever,
 * with every log line reading healthy — and unlike the paid-and-free bugs this
 * one is invisible from the user's side too, because the user is happy.
 *
 * THE GUARD IS IN THE PREDICATE, NOT IN JAVASCRIPT. Reading the row, comparing
 * in memory and then writing has a race exactly the width of the round trip,
 * and two concurrent deliveries of two events is precisely the case this
 * exists for. `stripe_event_at` is compared and written in ONE statement, so
 * the loser of the race changes nothing.
 *
 * ZERO ROWS NOW MEANS TWO DIFFERENT THINGS and the difference matters: a stale
 * event is the guard working, and an event that matched no user row at all is
 * the paid-and-free bug. Only the second is an error, so the zero-row path
 * costs one extra select to tell them apart. It is the rare path.
 *
 * WORKS BEFORE ITS MIGRATION IS APPLIED, for the same reason
 * `stripe-event-ledger.js` does: this repo has shipped a migration that sat
 * unapplied for weeks while the code that needed it failed silently. Without
 * 027 the column does not exist, the guarded update errors, and this falls back
 * to the unguarded write — the old last-delivered-wins behaviour, reported as
 * `ordered: false` so the caller can say so out loud rather than believing it
 * is protected.
 */

/** Postgres "column does not exist"; PostgREST's stale-schema-cache answer. */
const MISSING_COLUMN = new Set(['42703', 'PGRST204']);

const isMissingColumn = (error) =>
  Boolean(error) &&
  (MISSING_COLUMN.has(String(error.code || '')) ||
    /stripe_event_at/.test(String(error.message || '')));

/**
 * Stripe's `created` is UNIX seconds. A missing or absurd value must not
 * become 1970 — that would make the event older than everything and silently
 * unappliable forever. No timestamp means no ordering claim, so the guard is
 * skipped for that event rather than applied with a made-up number.
 */
function eventTimestamp(event) {
  const seconds = Number(event && event.created);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const ms = seconds * 1000;
  // A far-future timestamp would pin the row and reject every later event.
  if (ms > Date.now() + 24 * 60 * 60 * 1000) return null;
  return new Date(ms).toISOString();
}

/**
 * Write a billing patch to the one user row it addresses.
 *
 * @param {object} deps
 * @param {{from: Function}} deps.db
 * @param {{column: string, value: string}} deps.match
 * @param {object} deps.patch      the fields the event decided
 * @param {string|null} deps.at    ISO timestamp of the event, or null
 * @returns {Promise<{applied: number, stale: boolean, missing: boolean, ordered: boolean}>}
 */
async function applyBillingPatch({ db, match, patch, at }) {
  const base = () => db.from('users').update(at ? { ...patch, stripe_event_at: at } : patch).eq(match.column, match.value);

  let data = null;
  let ordered = Boolean(at);
  if (at) {
    /* `is.null` is not redundant with `lte`: a row that has never had a
     * billing event has no timestamp, and a NULL comparison is NULL, not
     * true — without this clause the FIRST event for every user is rejected
     * as stale, which is the guard eating the thing it protects.
     *
     * `lte`, not `lt`: a redelivery of the SAME event carries the same
     * timestamp and must still be able to complete the work its first
     * delivery failed at. Two DIFFERENT events in one second are then
     * order-dependent, which is the one case this does not cover. */
    const { data: guarded, error } = await base().or(`stripe_event_at.is.null,stripe_event_at.lte.${at}`).select('id');
    if (error && !isMissingColumn(error)) throw error;
    if (error) {
      // 027 is not applied. Fall back to the old behaviour, and say so.
      ordered = false;
      const { data: plain, error: plainError } = await db.from('users').update(patch).eq(match.column, match.value).select('id');
      if (plainError) throw plainError;
      data = plain || [];
    } else {
      data = guarded || [];
    }
  } else {
    const { data: plain, error } = await base().select('id');
    if (error) throw error;
    data = plain || [];
  }

  if (data.length) return { applied: data.length, userId: data[0].id, stale: false, missing: false, ordered };

  /* Zero rows. Either the guard rejected a stale event — which is the guard
   * doing its job and must not be reported as a failure — or the event named
   * a user row that is not there, which is the failure that used to log the
   * healthy line. One select tells them apart. */
  const { data: existing } = await db.from('users').select('id').eq(match.column, match.value).limit(1);
  const exists = Boolean(existing && existing.length);
  return { applied: 0, userId: exists ? existing[0].id : null, stale: ordered && exists, missing: !exists, ordered };
}

module.exports = { applyBillingPatch, eventTimestamp, isMissingColumn };
