'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  claimStripeEvent,
  markStripeEventDone,
  markStripeEventFailed,
  IN_FLIGHT_MS,
} = require('./stripe-event-ledger');

/**
 * The failure being tested is the expensive one: the customer pays, the handler
 * throws, Stripe retries, and the retry is dropped as a duplicate — so `plan`
 * stays `free` for ever while every log line on the retry reads healthy.
 */

const T0 = Date.parse('2026-08-17T12:00:00.000Z');

/**
 * A fake `stripe_events` table with a real primary key.
 *
 * `hasStateColumns: false` is the shape of production before
 * 026_stripe_event_state.sql is applied: selecting `status` errors. That case
 * has to behave exactly like the old code, because this repo has already
 * shipped a migration that was never applied while its callers failed open in
 * silence (AGENTS.md, 019).
 */
const fakeDb = ({ rows = new Map(), hasStateColumns = true, insertThrows = false, insertError = null } = {}) => ({
  rows,
  from() {
    const table = {
      insert: async (row) => {
        if (insertThrows) throw new Error('socket hang up');
        if (insertError) return { error: insertError };
        if (rows.has(row.id)) return { error: { code: '23505', message: 'duplicate key' } };
        rows.set(row.id, { ...row, status: 'processing', attempts: 1, processed_at: new Date(T0).toISOString() });
        return { error: null };
      },
      select() {
        let wanted = null;
        const chain = {
          eq(_col, value) { wanted = value; return chain; },
          single: async () => {
            if (!hasStateColumns) return { data: null, error: { message: 'column stripe_events.status does not exist' } };
            const row = rows.get(wanted);
            return row ? { data: row, error: null } : { data: null, error: { message: 'no rows' } };
          },
        };
        return chain;
      },
      update(patch) {
        return {
          eq: async (_col, value) => {
            const row = rows.get(value);
            if (row) rows.set(value, { ...row, ...patch });
            return { error: null };
          },
        };
      },
    };
    return table;
  },
});

const claim = (db, extra = {}) =>
  claimStripeEvent({ db, id: 'evt_1', type: 'checkout.session.completed', now: () => T0, ...extra });

test('a first delivery is claimed and does the work', async () => {
  const result = await claim(fakeDb());
  assert.equal(result.proceed, true);
  assert.equal(result.reason, 'claimed');
});

test('a redelivery of an APPLIED event does nothing', async () => {
  const rows = new Map();
  const db = fakeDb({ rows });
  await claim(db);
  await markStripeEventDone({ db, id: 'evt_1', now: () => T0 });

  const again = await claim(db, { now: () => T0 + 5 * 60_000 });
  assert.equal(again.proceed, false);
  assert.match(again.reason, /already applied/);
});

test('THE BUG: a redelivery after a FAILED attempt does the work', async () => {
  const rows = new Map();
  const db = fakeDb({ rows });
  await claim(db);
  // The users update threw; the route answered 500 and Stripe will retry.
  await markStripeEventFailed({ db, id: 'evt_1', error: new Error('supabase timeout') });

  const retry = await claim(db, { now: () => T0 + 30_000 });
  assert.equal(retry.proceed, true, 'the retry was dropped as a duplicate and the payment is lost');
  assert.match(retry.reason, /failed/);
});

test('a failure inside the in-flight window is still retried — the clock must not outrank a known failure', async () => {
  const rows = new Map();
  const db = fakeDb({ rows });
  await claim(db);
  await markStripeEventFailed({ db, id: 'evt_1', error: new Error('nope') });
  // Well inside IN_FLIGHT_MS, where an unfinished-but-not-failed row would wait.
  const retry = await claim(db, { now: () => T0 + 1_000 });
  assert.equal(retry.proceed, true);
});

test('a second delivery arriving while the first is still working stands aside', async () => {
  const rows = new Map();
  const db = fakeDb({ rows });
  await claim(db);
  const concurrent = await claim(db, { now: () => T0 + 5_000 });
  assert.equal(concurrent.proceed, false);
  assert.match(concurrent.reason, /right now/);
});

test('an attempt that died without saying so is taken over once the window passes', async () => {
  const rows = new Map();
  const db = fakeDb({ rows });
  await claim(db);
  const later = await claim(db, { now: () => T0 + IN_FLIGHT_MS + 1 });
  assert.equal(later.proceed, true);
  assert.match(later.reason, /unfinished/);
  assert.equal(rows.get('evt_1').attempts, 2, 'a permanently failing event must be visible as one, not as silence');
});

test('before its migration is applied, it behaves exactly like the old code', async () => {
  const rows = new Map();
  const db = fakeDb({ rows, hasStateColumns: false });
  assert.equal((await claim(db)).proceed, true, 'a first delivery still works');
  const again = await claim(db, { now: () => T0 + 10 * 60_000 });
  assert.equal(again.proceed, false, 'without the status column a row means processed, as it did before');
  assert.match(again.reason, /state unreadable/);
});

test('an unreachable ledger processes the event rather than dropping a payment', async () => {
  assert.equal((await claim(fakeDb({ insertThrows: true }))).proceed, true);
  assert.equal((await claim(fakeDb({ insertError: { code: '42P01', message: 'relation does not exist' } }))).proceed, true);
});

test('the reasons name a state and never a customer', async () => {
  const rows = new Map();
  const db = fakeDb({ rows });
  const reasons = [];
  reasons.push((await claim(db)).reason);
  reasons.push((await claim(db, { now: () => T0 + 5_000 })).reason);
  await markStripeEventDone({ db, id: 'evt_1', now: () => T0 });
  reasons.push((await claim(db, { now: () => T0 + 60_000 })).reason);
  for (const reason of reasons) assert.doesNotMatch(reason, /@|cus_|evt_/);
});

test('a failure records what happened, bounded', async () => {
  const rows = new Map();
  const db = fakeDb({ rows });
  await claim(db);
  await markStripeEventFailed({ db, id: 'evt_1', error: new Error('x'.repeat(900)) });
  const row = rows.get('evt_1');
  assert.equal(row.status, 'failed');
  assert.equal(row.last_error.length, 500);
});

test('marking done clears a previous error, so a recovered event does not read as broken', async () => {
  const rows = new Map();
  const db = fakeDb({ rows });
  await claim(db);
  await markStripeEventFailed({ db, id: 'evt_1', error: new Error('transient') });
  await markStripeEventDone({ db, id: 'evt_1', now: () => T0 + 60_000 });
  assert.deepEqual(
    { status: rows.get('evt_1').status, last_error: rows.get('evt_1').last_error },
    { status: 'done', last_error: null },
  );
});
