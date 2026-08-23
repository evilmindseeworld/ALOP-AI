'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { benchmarkCacheBypass, HEADER, SECRET_ENV } = require('./benchmark-cache-bypass');

const headers = (value) => ({ [HEADER]: value });
const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
const ROUTE = SOURCE.slice(SOURCE.indexOf("app.post('/api/council'"), SOURCE.indexOf('// ===== OVERLAY'));

test('no evaluator header leaves the normal cache path untouched', () => {
  assert.deepEqual(benchmarkCacheBypass({ env: { [SECRET_ENV]: 'secret' } }), {
    enabled: false, requested: false, reason: 'not_requested',
  });
});

test('a header without a configured secret cannot bypass the cache', () => {
  assert.deepEqual(benchmarkCacheBypass({ headers: headers('secret'), env: {} }), {
    enabled: false, requested: true, reason: 'not_configured',
  });
});

test('a wrong secret is refused without revealing the configured value', () => {
  const result = benchmarkCacheBypass({
    headers: headers('wrong'),
    env: { [SECRET_ENV]: 'correct' },
  });
  assert.deepEqual(result, { enabled: false, requested: true, reason: 'invalid_secret' });
  assert.equal(JSON.stringify(result).includes('correct'), false);
});

test('the evaluator can authorise an explicit cache bypass', () => {
  assert.deepEqual(benchmarkCacheBypass({
    headers: headers('correct'),
    env: { [SECRET_ENV]: 'correct' },
  }), { enabled: true, requested: true, reason: 'authorized' });
});

test('the comparison is exact, including case and header shape', () => {
  assert.equal(benchmarkCacheBypass({
    headers: headers('Correct'),
    env: { [SECRET_ENV]: 'correct' },
  }).enabled, false);
  assert.equal(benchmarkCacheBypass({
    headers: { [HEADER]: ['correct'] },
    env: { [SECRET_ENV]: 'correct' },
  }).enabled, false);
});

test('the bypass is bounded to the authenticated council route and both answer-cache tiers', () => {
  assert.match(SOURCE, /app\.post\('\/api\/council', requireAuth, checkSuspended, handleCouncilTurn\)/);
  assert.match(ROUTE, /const cacheBypass = benchmarkCacheBypass\(\{ headers: req\.headers \}\)/);
  assert.match(ROUTE, /res\.set\('X-ALOP-Cache-Status', 'bypass'\)/);
  assert.match(ROUTE, /cacheEligible: !clientHistory\.length && !parsedImages\.length && !cacheBypass\.enabled/);
  assert.match(ROUTE, /const cacheKey = cacheBypass\.enabled \|\| personalised \|\| hasUncacheableAttachment/);
  assert.doesNotMatch(SOURCE, /app\.use\([^\n]*benchmarkCacheBypass/);
});

test('ordinary and invalid requests retain the normal cache path', () => {
  assert.equal(benchmarkCacheBypass({ env: { [SECRET_ENV]: 'secret' } }).enabled, false);
  assert.equal(benchmarkCacheBypass({ headers: headers('wrong'), env: { [SECRET_ENV]: 'secret' } }).enabled, false);
  assert.match(ROUTE, /\} else if \(cacheBypass\.enabled\) \{[\s\S]*?\} else \{[\s\S]*?BYPASS personalised-context/);
});

test('authorization has no cross-request state and the proof header contains no secret', () => {
  assert.equal(benchmarkCacheBypass({ headers: headers('secret'), env: { [SECRET_ENV]: 'secret' } }).enabled, true);
  assert.equal(benchmarkCacheBypass({ env: { [SECRET_ENV]: 'secret' } }).enabled, false);
  assert.match(ROUTE, /X-ALOP-Cache-Status', 'bypass/);
  assert.doesNotMatch(ROUTE, /res\.set\([^\n]*configured|res\.set\([^\n]*supplied/);
});
