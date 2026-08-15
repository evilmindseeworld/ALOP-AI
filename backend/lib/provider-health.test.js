'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProviderHealth, MIN_CONFIDENT_SAMPLES } = require('./provider-health');

const fill = (health, model, count, row = {}) => {
  for (let i = 0; i < count; i += 1) health.record({ model, outcome: 'ok', ms: 100, ...row });
};

test('an unrecorded model has no stats rather than perfect ones', () => {
  const health = createProviderHealth();
  assert.equal(health.statsFor('never-called'), null);
});

test('latency percentiles come from successful calls only', () => {
  const health = createProviderHealth();
  for (const ms of [100, 200, 300, 400, 500, 600, 700, 5000]) {
    health.record({ model: 'm', outcome: 'ok', ms });
  }
  /* A 200ms 429 would otherwise make an unusable provider look like the fastest
   * one on the roster. */
  health.record({ model: 'm', outcome: 'rate_limited', ms: 5 });
  const s = health.statsFor('m');
  assert.equal(s.samples, 8, 'the failed call contributes no latency sample');
  assert.equal(s.p50, 400);
  assert.equal(s.p95, 5000);
  assert.equal(s.rateLimited, 1);
});

/* An abort is a user closing a tab. Counting it against a model would let one
 * impatient user make a healthy seat look broken. */
test('an aborted call is not a failure and is not a call', () => {
  const health = createProviderHealth();
  health.record({ model: 'm', outcome: 'ok', ms: 10 });
  health.record({ model: 'm', outcome: 'aborted', ms: 10 });
  const s = health.statsFor('m');
  assert.equal(s.calls, 1);
  assert.equal(s.failed, 0);
});

test('consecutive failures reset on a success and windowed ones do not', () => {
  const health = createProviderHealth();
  health.record({ model: 'm', outcome: 'failed' });
  health.record({ model: 'm', outcome: 'failed' });
  assert.equal(health.statsFor('m').consecutiveFailures, 2);
  health.record({ model: 'm', outcome: 'ok', ms: 5 });
  assert.equal(health.statsFor('m').consecutiveFailures, 0);
  assert.equal(health.statsFor('m').failed, 2, 'the history is not erased by one good call');
});

/* A metered seat that never emits a tool call is a metered seat doing free-tier
 * work, and nothing could see it. */
test('tool reliability is null until tools were actually offered', () => {
  const health = createProviderHealth();
  health.record({ model: 'm', outcome: 'ok', ms: 5 });
  assert.equal(health.statsFor('m').toolReliability, null, 'never armed is not "failed to emit"');
  health.record({ model: 'm', outcome: 'ok', ms: 5, offeredTools: true, emittedTool: true });
  health.record({ model: 'm', outcome: 'ok', ms: 5, offeredTools: true, emittedTool: false });
  assert.equal(health.statsFor('m').toolReliability, 0.5);
});

test('cost and tokens are averaged per call', () => {
  const health = createProviderHealth();
  health.record({ model: 'm', outcome: 'ok', ms: 1, costUsd: 0.002, tokens: 1000 });
  health.record({ model: 'm', outcome: 'ok', ms: 1, costUsd: 0.004, tokens: 3000 });
  const s = health.statsFor('m');
  assert.equal(s.costPerCallUsd, 0.003);
  assert.equal(s.tokensPerCall, 2000);
});

test('quality is recorded only when the caller scored it', () => {
  const health = createProviderHealth();
  health.record({ model: 'm', outcome: 'ok', ms: 1 });
  assert.equal(health.statsFor('m').quality, null, 'a made-up quality number is worse than none');
  health.record({ model: 'm', outcome: 'ok', ms: 1, quality: 0.8 });
  assert.equal(health.statsFor('m').quality, 0.8);
});

/* ---- ranking ------------------------------------------------------------ */

test('a model is not trusted until it has enough samples', () => {
  const health = createProviderHealth();
  fill(health, 'm', MIN_CONFIDENT_SAMPLES - 1);
  assert.equal(health.statsFor('m').confident, false);
  fill(health, 'm', 1);
  assert.equal(health.statsFor('m').confident, true);
});

test('an unmeasured model keeps its roster position', () => {
  /* "No data" must not sort below "measured and bad", or a new model could
   * never earn a sample. The list is hand-ordered by someone who knew what
   * they were doing. */
  const health = createProviderHealth();
  for (let i = 0; i < 10; i += 1) health.record({ model: 'broken', outcome: 'failed' });
  const order = health.rank(['fresh-a', 'broken', 'fresh-b']).map((r) => r.model);
  assert.deepEqual(order, ['fresh-a', 'fresh-b', 'broken']);
  // …and the unmeasured pair keep their ROSTER order relative to each other,
  // rather than being shuffled by a tie-break nobody chose.
  assert.deepEqual(health.rank(['fresh-b', 'fresh-a']).map((r) => r.model), ['fresh-b', 'fresh-a']);
});

/* A model that is reliable and slow is NOT "bad", and must be allowed to beat
 * an unmeasured one on a balanced ranking — otherwise every measurement is
 * worth less than no measurement and the signal is inert. Under a latency
 * emphasis the same model loses, which is the whole point of emphasis. */
test('a reliable but slow model outranks an unknown when balance is what is wanted', () => {
  const health = createProviderHealth();
  fill(health, 'slow', 10, { ms: 9_000 });
  assert.equal(health.rank(['unknown', 'slow'])[0].model, 'slow');
  const balanced = health.rank(['slow'])[0].score;
  const latencyFirst = health.rank(['slow'], { emphasis: 'latency' })[0].score;
  assert.ok(
    latencyFirst < balanced,
    'asking for speed must cost a slow model something, or emphasis is decoration',
  );
});

test('emphasis changes the order, and reliability always matters', () => {
  const health = createProviderHealth();
  fill(health, 'fast-cheap', 10, { ms: 300, costUsd: 0 });
  fill(health, 'slow-good', 10, { ms: 6_000, costUsd: 0.008, quality: 0.95 });

  assert.equal(health.rank(['slow-good', 'fast-cheap'], { emphasis: 'latency' })[0].model, 'fast-cheap');
  assert.equal(health.rank(['fast-cheap', 'slow-good'], { emphasis: 'quality' })[0].model, 'slow-good');
  assert.equal(health.rank(['slow-good', 'fast-cheap'], { emphasis: 'cost' })[0].model, 'fast-cheap');
});

/* IT NEVER DROPS ANYTHING. A router that removes a model because it looks
 * unhealthy is a router that empties the roster during a provider-wide
 * incident. Refusing is the pacer's job, through a breaker that can close. */
test('ranking reorders and never filters', () => {
  const health = createProviderHealth();
  for (let i = 0; i < 20; i += 1) health.record({ model: 'broken', outcome: 'failed' });
  const ranked = health.rank(['broken']);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].model, 'broken');
});

test('an empty candidate list is not an error', () => {
  assert.deepEqual(createProviderHealth().rank([]), []);
  assert.deepEqual(createProviderHealth().rank(undefined), []);
});
