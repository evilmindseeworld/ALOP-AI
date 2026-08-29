'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SOURCE = readFileSync(join(__dirname, '..', 'scripts', 'run-evals.mjs'), 'utf8');
const EVALUATION = readFileSync(join(__dirname, 'evaluation.js'), 'utf8');
const CACHE_VALIDATION = JSON.parse(readFileSync(join(__dirname, '..', 'evals', 'cache-validation-v1.json'), 'utf8'));

test('the judge is pure and neither evaluator source selects Luna through OpenRouter', () => {
  assert.doesNotMatch(EVALUATION, /\bfetch\s*\(/);
  assert.doesNotMatch(EVALUATION, /OPENROUTER_API_KEY|gpt-5\.6-luna/);
  assert.doesNotMatch(SOURCE, /OPENROUTER_API_KEY|OPENROUTER_MODEL|gpt-5\.6-luna/);
});

test('the evaluator refuses an arbitrary Clerk user', () => {
  assert.match(SOURCE, /EVAL_CLERK_SECRET_KEY && !process\.env\.EVAL_USER_ID/);
  assert.match(SOURCE, /requires EVAL_USER_ID; refusing to select an arbitrary Clerk user/);
  assert.doesNotMatch(SOURCE, /users\?limit=1/);
});

test('the evaluator uses a real Clerk session and revokes it', () => {
  assert.match(SOURCE, /Authorization: `Bearer \$\{SECRET\}`/);
  assert.match(SOURCE, /EVAL_CLERK_TESTING_TOKEN/);
  assert.match(SOURCE, /__clerk_testing_token/);
  assert.match(SOURCE, /\/sign_in_tokens/);
  assert.match(SOURCE, /\/v1\/client\/sign_ins/);
  assert.match(SOURCE, /\/v1\/client\/sessions\/\$\{sessionId\}\/tokens/);
  assert.match(SOURCE, /\/sessions\/\$\{sessionId\}\/revoke/);
});

test('fresh evaluation requires both the explicit CLI mode and its secret', () => {
  assert.match(SOURCE, /cacheBypass && !cacheBypassSecret/);
  assert.match(SOURCE, /X-ALOP-Benchmark-Cache-Bypass/);
  assert.match(SOURCE, /cache_bypass_unconfirmed/);
});

test('a live gate requires a zero-price catalog freshness preflight before model calls', () => {
  assert.match(SOURCE, /zero-price-preflight/);
  assert.match(SOURCE, /ZERO_PRICE_PREFLIGHT/);
  assert.match(SOURCE, /pass !== true/);
  assert.match(SOURCE, /activeRoutes/);
});

test('the cache validation phase is fixed, separate, and explicitly non-bypass', () => {
  assert.match(SOURCE, /--cache-validation/);
  assert.match(SOURCE, /buildCacheValidationPlan/);
  assert.match(SOURCE, /useCacheBypass: false/);
  assert.match(SOURCE, /finaliseCacheValidation/);
  assert.equal(CACHE_VALIDATION.name, 'cache-validation-v1');
  assert.equal(CACHE_VALIDATION.preResults.phase, 'pre-results');
  assert.equal(CACHE_VALIDATION.preResults.cacheBypass, false);
  assert.equal(CACHE_VALIDATION.preResults.postResultsAdaptation, false);
});

test('quality manifests remain the cache-bypassed set', () => {
  for (const name of ['core-v1', 'backend-intelligence-v1', 'backend-intelligence-v1-recovery10']) {
    assert.match(SOURCE, new RegExp(`"${name}"`));
  }
  assert.match(SOURCE, /QUALITY_CACHE_BYPASS_DATASETS/);
});
