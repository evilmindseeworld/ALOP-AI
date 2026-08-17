'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { applyBillingPatch, eventTimestamp, isMissingColumn } = require('./stripe-apply');

/**
 * A fake PostgREST chain that records what was asked and answers what it was
 * told to. The assertions that matter are about the PREDICATE — the guard is
 * in the statement, so a test that only checked the return value would pass
 * against a version that compared nothing.
 */
const fakeDb = ({ updated = [], existing = [], updateError = null, calls = [] } = {}) => ({
  calls,
  from(table) {
    const state = { table, filters: [], op: null, values: null };
    calls.push(state);
    const chain = {
      update(values) { state.op = 'update'; state.values = values; return chain; },
      select(cols) {
        state.select = cols;
        if (state.op === 'update') return Promise.resolve({ data: updateError ? null : updated, error: updateError });
        return chain;
      },
      eq(column, value) { state.filters.push(`eq:${column}`); return chain; },
      or(expr) { state.filters.push(`or:${expr}`); return chain; },
      limit() { return Promise.resolve({ data: existing, error: null }); },
    };
    return chain;
  },
});

const MATCH = { column: 'clerk_id', value: 'user_abc' };
const AT = '2026-08-18T12:00:00.000Z';

test('the ordering guard is in the predicate, not in JavaScript', async () => {
  const db = fakeDb({ updated: [{ id: 'u1' }] });
  const out = await applyBillingPatch({ db, match: MATCH, patch: { plan: 'pro' }, at: AT });
  assert.equal(out.applied, 1);
  assert.equal(out.ordered, true);
  const update = db.calls.find((c) => c.op === 'update');
  /* Both halves. `is.null` is not redundant: a user who has never had a
   * billing event has no high-water mark, and a NULL comparison is NULL — so
   * without it the FIRST event for every user is rejected as stale. */
  assert.ok(update.filters.some((f) => f.includes('stripe_event_at.is.null')), 'a first event would be rejected as stale');
  assert.ok(update.filters.some((f) => f.includes(`stripe_event_at.lte.${AT}`)), 'nothing compares the event time');
  assert.equal(update.values.stripe_event_at, AT, 'the high-water mark must advance in the same statement it is compared in');
});

test('zero rows is a stale event OR a missing user, and they are not the same', async () => {
  // The row exists and the guard rejected the write: the guard working.
  const stale = await applyBillingPatch({ db: fakeDb({ updated: [], existing: [{ id: 'u1' }] }), match: MATCH, patch: { plan: 'pro' }, at: AT });
  assert.deepEqual({ stale: stale.stale, missing: stale.missing }, { stale: true, missing: false });

  // No such row: the paid-and-free failure, which must stay loud.
  const missing = await applyBillingPatch({ db: fakeDb({ updated: [], existing: [] }), match: MATCH, patch: { plan: 'pro' }, at: AT });
  assert.deepEqual({ stale: missing.stale, missing: missing.missing }, { stale: false, missing: true });
});

test('without 027 it falls back to the old write and SAYS the guard is off', async () => {
  let first = true;
  const inner = fakeDb({ updated: [{ id: 'u1' }] });
  const db = {
    calls: inner.calls,
    from(table) {
      const chain = inner.from(table);
      const select = chain.select;
      chain.select = (cols) => {
        // The guarded attempt errors exactly as Postgres does for a column
        // that does not exist; the unguarded retry succeeds.
        if (first) { first = false; return Promise.resolve({ data: null, error: { code: '42703', message: 'column users.stripe_event_at does not exist' } }); }
        return select(cols);
      };
      return chain;
    },
  };
  const out = await applyBillingPatch({ db, match: MATCH, patch: { plan: 'pro' }, at: AT });
  assert.equal(out.applied, 1, 'the write must still happen; a missing migration may not drop a payment');
  assert.equal(out.ordered, false, 'the caller must be told the guard was inactive rather than believing it ran');
  const retry = db.calls.filter((c) => c.op === 'update').pop();
  assert.ok(!retry.filters.some((f) => f.startsWith('or:')), 'the fallback must not carry the predicate that just failed');
  assert.equal(retry.values.stripe_event_at, undefined, 'the fallback must not write a column that does not exist');
});

test('a real error is not swallowed as a missing column', async () => {
  const db = fakeDb({ updateError: { code: '08006', message: 'connection failure' } });
  await assert.rejects(() => applyBillingPatch({ db, match: MATCH, patch: { plan: 'pro' }, at: AT }));
});

test('a missing or absurd event time makes no ordering claim', () => {
  assert.equal(eventTimestamp({ created: Math.floor(Date.parse(AT) / 1000) }), AT);
  // Not 1970: a bogus zero would make the event older than everything and
  // permanently unappliable.
  assert.equal(eventTimestamp({}), null);
  assert.equal(eventTimestamp({ created: 0 }), null);
  assert.equal(eventTimestamp({ created: 'nonsense' }), null);
  // A far-future stamp would pin the row and reject every later event.
  assert.equal(eventTimestamp({ created: Math.floor(Date.now() / 1000) + 90000 }), null);
});

test('no event time means the write happens unguarded rather than not at all', async () => {
  const db = fakeDb({ updated: [{ id: 'u1' }] });
  const out = await applyBillingPatch({ db, match: MATCH, patch: { plan: 'pro' }, at: null });
  assert.equal(out.applied, 1);
  assert.equal(out.ordered, false);
  const update = db.calls.find((c) => c.op === 'update');
  assert.ok(!update.filters.some((f) => f.startsWith('or:')));
});

test('a missing column is recognised by code or by name, not by luck', () => {
  assert.equal(isMissingColumn({ code: '42703' }), true);
  assert.equal(isMissingColumn({ code: 'PGRST204' }), true);
  assert.equal(isMissingColumn({ code: 'X', message: "column 'stripe_event_at' unknown" }), true);
  assert.equal(isMissingColumn({ code: '08006', message: 'connection failure' }), false);
  assert.equal(isMissingColumn(null), false);
});
