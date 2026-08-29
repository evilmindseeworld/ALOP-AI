'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  benchmarkCacheBypass,
  benchmarkCacheValidation,
  HEADER,
  SECRET_ENV,
  VALIDATION_HEADER,
  VALIDATION_RUN_HEADER,
  VALIDATION_CASE_HEADER,
  VALIDATION_PHASE_HEADER,
} = require('./benchmark-cache-bypass');

const headers = (value) => ({ [HEADER]: value });
const validationHeaders = (over = {}) => ({
  [VALIDATION_HEADER]: 'correct',
  [VALIDATION_RUN_HEADER]: 'validation-run-test',
  [VALIDATION_CASE_HEADER]: 'cache-validation-case',
  [VALIDATION_PHASE_HEADER]: 'seed',
  ...over,
});
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

test('the evaluator can authorise a bound cache-validation namespace without enabling bypass', () => {
  assert.deepEqual(benchmarkCacheValidation({
    headers: validationHeaders(),
    env: { [SECRET_ENV]: 'correct' },
  }), {
    enabled: true,
    requested: true,
    reason: 'authorized',
    runId: 'validation-run-test',
    caseId: 'cache-validation-case',
    phase: 'seed',
  });
  assert.equal(benchmarkCacheBypass({ headers: validationHeaders(), env: { [SECRET_ENV]: 'correct' } }).enabled, false);
});

test('cache validation rejects missing or malformed binding and never exposes the secret', () => {
  const env = { [SECRET_ENV]: 'correct' };
  assert.equal(benchmarkCacheValidation({ headers: { [VALIDATION_HEADER]: 'correct' }, env }).enabled, false);
  const invalid = benchmarkCacheValidation({
    headers: validationHeaders({ [VALIDATION_PHASE_HEADER]: 'other' }),
    env,
  });
  assert.equal(invalid.enabled, false);
  assert.equal(JSON.stringify(invalid).includes('correct'), false);
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
