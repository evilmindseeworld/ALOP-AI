'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createReservationLedger } = require('./reservation-ledger');

const LIMITS = { dayCents: 500, monthCents: 2000 };

/** An rpc double that answers per function name and can be made to fail. */
const rpcDouble = (handlers = {}) => {
  const calls = [];
  const rpc = async (fn, args) => {
    calls.push({ fn, args });
    const handler = handlers[fn];
    if (typeof handler === 'function') return handler(args, calls);
    return { data: handler ?? null, error: null };
  };
  rpc.calls = calls;
  rpc.countOf = (fn) => calls.filter((c) => c.fn === fn).length;
  return rpc;
};

const admitting = (extra = {}) => rpcDouble({
  claim_turn_reservation: [{ claimed: true, state: 'reserved' }],
  reserve_user_spend: [{ allowed: true, day_cents: 40, month_cents: 120 }],
  settle_turn_reservation: [{ settled: true, prior_cents: 40, prior_requests: 3 }],
  settle_user_spend: null,
  ...extra,
});

const quiet = { onError: () => {}, onWarn: () => {} };

test('a healthy reservation reports the balances the ceiling decided on', async () => {
  const rpc = admitting();
  const ledger = createReservationLedger({ rpc, limits: LIMITS, ...quiet });
  const result = await ledger.reserve({ turnId: 't1', operationId: 'op1', userId: 'u1', cents: 40, requests: 30 });
  assert.deepEqual(result, { allowed: true, dayCents: 40, monthCents: 120 });
  assert.equal(rpc.countOf('claim_turn_reservation'), 1);
  assert.equal(rpc.countOf('reserve_user_spend'), 1);
});

/* IDEMPOTENCE, WHICH IS THE WHOLE REASON THIS MODULE EXISTS.
 * `reserve_user_spend` is atomic — the increment and the limit test are under
 * one row lock — and atomic is not the same as once. */
test('a second reservation for one turn does not charge again', async () => {
  const rpc = admitting();
  const ledger = createReservationLedger({ rpc, limits: LIMITS, ...quiet });
  const first = await ledger.reserve({ turnId: 't1', userId: 'u1', cents: 40 });
  const second = await ledger.reserve({ turnId: 't1', userId: 'u1', cents: 40 });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(second.duplicate, true);
  assert.equal(rpc.countOf('reserve_user_spend'), 1, 'the money moved exactly once');
});

test('a duplicate claimed by ANOTHER process is admitted and not charged here', async () => {
  const rpc = admitting({ claim_turn_reservation: [{ claimed: false, state: 'reserved' }] });
  const ledger = createReservationLedger({ rpc, limits: LIMITS, ...quiet });
  const result = await ledger.reserve({ turnId: 't1', userId: 'u1', cents: 40 });
  assert.equal(result.allowed, true, 'the turn WAS admitted; it simply was not admitted here');
  assert.equal(result.duplicate, true);
  assert.equal(rpc.countOf('reserve_user_spend'), 0);
});

test('a refused ceiling is reported with the balances that refused it', async () => {
  const rpc = admitting({ reserve_user_spend: [{ allowed: false, day_cents: 505, month_cents: 900 }] });
  const ledger = createReservationLedger({ rpc, limits: LIMITS, ...quiet });
  const result = await ledger.reserve({ turnId: 't', userId: 'u', cents: 40 });
  assert.equal(result.allowed, false);
  assert.equal(result.dayCents, 505);
});

/* ---- the bounded fail-open --------------------------------------------- */

/* The ARGUMENT for admitting through a database blip is kept: failing closed
 * turns a partial dependency failure into a total outage. What was wrong is
 * that "open" meant UNLIMITED — an outage of any length admitted every turn
 * from every user, and the only number anyone could look at lived in the store
 * that was down. */
test('an unreachable store admits from a bounded local allowance and then refuses', async () => {
  const errors = [];
  const rpc = rpcDouble({
    claim_turn_reservation: () => { throw new Error('down'); },
    reserve_user_spend: () => { throw new Error('down'); },
  });
  const ledger = createReservationLedger({
    rpc, limits: { ...LIMITS, degradedCents: 100 }, onWarn: () => {}, onError: (m) => errors.push(m),
  });

  const first = await ledger.reserve({ turnId: 't1', userId: 'u', cents: 60 });
  assert.equal(first.allowed, true);
  assert.equal(first.unmetered, true);
  assert.equal(first.degraded, true);

  // 60 + 60 > 100: a turn is either fully covered by the allowance or refused.
  // Admitting one that overruns it by half would make the ceiling a suggestion.
  const second = await ledger.reserve({ turnId: 't2', userId: 'u', cents: 60 });
  assert.equal(second.allowed, false);
  assert.equal(second.degraded, true);
  assert.equal(second.degradedLimit, 100);
  assert.match(errors.join('\n'), /degraded allowance is spent/);
});

test('the degraded allowance defaults to a strict fraction of the day', () => {
  const rpc = rpcDouble({});
  assert.equal(createReservationLedger({ rpc, limits: { dayCents: 500, monthCents: 2000 }, ...quiet }).degradedLimit(), 25);
  // A tiny limit still admits something rather than failing closed on a blink.
  assert.equal(createReservationLedger({ rpc, limits: { dayCents: 4, monthCents: 10 }, ...quiet }).degradedLimit(), 1);
});

test('settling in degraded mode refunds the local allowance, or it measures turns not money', async () => {
  const rpc = rpcDouble({
    claim_turn_reservation: () => { throw new Error('down'); },
    reserve_user_spend: () => { throw new Error('down'); },
    settle_turn_reservation: [{ settled: true, prior_cents: 0, prior_requests: 0 }],
    settle_user_spend: null,
  });
  const ledger = createReservationLedger({ rpc, limits: { ...LIMITS, degradedCents: 100 }, ...quiet });

  await ledger.reserve({ turnId: 't1', userId: 'u', cents: 60 });
  // The pessimistic 60 was reserved; the turn actually cost 5.
  await ledger.settle({ turnId: 't1', userId: 'u', reservedCents: 60, actualCents: 5 });
  // 55 came back, so a second 60c turn now fits where it previously would not.
  const second = await ledger.reserve({ turnId: 't2', userId: 'u', cents: 60 });
  assert.equal(second.allowed, true);
});

test('recovery needs no intervention', async () => {
  const warnings = [];
  let down = true;
  const rpc = rpcDouble({
    claim_turn_reservation: () => (down ? (() => { throw new Error('down'); })() : { data: [{ claimed: true, state: 'reserved' }], error: null }),
    reserve_user_spend: () => (down ? (() => { throw new Error('down'); })() : { data: [{ allowed: true, day_cents: 1, month_cents: 1 }], error: null }),
  });
  const ledger = createReservationLedger({ rpc, limits: LIMITS, onError: () => {}, onWarn: (m) => warnings.push(m) });
  await ledger.reserve({ turnId: 't1', userId: 'u', cents: 1 });
  assert.equal(ledger.isDegraded(), true);
  down = false;
  await ledger.reserve({ turnId: 't2', userId: 'u', cents: 1 });
  assert.equal(ledger.isDegraded(), false);
  assert.match(warnings.join('\n'), /metered admission resumed/);
});

/* ---- settlement --------------------------------------------------------- */

test('a second settlement for one turn does not refund twice', async () => {
  let settledOnce = false;
  const rpc = rpcDouble({
    claim_turn_reservation: [{ claimed: true, state: 'reserved' }],
    reserve_user_spend: [{ allowed: true, day_cents: 1, month_cents: 1 }],
    settle_turn_reservation: () => {
      const data = [{ settled: !settledOnce, prior_cents: 40, prior_requests: 0 }];
      settledOnce = true;
      return { data, error: null };
    },
    settle_user_spend: null,
  });
  const ledger = createReservationLedger({ rpc, limits: LIMITS, ...quiet });
  await ledger.reserve({ turnId: 't', userId: 'u', cents: 40 });
  const first = await ledger.settle({ turnId: 't', userId: 'u', reservedCents: 40, actualCents: 8 });
  const second = await ledger.settle({ turnId: 't', userId: 'u', reservedCents: 40, actualCents: 8 });
  assert.equal(first.settled, true);
  assert.deepEqual(second, { settled: false, duplicate: true });
  assert.equal(rpc.countOf('settle_user_spend'), 1, 'the refund was applied once');
});

/* The guard being down must not stop a refund. The exposure is a double refund
 * during an outage, which errs towards the USER rather than the house — the
 * safe direction for a ceiling whose purpose is not to over-charge. */
test('a settlement whose idempotency guard is down still refunds, loudly', async () => {
  const errors = [];
  const rpc = rpcDouble({
    settle_turn_reservation: () => { throw new Error('guard down'); },
    settle_user_spend: null,
  });
  const ledger = createReservationLedger({ rpc, limits: LIMITS, onError: (m) => errors.push(m), onWarn: () => {} });
  const result = await ledger.settle({ turnId: 't', userId: 'u', reservedCents: 40, actualCents: 8 });
  assert.equal(result.settled, true);
  assert.equal(rpc.countOf('settle_user_spend'), 1);
  assert.match(errors.join('\n'), /Settlement guard failed/);
});

/* It runs from a `finally` where the client may already be gone. An unhandled
 * rejection there ends the process under Node's default policy. */
test('a settlement that fails outright rejects nothing', async () => {
  const rpc = rpcDouble({
    settle_turn_reservation: [{ settled: true, prior_cents: 0, prior_requests: 0 }],
    settle_user_spend: () => { throw new Error('gone'); },
  });
  const ledger = createReservationLedger({ rpc, limits: LIMITS, ...quiet });
  assert.deepEqual(await ledger.settle({ turnId: 't', userId: 'u', reservedCents: 1, actualCents: 0 }), { settled: false });
  assert.deepEqual(await ledger.settle({ turnId: null, userId: 'u', reservedCents: 1, actualCents: 0 }), { settled: false });
});

test('the duplicate memory is bounded so a long-lived process cannot grow it forever', async () => {
  const rpc = admitting();
  const ledger = createReservationLedger({ rpc, limits: LIMITS, ...quiet });
  for (let i = 0; i < 5_200; i++) await ledger.reserve({ turnId: `t${i}`, userId: 'u', cents: 1 });
  // The oldest entries are evicted, so an ancient turn id reserves again rather
  // than being remembered forever. The DURABLE guard is the SQL, not this.
  const before = rpc.countOf('reserve_user_spend');
  const again = await ledger.reserve({ turnId: 't0', userId: 'u', cents: 1 });
  assert.equal(again.duplicate, undefined, 'evicted, so no in-process short circuit');
  assert.equal(rpc.countOf('reserve_user_spend'), before + 1);
  // …and a RECENT one is still remembered.
  const recent = await ledger.reserve({ turnId: 't5199', userId: 'u', cents: 1 });
  assert.equal(recent.duplicate, true);
});

test('a reservation without a turn id is a programming error, not a silent charge', async () => {
  const ledger = createReservationLedger({ rpc: admitting(), limits: LIMITS, ...quiet });
  await assert.rejects(() => ledger.reserve({ userId: 'u', cents: 1 }), TypeError);
});
