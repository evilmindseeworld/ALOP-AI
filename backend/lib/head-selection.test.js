'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { chooseHead, DISPLACE_MARGIN } = require('./head-selection');
const { createProviderHealth, MIN_CONFIDENT_SAMPLES } = require('./provider-health');
const { DEFAULT_HEAD_LADDER, METERED_RUNGS } = require('./model-ladder');

const FREE_A = DEFAULT_HEAD_LADDER[0].model;
const FREE_B = DEFAULT_HEAD_LADDER[1].model;

/** N successful calls at a fixed latency, which is what `confident` needs. */
const feed = (health, model, { ms, calls = MIN_CONFIDENT_SAMPLES + 2, outcome = 'ok' } = {}) => {
  for (let i = 0; i < calls; i++) health.record({ model, outcome, ms });
  return health;
};

test('with no health signal at all, the configured head is the answer', () => {
  const head = chooseHead({ configured: FREE_A, candidates: [FREE_A, FREE_B] });
  assert.equal(head.model, FREE_A);
  assert.equal(head.reason, 'configured');
  assert.deepEqual(head.chain.map((r) => r.model), [FREE_B]);
});

/* Rule 2, and the property that makes this safe to leave on: a fresh process
 * has no samples, so the selector is the identity function until it has
 * evidence. A feature that changes behaviour on boot is one nobody can roll
 * back by waiting. */
test('an unmeasured roster produces exactly the configured order', () => {
  const health = createProviderHealth();
  const head = chooseHead({ configured: FREE_A, candidates: [FREE_A, FREE_B], health });
  assert.equal(head.model, FREE_A);
  assert.equal(head.reason, 'configured');
  assert.deepEqual(head.ranked, [FREE_A, FREE_B]);
});

test('a measurably faster model takes the head on a latency turn', () => {
  const health = createProviderHealth();
  feed(health, FREE_A, { ms: 24_000 });
  feed(health, FREE_B, { ms: 900 });
  const head = chooseHead({ configured: FREE_A, candidates: [FREE_A, FREE_B], health, emphasis: 'latency' });
  assert.equal(head.model, FREE_B);
  assert.equal(head.reason, 'health:latency');
  /* The displaced head is not dropped — it is the first fallback. A ranking
   * that removed it would turn one slow model into no model. */
  assert.deepEqual(head.chain.map((r) => r.model), [FREE_A]);
});

test('a model that is merely a hair better does not displace the configured head', () => {
  const health = createProviderHealth();
  feed(health, FREE_A, { ms: 1000 });
  feed(health, FREE_B, { ms: 980 });
  const head = chooseHead({ configured: FREE_A, candidates: [FREE_A, FREE_B], health, emphasis: 'latency' });
  assert.equal(head.model, FREE_A, 'a 20ms difference is noise, not evidence');
  assert.equal(head.reason, 'configured');
});

/* The failing-model case, which is the one a static ladder handles worst: the
 * head keeps its seat until someone edits an array. */
test('a head that has been failing loses the seat to a healthy candidate', () => {
  const health = createProviderHealth();
  feed(health, FREE_A, { ms: 500, outcome: 'failed' });
  feed(health, FREE_B, { ms: 1500 });
  const head = chooseHead({ configured: FREE_A, candidates: [FREE_A, FREE_B], health, emphasis: 'balanced' });
  assert.equal(head.model, FREE_B);
  assert.deepEqual(head.chain.map((r) => r.model), [FREE_A]);
});

/* Rule 1, and the one that costs money if it is wrong. */
test('RANKING NEVER INTRODUCES A MODEL THE CALLER DID NOT OFFER', () => {
  const health = createProviderHealth();
  feed(health, FREE_A, { ms: 24_000 });
  const head = chooseHead({ configured: FREE_A, candidates: [FREE_A, FREE_B], health, emphasis: 'latency' });
  const reachable = [head.model, ...head.chain.map((r) => r.model)];
  for (const rung of METERED_RUNGS) {
    assert.ok(!reachable.includes(rung.model), `${rung.model} was introduced by ranking`);
  }
  assert.deepEqual([...reachable].sort(), [FREE_A, FREE_B].sort());
});

test('the effort travels with the model, and is not invented', () => {
  const head = chooseHead({
    configured: 'openai/gpt-5.6-luna',
    candidates: ['openai/gpt-5.6-luna', FREE_A],
  });
  assert.equal(head.effort, 'high', 'the metered rung has a recorded effort');
  assert.equal(head.chain[0].effort, null, 'a free rung has none, and none is sent');
});

test('duplicates and blanks in the candidate list do not produce duplicate rungs', () => {
  const head = chooseHead({
    configured: FREE_A,
    candidates: [FREE_A, null, FREE_B, FREE_A, undefined, ''],
  });
  assert.deepEqual(head.chain.map((r) => r.model), [FREE_B]);
});

test('a configured head with nothing under it still answers', () => {
  const health = createProviderHealth();
  feed(health, FREE_A, { ms: 30_000 });
  const head = chooseHead({ configured: FREE_A, candidates: [], health, emphasis: 'latency' });
  assert.equal(head.model, FREE_A);
  assert.deepEqual(head.chain, []);
});

test('the margin is a real number, so the selector cannot flap on noise', () => {
  assert.ok(DISPLACE_MARGIN > 0 && DISPLACE_MARGIN < 0.5);
});
