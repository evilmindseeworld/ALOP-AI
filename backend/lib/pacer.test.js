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
