'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const SPEND_ENV_KEYS = [
  'SPEND_SEAT_TENTHS',
  'SPEND_TOOL_SEAT_TENTHS',
  'SPEND_SYNTHESIS_TENTHS',
  'SPEND_FAST_TENTHS',
  'SPEND_SEARCH_TENTHS',
  'SPEND_FETCH_TENTHS',
  'SPEND_DAY_CENTS',
  'SPEND_MONTH_CENTS',
];
const spendPath = require.resolve('./spend');

const captureSpendEnv = () => Object.fromEntries(SPEND_ENV_KEYS.map((key) => [key, process.env[key]]));

const restoreSpendEnv = (saved) => {
  for (const key of SPEND_ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
};

/* Keep the ordinary tests deterministic even if a developer has local SPEND_*
 * values, then put that module back after the module-load override tests. */
const savedInitialEnv = captureSpendEnv();
for (const key of SPEND_ENV_KEYS) delete process.env[key];
delete require.cache[spendPath];
const defaultSpend = require(spendPath);
const defaultSpendModule = require.cache[spendPath];
restoreSpendEnv(savedInitialEnv);

const loadSpendWithEnv = (overrides) => {
  const saved = captureSpendEnv();
  try {
    for (const key of SPEND_ENV_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(overrides)) process.env[key] = String(value);
    delete require.cache[spendPath];
    return require(spendPath);
  } finally {
    restoreSpendEnv(saved);
    delete require.cache[spendPath];
    require.cache[spendPath] = defaultSpendModule;
  }
};

const seat = (outcome = 'answered') => ({
  phase: 'council',
  round: 1,
  model: 'test-seat',
  ms: 100,
  outcome,
});

const sevenSeatSnapshot = (outcome = 'answered') => ({
  seats: Array.from({ length: 7 }, () => seat(outcome)),
  synthesisMs: 1,
});

test('every ordinary price is a non-negative integer number of cents', () => {
  // Money must stay integral at the module boundary even when operation rates
  // are expressed in tenths of a cent internally.
  const snapshots = [
    {},
    { seats: [] },
    { seats: [seat()], synthesisMs: 1 },
    { seats: [seat()], toolRounds: [{ calls: 2 }] },
    { ...sevenSeatSnapshot(), fallbackCouncil: { used: true }, toolRounds: [{ calls: 12 }] },
  ];

  for (const snapshot of snapshots) {
    const cents = defaultSpend.priceTurn(snapshot);
    assert.equal(Number.isInteger(cents), true, JSON.stringify(snapshot));
    assert.ok(cents >= 0, JSON.stringify(snapshot));
  }

  for (const args of [[], [7, 12]]) {
    const cents = defaultSpend.reservationCents(...args);
    assert.equal(Number.isInteger(cents), true, JSON.stringify(args));
    assert.ok(cents >= 0, JSON.stringify(args));
  }
});

test('rounding protects the owner by rounding a fractional cent up', () => {
  // One default seat is 0.4 cents: Math.round would produce zero, making a
  // real provider call free, while Math.ceil correctly charges one cent.
  assert.equal(defaultSpend.PRICES.seatTenths, 4);
  assert.notEqual(
    Math.round(defaultSpend.PRICES.seatTenths / 10),
    Math.ceil(defaultSpend.PRICES.seatTenths / 10),
  );
  assert.equal(defaultSpend.priceTurn({ seats: [seat()] }), 1);
});

test('a timed-out seat costs the same as a usable seat because the provider ran', () => {
  const allAnswered = {
    seats: Array.from({ length: 7 }, () => seat('answered')),
    synthesisMs: 1,
  };
  const oneUsable = {
    seats: [seat('answered'), ...Array.from({ length: 6 }, () => seat('timed_out'))],
    synthesisMs: 1,
  };

  assert.equal(defaultSpend.priceTurn(oneUsable), defaultSpend.priceTurn(allAnswered));
});

test('using the fallback council materially increases the turn price', () => {
  // The fallback is a second council run, not a free error-handling branch.
  const normal = sevenSeatSnapshot();
  const withFallback = { ...normal, fallbackCouncil: { used: true } };

  assert.ok(defaultSpend.priceTurn(withFallback) > defaultSpend.priceTurn(normal));
});

/* THE LOAD-BEARING PROPERTY, and the first version of this test passed while
 * it was false.
 *
 * The reservation is taken before the turn and refunded down to the real cost
 * afterwards, so if a real turn can cost MORE than it reserved, the excess is
 * only discovered at settlement — by which point several concurrent turns have
 * each been admitted on an under-estimate and the ceiling has been walked past.
 *
 * The original modelled four rounds of TOOL CALLS against a SINGLE round of
 * seats, which is the intuitive reading of "a seven-seat turn" and is not what
 * the loop records. `telemetry.recordSeat` pushes one record per member per
 * round — the record carries a `round` field for exactly that reason — so four
 * rounds against seven seats is 28 seat records, all of which `priceTurn`
 * charges. The reservation priced 14. Found by Sol in review, not by this test.
 *
 * It now builds the seat list the way the telemetry actually accumulates it. */
test('the pessimistic reservation covers the worst turn the loop can produce', () => {
  const ROUNDS = 4;   // agent-loop.js maxRounds
  const CALLS = 12;   // agent-loop.js maxUniqueCalls — per TURN, across rounds
  const SEATS = 7;

  /* One seat record per member per round, which is what recordSeat does — AND
   * the intervening plain-council fallback, which this test missed on its first
   * two versions and Sol caught both times.
   *
   * server.js has three `reportCouncilTiming` sites that can run in sequence on
   * one turn: 'tools' (the loop, once per round), 'tool_plain_fallback' (a full
   * roster when the loop yields nothing usable), and then the post-council
   * fallback on top. Modelling only the loop understates the worst case by a
   * whole roster, which is precisely the direction that breaks the ceiling. */
  const seats = [];
  for (let round = 1; round <= ROUNDS; round++) {
    for (let s = 0; s < SEATS; s++) {
      seats.push({ phase: 'tools', round, model: `m${s}`, ms: 1, outcome: 'answered' });
    }
  }
  for (let s = 0; s < SEATS; s++) {
    seats.push({ phase: 'tool_plain_fallback', round: 1, model: `m${s}`, ms: 1, outcome: 'answered' });
  }

  const worstTurn = {
    seats,
    synthesisMs: 1,
    fallbackCouncil: { used: true, durationMs: 1, kind: 'post_council' },
    toolRounds: Array.from({ length: ROUNDS }, (_, i) => ({
      round: i + 1, calls: CALLS / ROUNDS, durationMs: 1, aborted: false,
    })),
  };

  const reserved = defaultSpend.reservationCents(SEATS, CALLS, ROUNDS);
  const actual = defaultSpend.priceTurn(worstTurn);

  assert.equal(Number.isInteger(reserved), true);
  assert.ok(reserved >= actual, `reservation ${reserved} < turn price ${actual}`);
});

/* The fallback prices itself off `seats.length`, which in a multi-round turn is
 * already the accumulated total. Pin that the reservation still covers the
 * single-round case too, so a fix for the many-round case cannot quietly stop
 * covering the common one. */
test('the reservation also covers an ordinary single-round turn', () => {
  const single = {
    ...sevenSeatSnapshot(),
    fallbackCouncil: { used: true, durationMs: 1, kind: 'post_council' },
    toolRounds: [{ round: 1, calls: 12, durationMs: 1, aborted: false }],
  };
  assert.ok(defaultSpend.reservationCents(7, 12, 4) >= defaultSpend.priceTurn(single));
});

test('degenerate snapshots do not throw and still return safe cents', () => {
  // Aborted turns can be partial, and malformed values must not turn a NaN
  // comparison into a silent bypass of the spend ceiling.
  const snapshots = [
    undefined,
    {},
    null,
    { seats: undefined },
    { seats: -7, synthesisMs: 'not-a-number', toolRounds: 'not-an-array' },
    { seats: 'seven', toolRounds: [{ calls: 'not-a-number' }, { calls: -3 }, null] },
  ];

  for (const snapshot of snapshots) {
    assert.doesNotThrow(() => {
      const cents = defaultSpend.priceTurn(snapshot);
      assert.equal(Number.isInteger(cents), true, String(snapshot));
      assert.ok(cents >= 0, String(snapshot));
    }, String(snapshot));
  }
});

test('malformed reservation arguments do not produce invalid cents', () => {
  // Admission happens before a telemetry snapshot exists, so this boundary
  // needs the same poison resistance as priceTurn even for bad caller input.
  for (const args of [[-1, -1], ['not-a-number', 12], [7, 'not-a-number']]) {
    const cents = defaultSpend.reservationCents(...args);
    assert.equal(Number.isInteger(cents), true, JSON.stringify(args));
    assert.ok(cents >= 0, JSON.stringify(args));
  }
});

test('valid SPEND environment overrides are read when the module loads', () => {
  const configured = loadSpendWithEnv({
    SPEND_SEAT_TENTHS: 7,
    SPEND_TOOL_SEAT_TENTHS: 21,
    SPEND_SYNTHESIS_TENTHS: 8,
    SPEND_FAST_TENTHS: 9,
    SPEND_SEARCH_TENTHS: 10,
    SPEND_FETCH_TENTHS: 11,
    SPEND_DAY_CENTS: 1234,
    SPEND_MONTH_CENTS: 5678,
  });

  assert.deepEqual(configured.PRICES, {
    seatTenths: 7,
    toolSeatTenths: 21,
    synthesisTenths: 8,
    fastTenths: 9,
    searchTenths: 10,
    fetchTenths: 11,
  });
  assert.deepEqual(configured.LIMITS, { dayCents: 1234, monthCents: 5678 });
});

test('garbage SPEND environment values fall back to finite defaults', () => {
  const configured = loadSpendWithEnv({
    SPEND_SEAT_TENTHS: 'garbage',
    SPEND_TOOL_SEAT_TENTHS: 'garbage',
    SPEND_SYNTHESIS_TENTHS: 'NaN',
    SPEND_FAST_TENTHS: 'Infinity',
    SPEND_SEARCH_TENTHS: '-1',
    SPEND_FETCH_TENTHS: 'not-a-number',
    SPEND_DAY_CENTS: 'garbage',
    SPEND_MONTH_CENTS: 'NaN',
  });

  assert.deepEqual(configured.PRICES, {
    seatTenths: 4,
    toolSeatTenths: 8,
    synthesisTenths: 5,
    fastTenths: 1,
    searchTenths: 4,
    fetchTenths: 1,
  });
  assert.deepEqual(configured.LIMITS, { dayCents: 500, monthCents: 2000 });
  for (const value of [...Object.values(configured.PRICES), ...Object.values(configured.LIMITS)]) {
    assert.equal(Number.isFinite(value), true);
    assert.equal(Number.isInteger(value), true);
  }
});
