'use strict';

/**
 * WHAT HAPPENED TO THE MONEY, ANSWERABLE WITHOUT THE STRIPE DASHBOARD.
 *
 * Item 41 built the state machine — an event is `processing`, `failed` or
 * `done`, and only `done` skips a redelivery. What it could not build was the
 * other half: after all that, the only way to answer "why is this customer on
 * free when they paid" was to read Render's logs next to Stripe's dashboard and
 * join them by hand, because the ledger records that an event ARRIVED and the
 * `users` row records the CURRENT plan, and nothing in between says which event
 * produced which plan, or that an event produced nothing at all.
 *
 * THE THREE FAILURES THIS MAKES VISIBLE, none of which raises anything today:
 *
 *   1. **Unattributed.** The event was handled and matched nobody. It is
 *      already logged as an error and there it stops — a console line is not a
 *      thing you can count, sort, or check a week later.
 *   2. **Unapplied.** The event matched a column and updated ZERO rows.
 *      `.update(...).eq(...)` reports no error for that, so this one logs the
 *      HEALTHY line, marks the event `done`, and is the original paid-and-free
 *      bug reached by a different road.
 *   3. **Diverged.** The last event to be applied to a user granted `pro` and
 *      the user's row says `free` (or the reverse). Something outside the
 *      webhook wrote the plan, or a later event was lost.
 *
 * WHY NO NEW TABLE. `audit_logs` already exists, is already swept on a
 * retention schedule, is already indexed on `(action, created_at DESC)` — the
 * exact query this makes — and its rows already carry a `user_id` and a jsonb
 * bag. A `stripe_events.user_id` column would be a migration, and therefore an
 * owner action, for a link that can be written today.
 *
 * WHY NOT RECONCILE `users` ALONE. The obvious version of this — "a row with a
 * `stripe_subscription_id` and `plan = 'free'` is someone who paid and did not
 * get it" — is wrong, and quietly. `customer.subscription.deleted` sets the
 * plan to `free` and leaves the subscription id in place, so that predicate
 * matches every customer who has ever cancelled. The check would run green
 * against a broken system and red against a healthy one.
 *
 * PURE ON PURPOSE. Rows in, findings out, no database and no clock of its own —
 * the same split as `lib/evaluation.js`, and for the same reason: the part
 * worth testing exhaustively is the judgement, not the query.
 */

/**
 * How long a claim may sit in `processing` before it is a corpse.
 *
 * Well above `IN_FLIGHT_MS` (60s) in `stripe-event-ledger.js`, which is the
 * window in which a concurrent delivery is more likely than a dead one. This
 * is the OTHER end: a row still processing an hour later was not taken over by
 * anything, which means no further delivery arrived to take it over.
 */
const STUCK_MS = 60 * 60 * 1000;

/** The action prefix the webhook writes. One string, two readers. */
const BILLING_ACTION = 'billing.';

const asArray = (v) => (Array.isArray(v) ? v : []);
const meta = (row) => (row && typeof row.metadata === 'object' && row.metadata) || {};
const at = (row) => {
  const t = Date.parse((row && (row.created_at || row.processed_at)) || '');
  return Number.isFinite(t) ? t : 0;
};

/**
 * The event ledger's own health: how many of each state, what is failing, and
 * what has been claimed and abandoned.
 */
function summariseEvents(events, { now = Date.now(), stuckMs = STUCK_MS } = {}) {
  const rows = asArray(events);
  const byStatus = {};
  for (const row of rows) {
    const status = String((row && row.status) || 'unknown');
    byStatus[status] = (byStatus[status] || 0) + 1;
  }

  const failing = rows
    .filter((r) => r && r.status === 'failed')
    /* Most attempts first: an event Stripe has redelivered five times is a
     * standing outage, and one that failed once may already be fixed. */
    .sort((a, b) => Number(b.attempts || 1) - Number(a.attempts || 1) || at(b) - at(a))
    .map((r) => ({ id: r.id, type: r.type, attempts: Number(r.attempts || 1), lastError: r.last_error || null, at: r.processed_at || null }));

  const stuck = rows
    .filter((r) => r && r.status === 'processing' && at(r) > 0 && now - at(r) > stuckMs)
    .sort((a, b) => at(a) - at(b))
    .map((r) => ({ id: r.id, type: r.type, attempts: Number(r.attempts || 1), claimedAt: r.processed_at || null }));

  return { total: rows.length, byStatus, failing, stuck };
}

/**
 * The events that reached the handler and changed nobody.
 *
 * `attributed: false` is the event that matched no user at all. `applied: 0` is
 * the worse one — it matched a column, updated zero rows, and every log line
 * said the healthy thing.
 */
function unapplied(audits) {
  const out = { unattributed: [], matchedNothing: [], weak: [] };
  for (const row of asArray(audits)) {
    const m = meta(row);
    if (!m.eventId) continue;
    const entry = { eventId: m.eventId, type: m.type || null, reason: m.reason || null, at: row.created_at || null, userId: row.user_id || null };
    if (m.attributed === false) out.unattributed.push(entry);
    else if (m.applied === 0) out.matchedNothing.push(entry);
    /* Not a failure — a checkout that predates `client_reference_id` is
     * matched by email and says so. Worth counting, because a rising number
     * means the fallback is carrying traffic it was meant to retire. */
    if (m.confidence === 'weak') out.weak.push(entry);
  }
  return out;
}

/**
 * Users whose plan disagrees with the last billing event that touched them.
 *
 * ONLY THE LATEST EVENT PER USER COUNTS, and it must have actually applied. A
 * user who upgraded and then cancelled has two entries saying opposite things,
 * and only the second one is a claim about now.
 *
 * An event that patched no plan at all — `invoice.payment_failed` keeps
 * entitlement deliberately, and an unconfirmed checkout writes only ids — says
 * nothing about what the plan should be, so it is skipped rather than read as
 * a claim that the plan is unchanged.
 */
function divergedPlans(audits, users) {
  const latest = new Map();
  for (const row of asArray(audits)) {
    const m = meta(row);
    if (!row.user_id || !m.plan || m.applied === 0 || m.attributed === false) continue;
    const seen = latest.get(row.user_id);
    if (!seen || at(row) > at(seen)) latest.set(row.user_id, row);
  }

  const out = [];
  for (const user of asArray(users)) {
    const row = latest.get(user && user.id);
    if (!row) continue;
    const expected = String(meta(row).plan);
    const actual = String((user && user.plan) || 'free');
    if (expected !== actual) {
      out.push({ userId: user.id, expected, actual, since: row.created_at || null, eventId: meta(row).eventId || null, type: meta(row).type || null });
    }
  }
  /* The direction matters to whoever reads this: a user owed `pro` is a
   * customer who paid for nothing, and a user still on `pro` who should be
   * `free` is revenue leaking. The first is worse, so it sorts first. */
  return out.sort((a, b) => (a.expected === 'pro' ? -1 : 1) - (b.expected === 'pro' ? -1 : 1));
}

/**
 * The whole projection, from three ordinary selects.
 *
 * `healthy` is a single boolean because the point of a read model is that
 * somebody can look once. It is false if ANY of the three failures has an
 * instance — a stuck claim included, since a claim nothing ever took over is
 * an event that will never be applied.
 */
function summariseBilling({ events = [], audits = [], users = [], now = Date.now(), stuckMs = STUCK_MS } = {}) {
  const ledger = summariseEvents(events, { now, stuckMs });
  const missed = unapplied(audits);
  const diverged = divergedPlans(audits, users);
  const healthy =
    !ledger.failing.length &&
    !ledger.stuck.length &&
    !missed.unattributed.length &&
    !missed.matchedNothing.length &&
    !diverged.length;
  return { healthy, ledger, ...missed, diverged, generatedAt: new Date(now).toISOString() };
}

module.exports = { summariseBilling, summariseEvents, unapplied, divergedPlans, STUCK_MS, BILLING_ACTION };
