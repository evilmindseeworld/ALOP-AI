'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPacer, CircuitOpenError } = require('./pacer');

/** A clock and a sleep that move together, so nothing here waits in real time. */
const fakeTime = () => {
  let clock = 0;
  return {
    now: () => clock,
    advance: (ms) => { clock += ms; },
    sleep: async (ms) => { clock += ms; },
  };
};

/* `run` awaits pacing before it takes a slot, so a single microtask tick is
 * not enough for the queue to have formed. Draining a handful is the honest
 * way to say "let the scheduler settle" without a real timer. */
const tick = async (n = 8) => { for (let i = 0; i < n; i += 1) await Promise.resolve(); };

const ok = async () => 'ok';
const boom = async () => { throw new Error('provider down'); };

test('with no limits configured it is a pass-through', async () => {
  const pacer = createPacer();
  assert.equal(await pacer.run('m', ok), 'ok');
  assert.equal(pacer.stats().admitted, 1);
});

/* ---- concurrency -------------------------------------------------------- */

test('concurrency is bounded and the queue drains in order', async () => {
  const pacer = createPacer({ concurrency: 2 });
  const gates = [];
  const start = (i) => pacer.run('m', () => new Promise((resolve) => { gates[i] = resolve; }));

  const running = [start(0), start(1), start(2)];
  await tick();
  assert.equal(pacer.stats().inFlight, 2);
  assert.equal(pacer.stats().queued, 1);

  gates[0]('a');
  await running[0];
  await tick();
  assert.ok(gates[2], 'the queued call started when a slot freed');
  gates[1]('b');
  gates[2]('c');
  assert.deepEqual(await Promise.all(running), ['a', 'b', 'c']);
  assert.equal(pacer.stats().inFlight, 0);
});

test('a slot is released even when the work throws', async () => {
  const pacer = createPacer({ concurrency: 1 });
  await assert.rejects(pacer.run('m', boom));
  assert.equal(pacer.stats().inFlight, 0);
  assert.equal(await pacer.run('m', ok), 'ok');
});

test('a caller that aborts while queued leaves the queue', async () => {
  const pacer = createPacer({ concurrency: 1 });
  let release;
  const held = pacer.run('m', () => new Promise((r) => { release = r; }));
  const controller = new AbortController();
  const queued = pacer.run('m', ok, { signal: controller.signal });
  await tick();
  assert.equal(pacer.stats().queued, 1);
  controller.abort(new Error('client left'));
  await assert.rejects(queued, /client left/);
  assert.equal(pacer.stats().queued, 0);
  release('done');
  assert.equal(await held, 'done');
});

/* ---- minute pacing ------------------------------------------------------ */

/* The existing handling of a per-minute limit is a RETRY after the 429, which
 * is correct and is also the expensive half: the request was made and the round
 * trip paid for. Pacing spends nothing to reach the same place. */
test('the minute window paces rather than refuses', async () => {
  const time = fakeTime();
  const pacer = createPacer({ perMinute: 3, now: time.now, sleep: time.sleep });
  for (let i = 0; i < 3; i += 1) await pacer.run('m', ok);
  assert.equal(pacer.stats().paced, 0);
  await pacer.run('m', ok);
  assert.equal(pacer.stats().paced, 1, 'the fourth call waited instead of being refused');
  assert.ok(time.now() >= 60_000, 'and it waited until the window had actually rolled');
});

test('calls falling out of the window free their slots', async () => {
  const time = fakeTime();
  const pacer = createPacer({ perMinute: 2, now: time.now, sleep: time.sleep });
  await pacer.run('m', ok);
  await pacer.run('m', ok);
  time.advance(61_000);
  await pacer.run('m', ok);
  assert.equal(pacer.stats().paced, 0);
});

/* ---- the circuit breaker ------------------------------------------------ */

test('a model that keeps failing is refused immediately, then probed, then closed', async () => {
  const time = fakeTime();
  const pacer = createPacer({ failureThreshold: 3, cooldownMs: 30_000, now: time.now, sleep: time.sleep });

  for (let i = 0; i < 3; i += 1) await assert.rejects(pacer.run('m', boom));
  assert.equal(pacer.breakerState('m'), 'open');

  /* The point of the breaker: no provider call at all, no whip waited out. */
  let called = false;
  await assert.rejects(
    pacer.run('m', async () => { called = true; }),
    (err) => err instanceof CircuitOpenError && err.model === 'm',
  );
  assert.equal(called, false);
  assert.equal(pacer.stats().refused, 1);

  time.advance(30_001);
  assert.equal(pacer.breakerState('m'), 'half-open');
  assert.equal(await pacer.run('m', ok), 'ok');
  assert.equal(pacer.breakerState('m'), 'closed', 'one success closes it');
});

/* Refusing forever is the failure this guards against as much as never
 * refusing. A probe that fails must restart the cool-off, not leave the breaker
 * behaving exactly like a closed one. */
test('a failed probe restarts the cool-off instead of letting everything through', async () => {
  const time = fakeTime();
  const pacer = createPacer({ failureThreshold: 2, cooldownMs: 10_000, now: time.now, sleep: time.sleep });
  for (let i = 0; i < 2; i += 1) await assert.rejects(pacer.run('m', boom));
  time.advance(10_001);
  await assert.rejects(pacer.run('m', boom));
  assert.equal(pacer.breakerState('m'), 'open');
  await assert.rejects(pacer.run('m', ok), CircuitOpenError);
});

test('one success resets the failure count short of the threshold', async () => {
  const pacer = createPacer({ failureThreshold: 3 });
  await assert.rejects(pacer.run('m', boom));
  await assert.rejects(pacer.run('m', boom));
  await pacer.run('m', ok);
  await assert.rejects(pacer.run('m', boom));
  await assert.rejects(pacer.run('m', boom));
  assert.equal(pacer.breakerState('m'), 'closed');
});

/* An abort is a user closing a tab. Letting it open a breaker would let one
 * impatient user disable a seat for everybody. */
test('an aborted call never opens a breaker', async () => {
  const pacer = createPacer({ failureThreshold: 2 });
  const controller = new AbortController();
  controller.abort(new Error('gone'));
  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(pacer.run('m', boom, { signal: controller.signal }));
  }
  assert.equal(pacer.breakerState('m'), 'closed');
});

test('the caller can classify a failure as not the model’s fault', async () => {
  const pacer = createPacer({ failureThreshold: 2 });
  const classify = (err) => (/quota/.test(err.message) ? 'ignore' : 'failure');
  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(pacer.run('m', async () => { throw new Error('account quota exhausted'); }, { classify }));
  }
  assert.equal(pacer.breakerState('m'), 'closed', 'our own quota says nothing about the provider');
});

test('breakers are per model', async () => {
  const pacer = createPacer({ failureThreshold: 1 });
  await assert.rejects(pacer.run('bad', boom));
  assert.equal(pacer.breakerState('bad'), 'open');
  assert.equal(pacer.breakerState('good'), 'closed');
  assert.equal(await pacer.run('good', ok), 'ok');
});

/* The breaker is checked FIRST and costs nothing: refusing a doomed call must
 * not first wait in a queue or burn a minute slot. */
test('a refused call consumes no minute slot and no concurrency slot', async () => {
  const time = fakeTime();
  const pacer = createPacer({ failureThreshold: 1, perMinute: 1, concurrency: 1, now: time.now, sleep: time.sleep });
  await assert.rejects(pacer.run('bad', boom));
  const before = pacer.stats();
  await assert.rejects(pacer.run('bad', ok), CircuitOpenError);
  const after = pacer.stats();
  assert.equal(after.minuteUsed, before.minuteUsed);
  assert.equal(after.admitted, before.admitted);
  assert.equal(after.inFlight, 0);
});

/* THE BREAKER COUNTS REQUESTS, NOT CALLS.
 *
 * `callModel` retries inside one `run()`, so a model failing on its third
 * attempt cost three POSTs against the account's daily request cap while
 * registering a single failure here. At the default threshold of five that is
 * fifteen real requests before a dead model is refused. The error carries the
 * count it actually spent (lib/openrouter.js stamps `providerAttempts`) and the
 * breaker charges it.
 *
 * Watched fail before the fix: with `b.failures += 1` both assertions below
 * report 'closed'. */
test('a failure that cost three requests counts three toward the breaker', async () => {
  const pacer = createPacer({ failureThreshold: 5 });
  const retried = async () => {
    const err = new Error('OpenRouter 503');
    err.providerAttempts = 3;
    throw err;
  };
  await assert.rejects(pacer.run('m', retried));
  assert.equal(pacer.breakerState('m'), 'closed', 'three of five is not yet open');
  await assert.rejects(pacer.run('m', retried));
  assert.equal(pacer.breakerState('m'), 'open', 'six requests spent: the breaker opens on the second call, not the fifth');
});

/* A single-request failure is unchanged — every other caller's errors carry no
 * count and must keep costing exactly one. */
test('a failure with no attempt count still counts one', async () => {
  const pacer = createPacer({ failureThreshold: 3 });
  await assert.rejects(pacer.run('m', boom));
  await assert.rejects(pacer.run('m', boom));
  assert.equal(pacer.breakerState('m'), 'closed');
  await assert.rejects(pacer.run('m', boom));
  assert.equal(pacer.breakerState('m'), 'open');
});

/* A garbage count must not disable the breaker by making the increment NaN —
 * every comparison against a threshold is false for NaN, so the breaker would
 * appear to work and never open. */
test('a nonsense attempt count is treated as one request', async () => {
  const pacer = createPacer({ failureThreshold: 2 });
  const weird = async () => {
    const err = new Error('boom');
    err.providerAttempts = 'three';
    throw err;
  };
  await assert.rejects(pacer.run('m', weird));
  assert.equal(pacer.breakerState('m'), 'closed');
  await assert.rejects(pacer.run('m', weird));
  assert.equal(pacer.breakerState('m'), 'open');
});

/* HALF-OPEN ADMITTED EVERY CALLER, NOT ONE PROBE.
 *
 * `breakerState` derives half-open from the clock alone, and nothing recorded
 * that a probe was already in flight. The probe's own latency is the whole
 * window: from the moment the cool-off elapses until the first call comes back
 * — seconds against a dead model, since the failure mode being probed for is a
 * whip waited out — every concurrent caller read 'half-open' and went through.
 * On a multi-user process a council fan-out and every turn beside it all probed
 * the same dead model at once, each paying the full timeout. That is an open
 * breaker behaving exactly like a closed one, which is the failure the
 * cool-off restart above already guards against in the sequential case.
 *
 * ONE probe, and the rest refused until it settles. */
test('only one call probes a half-open breaker; the rest are refused', async () => {
  const time = fakeTime();
  const pacer = createPacer({ failureThreshold: 1, cooldownMs: 10_000, now: time.now, sleep: time.sleep });
  await assert.rejects(pacer.run('m', boom));
  assert.equal(pacer.breakerState('m'), 'open');

  time.advance(10_001);
  assert.equal(pacer.breakerState('m'), 'half-open');

  /* The probe is in flight and has not answered yet — exactly the window a
   * dead model holds open for the length of the whip. */
  let releaseProbe;
  const probe = pacer.run('m', () => new Promise((r) => { releaseProbe = r; }));
  await tick();

  let secondCalled = false;
  await assert.rejects(
    pacer.run('m', async () => { secondCalled = true; }),
    (err) => err instanceof CircuitOpenError,
    'a second caller must not get its own probe',
  );
  assert.equal(secondCalled, false, 'and must not reach the provider');

  releaseProbe('ok');
  assert.equal(await probe, 'ok');
  assert.equal(pacer.breakerState('m'), 'closed', 'the probe still closes it');
});

/* A probe that is ABORTED must hand the slot back. The abort is not a failure —
 * it neither closes the breaker nor restarts the cool-off — so if it also left
 * the probe marked in flight, the breaker would refuse every caller forever
 * with no probe running and nothing to clear it. Refusing forever is the
 * failure this whole mechanism exists to avoid. */
test('an aborted probe releases the probe slot', async () => {
  const time = fakeTime();
  const pacer = createPacer({ failureThreshold: 1, cooldownMs: 10_000, now: time.now, sleep: time.sleep });
  await assert.rejects(pacer.run('m', boom));
  time.advance(10_001);

  const controller = new AbortController();
  controller.abort(new Error('client left'));
  await assert.rejects(pacer.run('m', boom, { signal: controller.signal }), /client left|provider down/);

  assert.equal(pacer.breakerState('m'), 'half-open', 'an abort is not a probe result');
  assert.equal(await pacer.run('m', ok), 'ok', 'and the next real caller can still probe');
});
