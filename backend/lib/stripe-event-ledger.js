'use strict';

/**
 * Whether this delivery of a Stripe event should do the work.
 *
 * THE BUG THIS EXISTS TO CLOSE. `stripe_events` was claimed before the work and
 * never released, and the webhook read "a row exists" as "it was applied". A
 * handler that threw answered 500 — correctly, so that Stripe would retry — and
 * the retry then hit the primary key and was dropped as a duplicate. The
 * customer had paid, `plan` stayed `free`, and every line the retry logged said
 * the healthy thing. At-least-once delivery is only worth having if the second
 * delivery can still do the work.
 *
 * So the ledger now carries a state, and only `done` means done.
 *
 * EVERY FAILURE HERE FAILS OPEN — an unreachable or unreadable ledger returns
 * "process it". That is the same trade the original code made and it is the
 * right one for this table: re-applying a plan change writes the same fields to
 * the same values, while dropping a paid subscription is unrecoverable and
 * invisible. The one place that is not true is a future handler that GRANTS
 * something cumulative — credits, a coupon, a referral bonus. Such a handler
 * must not rely on this; it needs its own idempotency key on the thing it
 * grants.
 * ponytail: single row-level claim, no lease renewal. If handlers ever get slow
 * enough that IN_FLIGHT_MS matters, make the claim a conditional UPDATE that
 * takes a lease.
 *
 * WORKS BEFORE ITS MIGRATION IS APPLIED. `026_stripe_event_state.sql` adds the
 * columns; until it runs, reading `status` errors, and this falls back to
 * exactly the old behaviour (a row means processed). That matters because this
 * repo has shipped a migration that was never applied while the code calling it
 * failed open in silence — see AGENTS.md on 019.
 */

/**
 * How long a claim is assumed to be someone else's live attempt.
 *
 * Stripe's redeliveries are minutes apart, so anything inside this window is
 * far more likely to be a concurrent delivery of the same event than a retry of
 * a dead one — and two deliveries doing the work at once is the thing the
 * ledger is for. A crashed attempt is picked up by the delivery after this.
 */
const IN_FLIGHT_MS = 60_000;

const DUPLICATE = '23505';

/**
 * @param {object} deps
 * @param {{from: Function}} deps.db
 * @param {string} deps.id     Stripe's evt_… id
 * @param {string} deps.type
 * @param {() => number} [deps.now]
 * @returns {Promise<{proceed: boolean, reason: string}>}
 *   `reason` is safe to log: it names a state, never a customer.
 */
async function claimStripeEvent({ db, id, type, now = Date.now }) {
  let insertError = null;
  try {
    const { error } = await db.from('stripe_events').insert({ id, type });
    insertError = error || null;
  } catch (err) {
    // A throw is not a duplicate; it is the table being unreachable.
    return { proceed: true, reason: `ledger-threw: ${err.message}` };
  }

  if (!insertError) return { proceed: true, reason: 'claimed' };
  if (insertError.code !== DUPLICATE) {
    return { proceed: true, reason: `ledger-unavailable: ${insertError.message}` };
  }

  // A row already exists. The only question left is whether it finished.
  let row = null;
  try {
    const { data, error } = await db
      .from('stripe_events')
      .select('status, processed_at, attempts')
      .eq('id', id)
      .single();
    /* No status column means 026 has not been applied, and under the code that
     * predates it a row DID mean processed. Returning "process it" here would
     * replay every duplicate Stripe sends until someone runs the migration. */
    if (error) return { proceed: false, reason: 'duplicate (state unreadable; assuming processed)' };
    row = data || {};
  } catch (err) {
    return { proceed: false, reason: `duplicate (state unreadable: ${err.message})` };
  }

  if (row.status === 'done') return { proceed: false, reason: 'duplicate (already applied)' };

  /* BEFORE the in-flight window, not after it. A failed attempt writes `failed`
   * and leaves `processed_at` where it was, and Stripe's first retry can easily
   * land inside the window — so checking the clock first would read a KNOWN
   * failure as a live attempt and skip it. That is the original bug wearing a
   * new status. */
  if (row.status === 'failed') return { proceed: true, reason: 'retrying an attempt that failed' };

  const claimedAt = Date.parse(row.processed_at || '');
  if (Number.isFinite(claimedAt) && now() - claimedAt < IN_FLIGHT_MS) {
    return { proceed: false, reason: 'another delivery is applying this right now' };
  }

  /* The previous attempt claimed the event and did not finish it. This is the
   * whole point: take it over, and count the attempt so a permanently failing
   * event is visible as one rather than as silence. */
  try {
    await db
      .from('stripe_events')
      .update({ status: 'processing', processed_at: new Date(now()).toISOString(), attempts: Number(row.attempts || 1) + 1 })
      .eq('id', id);
  } catch { /* best effort; the work matters more than the counter */ }
  return { proceed: true, reason: `retaking an unfinished attempt (${Number(row.attempts || 1) + 1})` };
}

/** The work succeeded. This is the only thing that makes a duplicate a no-op. */
async function markStripeEventDone({ db, id, now = Date.now }) {
  try {
    const { error } = await db
      .from('stripe_events')
      .update({ status: 'done', processed_at: new Date(now()).toISOString(), last_error: null })
      .eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

/**
 * The work failed. The row STAYS claimable, which is the point — the state is
 * recorded so a human can see it, not so the next delivery skips it.
 */
async function markStripeEventFailed({ db, id, error }) {
  try {
    const { error: writeError } = await db
      .from('stripe_events')
      .update({ status: 'failed', last_error: String(error?.message || error || '').slice(0, 500) })
      .eq('id', id);
    return !writeError;
  } catch {
    return false;
  }
}

module.exports = { claimStripeEvent, markStripeEventDone, markStripeEventFailed, IN_FLIGHT_MS };
