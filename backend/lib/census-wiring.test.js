'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * A CENSUS THAT ONLY RUNS WHEN THE SHARED STORE IS ON WOULD BE MEASURING THE
 * SAFE CASE.
 *
 * `lib/instance-census.js` exists to catch one configuration: more than one
 * instance running while `RATE_LIMIT_STORE` is not `postgres`, which multiplies
 * every rate limit in the service by the instance count and is reached by a
 * dropdown, with no deploy and nothing to review. Starting it inside
 * `if (USE_PG_RATE_LIMIT)` would be the same bug as testing the extractor
 * nothing calls: every unit test green, the one state it exists for unwatched.
 *
 * The sweep has to be outside that branch for a smaller reason, recorded here
 * because it is easy to "tidy" back: the census writes rows in both modes and
 * its key carries a new instance id after every deploy.
 */
const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

/** The body of `if (USE_PG_RATE_LIMIT) { … }` in the boot block, by brace depth. */
const sharedStoreBranch = () => {
  const start = SOURCE.indexOf('if (USE_PG_RATE_LIMIT) {');
  assert.notEqual(start, -1, 'the RATE_LIMIT_STORE branch is gone; this test needs rewriting');
  let depth = 0;
  for (let i = SOURCE.indexOf('{', start); i < SOURCE.length; i++) {
    if (SOURCE[i] === '{') depth++;
    else if (SOURCE[i] === '}' && --depth === 0) return SOURCE.slice(start, i + 1);
  }
  throw new Error('unbalanced braces reading the RATE_LIMIT_STORE branch');
};

test('the census starts in both modes, not only under the shared store', () => {
  assert.match(SOURCE, /startInstanceCensus\(\{/, 'server.js never starts the instance census');
  assert.equal(
    sharedStoreBranch().includes('startInstanceCensus('),
    false,
    'the census starts inside if (USE_PG_RATE_LIMIT) — it would never run in the one configuration it exists to catch',
  );
  /* The brace scan alone would pass for `if (USE_PG_RATE_LIMIT) startInstanceCensus(…)`
   * written without a block, which is the identical bug in one line. Nothing in
   * the run-up to the call may mention the flag; the call's own `sharedStore:`
   * argument comes after it. */
  const call = SOURCE.indexOf('startInstanceCensus({');
  assert.equal(
    SOURCE.slice(Math.max(0, call - 160), call).includes('USE_PG_RATE_LIMIT'),
    false,
    'the census start is guarded by USE_PG_RATE_LIMIT — it must run in both modes',
  );
});

test('the census is told which store is in use, and reports into /health', () => {
  const call = SOURCE.slice(SOURCE.indexOf('startInstanceCensus({'), SOURCE.indexOf('startInstanceCensus({') + 400);
  assert.match(call, /sharedStore: USE_PG_RATE_LIMIT/, 'the census cannot tell safe from unsafe without the flag');
  assert.match(call, /onCensus:/, 'nothing reads the census result');
  assert.match(SOURCE, /limitsMultiplied: instanceCensus\.unsafe/, '/health does not expose the unsafe state');
  assert.match(SOURCE, /instances: instanceCensus\.instances/, '/health does not expose the measured instance count');
});

test('the first census happens at boot, not a minute into it', () => {
  assert.match(SOURCE, /census\.tick\(\)/, 'nothing ticks the census at boot, so the warning is a minute late');
});

test('the expired-row sweep runs in both modes too', () => {
  assert.match(SOURCE, /const sweepRateLimits = async/, 'the sweep is gone');
  assert.equal(
    sharedStoreBranch().includes('const sweepRateLimits'),
    false,
    'the sweep is inside if (USE_PG_RATE_LIMIT) again, so census rows accumulate one per deploy for ever when the shared store is off',
  );
});
