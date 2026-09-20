'use strict';

const { randomUUID } = require('node:crypto');

/*
 * The cache-precision proof is a separate experiment from the quality run.
 * Its plan is complete before the first response exists: three fixed cases,
 * one normal seed request for each, then one normal non-bypass request for each
 * in the same order. There is no result-dependent replacement or retry.
 */

const CACHE_VALIDATION_PHASE = 'pre-results';
const CACHE_VALIDATION_CASE_COUNT = 3;
const CACHE_VALIDATION_PHASE_ORDER = Object.freeze(['seed', 'hit']);
const CACHE_HIT_ROUTES = new Set(['answer_cache', 'answer_cache_semantic']);
const CACHE_RECEIPT_SOURCE = 'turn_provenance.route';
const CACHE_VALIDATION_NAME = 'cache-validation-v1';
const SAFE_BINDING = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

function validateCacheValidationManifest(manifest) {
  const problems = [];
  const add = (message) => problems.push(message);

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest is not an object'];
  }
  if (manifest.name !== CACHE_VALIDATION_NAME) add(`name must be ${CACHE_VALIDATION_NAME}`);
  if (!Array.isArray(manifest.cases)) add('cases must be an array');
  if (Array.isArray(manifest.cases) && manifest.cases.length !== CACHE_VALIDATION_CASE_COUNT) {
    add(`cases must contain exactly ${CACHE_VALIDATION_CASE_COUNT} fixed cases`);
  }

  const preResults = manifest.preResults;
  if (!preResults || typeof preResults !== 'object' || Array.isArray(preResults)) {
    add('preResults must be an object');
  } else {
    if (preResults.phase !== CACHE_VALIDATION_PHASE) add(`preResults.phase must be ${CACHE_VALIDATION_PHASE}`);
    if (preResults.caseCount !== CACHE_VALIDATION_CASE_COUNT) add(`preResults.caseCount must be ${CACHE_VALIDATION_CASE_COUNT}`);
    if (preResults.requestsPerCase !== 2) add('preResults.requestsPerCase must be 2');
    if (preResults.cacheBypass !== false) add('preResults.cacheBypass must be false');
    if (preResults.selection !== 'fixed-manifest-order') add('preResults.selection must be fixed-manifest-order');
    if (preResults.postResultsAdaptation !== false) add('preResults.postResultsAdaptation must be false');
    if (JSON.stringify(preResults.phaseOrder) !== JSON.stringify(CACHE_VALIDATION_PHASE_ORDER)) {
      add('preResults.phaseOrder must be [seed, hit]');
    }
  }

  const ids = new Set();
  for (const [index, testCase] of (Array.isArray(manifest.cases) ? manifest.cases : []).entries()) {
    const label = `cases[${index}]`;
    if (!testCase || typeof testCase !== 'object' || Array.isArray(testCase)) {
      add(`${label} must be an object`);
      continue;
    }
    if (typeof testCase.id !== 'string' || !testCase.id.trim()) add(`${label}.id must be non-empty`);
    else if (ids.has(testCase.id)) add(`${label}.id is duplicated`);
    else ids.add(testCase.id);
    if (typeof testCase.question !== 'string' || !testCase.question.trim()) add(`${label}.question must be non-empty`);
    if (testCase.cacheEligible !== true) add(`${label}.cacheEligible must be true`);
    if (Array.isArray(testCase.history) && testCase.history.length > 0) add(`${label}.history must be empty`);
    if (own(testCase, 'images') || own(testCase, 'attachments')) add(`${label} cannot carry images or attachments`);
  }
  return problems;
}

function cacheValidationBranch(baseBranch, runId) {
  if (!SAFE_BINDING.test(String(baseBranch || '')) || !SAFE_BINDING.test(String(runId || ''))) {
    throw new TypeError('cache validation branch requires bounded base branch and run id');
  }
  return `${baseBranch}:validation:${runId}`;
}

function buildCacheValidationPlan(manifest, { runId = randomUUID() } = {}) {
  const problems = validateCacheValidationManifest(manifest);
  if (problems.length) throw new TypeError(`invalid cache validation manifest: ${problems.join('; ')}`);
  if (!SAFE_BINDING.test(String(runId || ''))) throw new TypeError('cache validation run id is invalid');

  const cases = manifest.cases.map((testCase, index) => Object.freeze({
    index,
    caseId: testCase.id,
    question: testCase.question,
    history: Object.freeze(Array.isArray(testCase.history)
      ? testCase.history.map((message) => Object.freeze({ ...message }))
      : []),
  }));
  const steps = [
    ...cases.map((testCase) => ({ ...testCase, phase: 'seed' })),
    ...cases.map((testCase) => ({ ...testCase, phase: 'hit' })),
  ].map((step) => Object.freeze({
    ...step,
    operationId: `${CACHE_VALIDATION_NAME}-${step.caseId}-${step.phase}`,
    validationRunId: runId,
    cacheBypass: false,
    requestMode: 'normal-cache-semantics',
  }));
  return Object.freeze(steps);
}

function validateResultSequence(plan, results) {
  const problems = [];
  if (!Array.isArray(results)) return ['results must be an array'];
  if (results.length !== plan.length) {
    problems.push(`results length ${results.length} does not match fixed plan length ${plan.length}`);
  }
  for (let index = 0; index < plan.length; index += 1) {
    const expected = plan[index];
    const actual = results[index];
    if (!actual) {
      problems.push(`missing result for ${expected.operationId}`);
      continue;
    }
    if (actual.caseId !== expected.caseId) problems.push(`result ${index} case order changed`);
    if (actual.phase !== expected.phase) problems.push(`result ${index} phase order changed`);
    if (actual.operationId !== expected.operationId) problems.push(`result ${index} operation is not the fixed operation`);
  }
  return problems;
}

/* A header or a route name alone is not enough. The hit must carry the public
 * accounting receipt, agree with the provenance route, and be explicitly
 * non-bypassed. This is the only predicate allowed to increment the HIT count.
 */
function bindingMatches(cache, binding = null) {
  if (!binding) return true;
  const expected = {
    runId: binding.runId ?? binding.validationRunId,
    caseId: binding.caseId ?? binding.validationCaseId,
    phase: binding.phase ?? binding.validationPhase,
  };
  if (!SAFE_BINDING.test(String(expected.runId || ''))
    || !SAFE_BINDING.test(String(expected.caseId || ''))
    || !CACHE_VALIDATION_PHASE_ORDER.includes(expected.phase)) return false;
  return cache?.validationRunId === expected.runId
    && cache?.validationCaseId === expected.caseId
    && cache?.validationPhase === expected.phase
    && cache?.validationReceiptId === `${expected.runId}:${expected.caseId}:${expected.phase}`;
}

function isProvenCacheHit(observation = {}, binding = null) {
  const cache = observation.accounting?.cache;
  return observation.error == null
    && String(observation.cacheStatus || '').toLowerCase() !== 'bypass'
    && observation.provenance?.route && CACHE_HIT_ROUTES.has(observation.provenance.route)
    && observation.textSource === 'cache'
    && observation.cacheDecision === 'hit'
    && observation.accounting?.schemaVersion === 1
    && cache?.source === CACHE_RECEIPT_SOURCE
    && cache?.decision === 'hit'
    && cache?.lookupAttempted === true
    && cache?.bypassRequested === false
    && cache?.bypassAccepted === false
    && bindingMatches(cache, binding);
}

function isProvenCacheMiss(observation = {}, binding = null) {
  const cache = observation.accounting?.cache;
  const route = observation.provenance?.route;
  return observation.error == null
    && typeof observation.answer === 'string'
    && observation.answer.trim().length > 0
    && String(observation.cacheStatus || '').toLowerCase() !== 'bypass'
    && typeof route === 'string'
    && !CACHE_HIT_ROUTES.has(route)
    && observation.textSource == null
    && observation.cacheDecision === 'miss'
    && observation.accounting?.schemaVersion === 1
    && cache?.source === CACHE_RECEIPT_SOURCE
    && cache?.decision === 'miss'
    && cache?.lookupAttempted === true
    && cache?.bypassRequested === false
    && cache?.bypassAccepted === false
    && bindingMatches(cache, binding);
}

function finaliseCacheValidation(plan, results, { casesById = new Map(), gradeCase = null } = {}) {
  const sequenceProblems = validateResultSequence(plan, results);
  if (sequenceProblems.length) throw new TypeError(`cache validation result sequence is invalid: ${sequenceProblems.join('; ')}`);

  const runId = plan[0]?.validationRunId || null;
  const seedProof = new Map();
  const seedFailures = [];
  for (const [index, step] of plan.entries()) {
    if (step.phase !== 'seed') continue;
    const proven = isProvenCacheMiss(results[index], {
      runId: step.validationRunId,
      caseId: step.caseId,
      phase: step.phase,
    });
    seedProof.set(step.caseId, proven);
    if (!proven) seedFailures.push(step.caseId);
  }

  const hitRows = [];
  const hitFailures = [];
  const seenReceiptIds = new Set();
  for (const [index, step] of plan.entries()) {
    if (step.phase !== 'hit') continue;
    const result = results[index];
    if (!seedProof.get(step.caseId)) continue;
    const binding = { runId: step.validationRunId, caseId: step.caseId, phase: step.phase };
    if (!isProvenCacheHit(result, binding)) {
      hitFailures.push(step.caseId);
      continue;
    }
    const receiptId = result.accounting.cache.validationReceiptId;
    if (seenReceiptIds.has(receiptId)) continue;
    seenReceiptIds.add(receiptId);
    hitRows.push({ caseId: step.caseId, operationId: step.operationId, observation: result, receiptId });
  }

  const gradedHits = hitRows.map((row) => {
    const testCase = casesById instanceof Map ? casesById.get(row.caseId) : casesById?.[row.caseId];
    const grade = typeof gradeCase === 'function' && testCase ? gradeCase(testCase, row.observation) : null;
    return { caseId: row.caseId, grade };
  });
  const eligibleHits = gradedHits.filter((row) => row.grade
    && row.grade.inconclusive !== true
    && typeof row.grade.passed === 'boolean');
  const passedHits = eligibleHits.filter((row) => row.grade.passed === true).length;
  const cachePrecisionCases = eligibleHits.length;
  const cachePrecision = cachePrecisionCases > 0 ? passedHits / cachePrecisionCases : null;
  const status = cachePrecisionCases === 0 || cachePrecisionCases < CACHE_VALIDATION_CASE_COUNT
    ? 'inconclusive'
    : cachePrecision === 1 ? 'pass' : 'fail';

  return {
    phase: CACHE_VALIDATION_PHASE,
    plannedCaseCount: CACHE_VALIDATION_CASE_COUNT,
    plannedRequestCount: plan.length,
    seedRequestCount: plan.filter((step) => step.phase === 'seed').length,
    hitRequestCount: plan.filter((step) => step.phase === 'hit').length,
    cacheHitCaseIds: hitRows.map((row) => row.caseId),
    eligibleHitCaseIds: eligibleHits.map((row) => row.caseId),
    seedProofCaseIds: [...seedProof.entries()].filter(([, proven]) => proven).map(([caseId]) => caseId),
    seedFailures: [...new Set(seedFailures)],
    hitFailures: [...new Set(hitFailures)],
    inconclusiveHitCaseIds: gradedHits.filter((row) => row.grade?.inconclusive === true).map((row) => row.caseId),
    ungradedHitCaseIds: gradedHits.filter((row) => !row.grade).map((row) => row.caseId),
    cachePrecisionCases,
    cachePrecision,
    status,
    ready: status === 'pass',
    gradedHits,
    validationRunId: runId,
    retries: 0,
    replacements: 0,
  };
}

module.exports = {
  CACHE_VALIDATION_NAME,
  CACHE_VALIDATION_PHASE,
  CACHE_VALIDATION_CASE_COUNT,
  CACHE_VALIDATION_PHASE_ORDER,
  validateCacheValidationManifest,
  cacheValidationBranch,
  buildCacheValidationPlan,
  validateResultSequence,
  isProvenCacheHit,
  isProvenCacheMiss,
  finaliseCacheValidation,
};
