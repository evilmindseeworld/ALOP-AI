'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { gradeCase } = require('./evaluation');
const {
  CACHE_VALIDATION_CASE_COUNT,
  CACHE_VALIDATION_NAME,
  CACHE_VALIDATION_PHASE_ORDER,
  buildCacheValidationPlan,
  finaliseCacheValidation,
  isProvenCacheHit,
  validateCacheValidationManifest,
} = require('./cache-validation');

const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'evals', `${CACHE_VALIDATION_NAME}.json`), 'utf8'));
const qualityManifestNames = [
  'core-v1',
  'backend-intelligence-v1',
  'backend-intelligence-v1-recovery10',
];
const qualityCaseIds = new Set(qualityManifestNames.flatMap((name) => {
  const qualityManifest = JSON.parse(readFileSync(join(__dirname, '..', 'evals', `${name}.json`), 'utf8'));
  return qualityManifest.cases.map((testCase) => testCase.id);
}));

const hitObservation = (route = 'answer_cache', over = {}) => ({
  id: over.id || 'unused',
  answer: over.answer || 'This is a complete cached answer with enough detail to satisfy the fixed validation case.',
  frames: [],
  latencyMs: 1,
  error: null,
  cacheStatus: null,
  textSource: 'cache',
  cacheDecision: 'hit',
  provenance: { route },
  accounting: {
    schemaVersion: 1,
    cache: {
      source: 'turn_provenance.route',
      decision: 'hit',
      lookupAttempted: true,
      bypassRequested: false,
      bypassAccepted: false,
    },
  },
  ...over,
});

const missObservation = (over = {}) => ({
  ...hitObservation('council', {
    ...over,
    textSource: null,
    cacheDecision: 'miss',
    provenance: { route: 'council' },
    accounting: {
      schemaVersion: 1,
      cache: {
        source: 'turn_provenance.route',
        decision: 'miss',
        lookupAttempted: true,
        bypassRequested: false,
        bypassAccepted: false,
      },
    },
  }),
});

const resultRows = (plan, makeObservation) => plan.map((step) => ({
  ...makeObservation(step),
  id: step.caseId,
  caseId: step.caseId,
  phase: step.phase,
  operationId: step.operationId,
}));

test('the committed cache manifest is fixed, eligible, and valid before results exist', () => {
  assert.deepEqual(validateCacheValidationManifest(manifest), []);
  assert.equal(manifest.cases.length, CACHE_VALIDATION_CASE_COUNT);
  assert.equal(manifest.preResults.phase, 'pre-results');
  assert.deepEqual(manifest.preResults.phaseOrder, CACHE_VALIDATION_PHASE_ORDER);
  assert.equal(manifest.preResults.cacheBypass, false);
  assert.ok(manifest.cases.every((testCase) => testCase.cacheEligible === true));
});

test('cache validation cases stay outside the main quality manifests', () => {
  for (const testCase of manifest.cases) {
    assert.equal(qualityCaseIds.has(testCase.id), false, `cache case leaked into quality manifests: ${testCase.id}`);
  }
});

test('the plan contains all seed requests before all fixed non-bypass hit requests', () => {
  const plan = buildCacheValidationPlan(manifest);
  assert.equal(plan.length, CACHE_VALIDATION_CASE_COUNT * 2);
  assert.deepEqual(plan.map((step) => step.phase), ['seed', 'seed', 'seed', 'hit', 'hit', 'hit']);
  assert.ok(plan.every((step) => step.cacheBypass === false));
  assert.ok(plan.every((step) => step.requestMode === 'normal-cache-semantics'));
  assert.deepEqual(plan.slice(0, 3).map((step) => step.caseId), plan.slice(3).map((step) => step.caseId));
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan[0]));
});

test('0/0 is inconclusive and a seed hit is not counted as a validation hit', () => {
  const plan = buildCacheValidationPlan(manifest);
  const results = resultRows(plan, () => missObservation());
  results[0] = { ...results[0], ...hitObservation(), id: results[0].caseId };
  const summary = finaliseCacheValidation(plan, results);
  assert.deepEqual(summary.cacheHitCaseIds, []);
  assert.equal(summary.cachePrecisionCases, 0);
  assert.equal(summary.cachePrecision, null);
  assert.equal(summary.status, 'inconclusive');
  assert.equal(summary.ready, false);
});

test('only three proven non-bypass hits can make the phase ready', () => {
  const plan = buildCacheValidationPlan(manifest);
  const answers = [
    'A cache needs an invalidation strategy because stored values can become stale. It improves speed but must balance freshness and correctness when data changes.',
    'A database index is an extra lookup structure that speeds reads. It costs storage and makes writes slower because the index must also be updated.',
    'Idempotent API operations are useful because a retry produces the same intended result instead of duplicating the action. This makes repeated client requests safer.',
  ];
  const results = resultRows(plan, (step) => step.phase === 'hit'
    ? hitObservation('answer_cache', { answer: answers[manifest.cases.findIndex((testCase) => testCase.id === step.caseId)] })
    : missObservation());
  const casesById = new Map(manifest.cases.map((testCase) => [testCase.id, testCase]));
  const summary = finaliseCacheValidation(plan, results, { casesById, gradeCase });
  assert.equal(summary.cachePrecisionCases, 3);
  assert.deepEqual(summary.cacheHitCaseIds, manifest.cases.map((testCase) => testCase.id));
  assert.equal(summary.cachePrecision, 1);
  assert.equal(summary.status, 'pass');
  assert.equal(summary.ready, true);
});

test('a proven wrong hit fails precision, while a bypassed or malformed receipt does not count', () => {
  const plan = buildCacheValidationPlan(manifest);
  const results = resultRows(plan, (step) => step.phase === 'hit'
    ? hitObservation('answer_cache', { answer: step.caseId === manifest.cases[0].id ? 'Wrong answer.' : 'A complete answer with enough detail.' })
    : missObservation());
  const bypass = results[3];
  results[3] = { ...bypass, cacheStatus: 'bypass' };
  const casesById = new Map(manifest.cases.map((testCase) => [testCase.id, testCase]));
  const summary = finaliseCacheValidation(plan, results, { casesById, gradeCase });
  assert.equal(summary.cachePrecisionCases, 2);
  assert.equal(summary.status, 'inconclusive');
  assert.equal(summary.ready, false);
  assert.equal(isProvenCacheHit(results[3]), false);
});

test('result order is immutable after the plan is committed', () => {
  const plan = buildCacheValidationPlan(manifest);
  const results = resultRows(plan, () => missObservation());
  const swapped = [results[1], results[0], ...results.slice(2)];
  assert.throws(() => finaliseCacheValidation(plan, swapped), /result sequence is invalid/);
});

test('manifest validation rejects removing an eligible case or changing the pre-results order', () => {
  assert.ok(validateCacheValidationManifest({
    ...manifest,
    cases: manifest.cases.slice(0, 2),
  }).length > 0);
  assert.ok(validateCacheValidationManifest({
    ...manifest,
    preResults: { ...manifest.preResults, cacheBypass: true },
  }).some((problem) => problem.includes('cacheBypass')));
});
