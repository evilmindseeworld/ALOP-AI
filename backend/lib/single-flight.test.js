'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSingleFlight } = require('./single-flight');

const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test('identical concurrent work runs once and everybody gets the answer', async () => {
  const sf = createSingleFlight();
  const gate = deferred();
  let runs = 0;
  const work = () => { runs += 1; return gate.promise; };

  const a = sf.run('k', work);
  const b = sf.run('k', work);
  const c = sf.run('k', work);
  assert.equal(runs, 1);
  gate.resolve('the answer');
  assert.deepEqual(await Promise.all([a, b, c]), ['the answer', 'the answer', 'the answer']);
  assert.equal(sf.stats().leaders, 1);
  assert.equal(sf.stats().followers, 2);
});

/* NOT A CACHE. Nothing is retained once the work settles, so this can never
 * serve a stale answer — which is the property that makes it safe to put in
 * front of a council turn without any of the cacheability reasoning the answer
 * cache needs. */
test('nothing is retained after the work settles', async () => {
  const sf = createSingleFlight();
  let runs = 0;
  const work = async () => { runs += 1; return runs; };
  assert.equal(await sf.run('k', work), 1);
  assert.equal(await sf.run('k', work), 2);
  assert.equal(sf.inFlightCount(), 0);
});

test('a failure is shared, and the key is released', async () => {
  const sf = createSingleFlight();
  const gate = deferred();
  const a = sf.run('k', () => gate.promise);
  const b = sf.run('k', () => gate.promise);
  gate.reject(new Error('provider down'));
  await assert.rejects(a, /provider down/);
  await assert.rejects(b, /provider down/);
  assert.equal(sf.inFlightCount(), 0);
  // And the next caller genuinely retries rather than inheriting the failure.
  assert.equal(await sf.run('k', async () => 'ok'), 'ok');
});

test('different keys never share', async () => {
  const sf = createSingleFlight();
  let runs = 0;
  const work = async () => { runs += 1; };
  await Promise.all([sf.run('a', work), sf.run('b', work)]);
  assert.equal(runs, 2);
});

test('an empty key is not a key: the work runs unshared', async () => {
  const sf = createSingleFlight();
  let runs = 0;
  const work = async () => { runs += 1; };
  await Promise.all([sf.run('', work), sf.run(null, work), sf.run(undefined, work)]);
  assert.equal(runs, 3, 'a null key must never make two unrelated turns share an answer');
});

/* A FOLLOWER THAT LEAVES MUST NOT TAKE THE ANSWER WITH IT. The leader is still
 * waiting for it, and so may three other followers. */
test('an aborting follower rejects alone', async () => {
  const sf = createSingleFlight();
  const gate = deferred();
  const leader = sf.run('k', () => gate.promise);
  const controller = new AbortController();
  const follower = sf.run('k', () => gate.promise, { signal: controller.signal });
  controller.abort(new Error('client left'));
  await assert.rejects(follower, /client left/);
  gate.resolve('done');
  assert.equal(await leader, 'done');
});

test('a follower whose signal is already aborted does not wait at all', async () => {
  const sf = createSingleFlight();
  const gate = deferred();
  sf.run('k', () => gate.promise);
  const controller = new AbortController();
  controller.abort(new Error('gone'));
  await assert.rejects(sf.run('k', () => gate.promise, { signal: controller.signal }), /gone/);
  gate.resolve('done');
});

/* A leader that hangs must not hang its followers forever. Counted, because a
 * non-zero number here means work is hanging rather than that sharing works. */
test('a leader older than the ceiling is replaced rather than waited on', async () => {
  let clock = 1_000;
  const sf = createSingleFlight({ maxWaitMs: 5_000, now: () => clock });
  const stuck = deferred();
  sf.run('k', () => stuck.promise);
  clock += 6_000;
  assert.equal(await sf.run('k', async () => 'second leader'), 'second leader');
  assert.equal(sf.stats().timeouts, 1);
  assert.equal(sf.stats().leaders, 2);
  // …and when the abandoned leader finally settles it must not delete the
  // entry belonging to whoever replaced it.
  stuck.resolve('late');
});

test('onShare reports the wait so a duplicate rate can be measured', async () => {
  let clock = 0;
  const sf = createSingleFlight({ now: () => clock });
  const gate = deferred();
  sf.run('k', () => gate.promise);
  clock = 250;
  const shares = [];
  const follower = sf.run('k', () => gate.promise, { onShare: (row) => shares.push(row) });
  gate.resolve(1);
  await follower;
  assert.deepEqual(shares, [{ key: 'k', waitedMs: 250 }]);
});

test('a work function that resolves synchronously is still shared', async () => {
  /* The entry has to be registered BEFORE `work` is called: a cache hit inside
   * it resolves in the same tick, and a caller arriving in that tick must find
   * the entry rather than start a second execution. */
  const sf = createSingleFlight();
  let runs = 0;
  const work = () => { runs += 1; return Promise.resolve('fast'); };
  const both = await Promise.all([sf.run('k', work), sf.run('k', work)]);
  assert.deepEqual(both, ['fast', 'fast']);
  assert.equal(runs, 1);
});
