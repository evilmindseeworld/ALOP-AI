'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { summariseBilling, summariseEvents, unapplied, divergedPlans } = require('./billing-read-model');

const NOW = Date.parse('2026-08-17T12:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const audit = (over = {}) => ({
  user_id: 'u1',
  action: 'billing.invoice.paid',
  created_at: ago(MINUTE),
  metadata: { eventId: 'evt_1', type: 'invoice.paid', confidence: 'strong', reason: 'client_reference_id', attributed: true, applied: 1, fields: ['plan'], plan: 'pro' },
  ...over,
});

test('the ledger states are counted, and a failing event sorts by attempts', () => {
  const out = summariseEvents([
    { id: 'evt_a', type: 'invoice.paid', status: 'done', attempts: 1, processed_at: ago(MINUTE) },
    { id: 'evt_b', type: 'invoice.paid', status: 'failed', attempts: 2, processed_at: ago(MINUTE), last_error: 'timeout' },
    { id: 'evt_c', type: 'invoice.paid', status: 'failed', attempts: 5, processed_at: ago(MINUTE), last_error: 'boom' },
  ], { now: NOW });
  assert.deepEqual(out.byStatus, { done: 1, failed: 2 });
  assert.deepEqual(out.failing.map((f) => f.id), ['evt_c', 'evt_b'], 'the standing outage must be first');
  assert.equal(out.failing[0].lastError, 'boom');
});

test('a claim nobody ever took over is stuck; a fresh one is not', () => {
  const rows = [
    { id: 'evt_live', type: 'invoice.paid', status: 'processing', attempts: 1, processed_at: ago(30 * 1000) },
    { id: 'evt_dead', type: 'invoice.paid', status: 'processing', attempts: 1, processed_at: ago(3 * HOUR) },
  ];
  const out = summariseEvents(rows, { now: NOW });
  assert.deepEqual(out.stuck.map((s) => s.id), ['evt_dead']);
});

test('matching a column and updating a row are different questions', () => {
  const out = unapplied([
    audit(),
    // Matched nobody at all — already an error line today, and nothing else.
    audit({ user_id: null, metadata: { ...audit().metadata, eventId: 'evt_none', attributed: false, applied: 0 } }),
    // THE ONE THAT LOGS HEALTHY: a column matched, zero rows changed.
    audit({ metadata: { ...audit().metadata, eventId: 'evt_zero', attributed: true, applied: 0 } }),
  ]);
  assert.deepEqual(out.unattributed.map((e) => e.eventId), ['evt_none']);
  assert.deepEqual(out.matchedNothing.map((e) => e.eventId), ['evt_zero']);
});

test('a weak match is counted without being called a failure', () => {
  const out = unapplied([audit({ metadata: { ...audit().metadata, confidence: 'weak' } })]);
  assert.equal(out.weak.length, 1);
  assert.equal(out.unattributed.length, 0);
  assert.equal(out.matchedNothing.length, 0);
});

test('a user granted pro whose row says free is diverged', () => {
  const out = divergedPlans([audit()], [{ id: 'u1', plan: 'free' }]);
  assert.equal(out.length, 1);
  assert.deepEqual({ expected: out[0].expected, actual: out[0].actual }, { expected: 'pro', actual: 'free' });
});

test('a user who upgraded and then CANCELLED is not diverged', () => {
  /* The whole reason this reads events rather than the users table: after
   * customer.subscription.deleted the row keeps its stripe_subscription_id and
   * goes to free, so the naive predicate flags every churned customer. Only
   * the LATEST applied event is a claim about now. */
  const audits = [
    audit({ created_at: ago(10 * HOUR), metadata: { ...audit().metadata, eventId: 'evt_up', plan: 'pro' } }),
    audit({ created_at: ago(1 * HOUR), metadata: { ...audit().metadata, eventId: 'evt_down', type: 'customer.subscription.deleted', plan: 'free' } }),
  ];
  assert.deepEqual(divergedPlans(audits, [{ id: 'u1', plan: 'free' }]), []);
});

test('an event that patched no plan makes no claim about the plan', () => {
  // invoice.payment_failed keeps entitlement deliberately. Reading it as
  // "the plan should be whatever it was" would make it outrank the upgrade.
  const audits = [
    audit({ created_at: ago(10 * HOUR), metadata: { ...audit().metadata, eventId: 'evt_up', plan: 'pro' } }),
    audit({ created_at: ago(1 * HOUR), metadata: { eventId: 'evt_fail', type: 'invoice.payment_failed', attributed: true, applied: 1, fields: [] } }),
  ];
  const out = divergedPlans(audits, [{ id: 'u1', plan: 'free' }]);
  assert.deepEqual(out.map((d) => d.eventId), ['evt_up'], 'the last event that SAID something about the plan is the claim');
});

test('an event that changed nothing is not evidence of what the plan should be', () => {
  const audits = [audit({ metadata: { ...audit().metadata, applied: 0 } })];
  assert.deepEqual(divergedPlans(audits, [{ id: 'u1', plan: 'free' }]), []);
});

test('healthy is one boolean and any single failure clears it', () => {
  const clean = summariseBilling({
    events: [{ id: 'e', type: 'invoice.paid', status: 'done', attempts: 1, processed_at: ago(MINUTE) }],
    audits: [audit()],
    users: [{ id: 'u1', plan: 'pro' }],
    now: NOW,
  });
  assert.equal(clean.healthy, true);

  for (const broken of [
    { events: [{ id: 'e', type: 't', status: 'failed', attempts: 1, processed_at: ago(MINUTE) }] },
    { events: [{ id: 'e', type: 't', status: 'processing', attempts: 1, processed_at: ago(3 * HOUR) }] },
    { audits: [audit({ user_id: null, metadata: { ...audit().metadata, attributed: false, applied: 0 } })] },
    { audits: [audit({ metadata: { ...audit().metadata, applied: 0 } })] },
    { users: [{ id: 'u1', plan: 'free' }] },
  ]) {
    const out = summariseBilling({ events: [], audits: [audit()], users: [{ id: 'u1', plan: 'pro' }], now: NOW, ...broken });
    assert.equal(out.healthy, false, `this failure did not clear healthy: ${JSON.stringify(broken)}`);
  }
});

test('degenerate input does not throw', () => {
  for (const bad of [undefined, {}, { events: null, audits: null, users: null }]) {
    const out = summariseBilling({ ...bad, now: NOW });
    assert.equal(out.healthy, true);
    assert.equal(out.ledger.total, 0);
  }
});
