'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTurnTelemetry } = require('./turn-telemetry');
const { gradeCase, summarise } = require('./evaluation');
const { evaluateGates } = require('./release-gates');
const {
  UNKNOWN_USAGE,
  buildTurnAccountingMeta,
  measurementFromFrames,
  metricMeasurementFlags,
  observationTelemetry,
  unknownUsage,
} = require('./turn-accounting-meta');

const usage = (costUsd) => ({
  promptTokens: 10,
  completionTokens: 5,
  totalTokens: 15,
  costUsd,
});

const attempt = (outcome = 'ok', attemptNumber = 1) => ({
  provider: 'openrouter',
  model: 'model:free',
  phase: 'council',
  attempt: attemptNumber,
  outcome,
  status: outcome === 'ok' ? 200 : 503,
});

const snapshotFor = ({ costs = [], attempts = ['ok'], route = 'council' } = {}) => {
  const telemetry = createTurnTelemetry();
  for (const [index, outcome] of attempts.entries()) telemetry.recordProviderAttempt(attempt(outcome, index + 1));
  for (const costUsd of costs) telemetry.recordUsage(usage(costUsd), { phase: 'council' });
  return buildTurnAccountingMeta(telemetry.snapshot({}), { route });
};

test('a successful provider receipt measures reported zero cost without inventing spend', () => {
  const receipt = snapshotFor({ costs: [0] });
  assert.equal(receipt.cost.measured, true);
  assert.equal(receipt.cost.costUsd, 0);
  assert.equal(receipt.cost.costCents, 0);
  assert.equal(receipt.cost.provider, 'openrouter');
  assert.equal(receipt.cost.source, 'openrouter.response.usage.costUsd');
});

test('a successful fallback does not erase a failed provider attempt from cost accounting', () => {
  const receipt = snapshotFor({ costs: [0], attempts: ['http_error', 'ok'] });
  assert.equal(receipt.cost.measured, false);
  assert.equal(receipt.cost.costCents, null);
  assert.equal(receipt.cost.failedProviderAttempts, 1);
  assert.equal(receipt.cost.unknownReason, 'failed_provider_attempt_without_settled_cost');
});

test('an explicit all-null usage receipt remains unknown rather than becoming free', () => {
  const telemetry = createTurnTelemetry();
  telemetry.recordProviderAttempt(attempt());
  telemetry.recordUsage(unknownUsage(), { phase: 'council' });
  const receipt = buildTurnAccountingMeta(telemetry.snapshot({}), { route: 'council' });
  assert.deepEqual(unknownUsage(), UNKNOWN_USAGE);
  assert.equal(receipt.cost.measured, false);
  assert.equal(receipt.cost.costUsd, null);
  assert.equal(receipt.cost.costCents, null);
});

test('multiple settled provider receipts are summed once and converted to cents', () => {
  const receipt = snapshotFor({ costs: [0.001, 0.002], attempts: ['ok', 'ok'] });
  assert.equal(receipt.cost.measured, true);
  assert.equal(receipt.cost.costUsd, 0.003);
  assert.equal(receipt.cost.costCents, 0.3);
  assert.equal(receipt.cost.providerRequests, 2);
});

test('zero cost is derived only for a known no-provider route', () => {
  const local = snapshotFor({ route: 'arithmetic', attempts: [] });
  const missingRouteAccounting = snapshotFor({ route: 'council' });
  assert.equal(local.cost.measured, true);
  assert.equal(local.cost.costCents, 0);
  assert.equal(missingRouteAccounting.cost.measured, false);
  assert.equal(missingRouteAccounting.cost.costCents, null);
});

test('cache provenance labels a real cache hit and never labels a normal council route as a hit', () => {
  const hit = observationTelemetry({
    provenance: { route: 'answer_cache' },
    accounting: { cache: { bypassAccepted: false } },
  });
  const miss = observationTelemetry({
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
  });
  assert.equal(hit.cacheDecision, 'hit');
  assert.equal(hit.textSource, 'cache');
  assert.equal(hit.cacheTelemetryMeasured, true);
  assert.equal(miss.cacheDecision, 'miss');
  assert.equal(miss.textSource, null);
});

test('a route without a cache lookup is not relabelled as a cache miss', () => {
  const observation = observationTelemetry({ provenance: { route: 'memory' } });
  assert.equal(observation.cacheDecision, 'unknown');
  assert.equal(observation.cacheTelemetryMeasured, false);
});

test('a bypass header overrides contradictory cache provenance', () => {
  const observation = observationTelemetry({
    provenance: { route: 'answer_cache' },
    accounting: { cache: { bypassAccepted: false } },
    cacheStatus: 'bypass',
  });
  assert.equal(observation.cacheDecision, 'bypass');
  assert.equal(observation.textSource, null);
  assert.equal(observation.cacheTelemetryMeasured, true);
});

test('missing or unknown route provenance remains unknown', () => {
  const observation = observationTelemetry({ provenance: { route: 'unknown' } });
  assert.equal(observation.cacheDecision, 'unknown');
  assert.equal(observation.cacheTelemetryMeasured, false);
  assert.equal(observation.textSource, null);
});

test('a malformed measured cost receipt remains unknown', () => {
  const observation = observationTelemetry({
    provenance: { route: 'council' },
    accounting: {
      schemaVersion: 1,
      cost: {
        provider: 'openrouter',
        source: 'openrouter.response.usage.costUsd',
        measured: true,
        costCents: 0,
      },
    },
  });

  assert.equal(observation.costCents, null);
  assert.equal(observation.costMeasured, false);
});

test('a malformed cache miss receipt remains unknown', () => {
  const observation = observationTelemetry({
    provenance: { route: 'council' },
    accounting: {
      schemaVersion: 1,
      cache: {
        source: 'turn_provenance.route',
        decision: 'miss',
        lookupAttempted: true,
      },
    },
  });

  assert.equal(observation.cacheDecision, 'unknown');
  assert.equal(observation.cacheTelemetryMeasured, false);
});

test('the runner reads nested receipts and ignores duplicate provenance frames', () => {
  const receipt = buildTurnAccountingMeta({
    providerRequests: 1,
    providerAttempts: { failed: 0 },
    usage: { costUsd: 0.001 },
  }, { route: 'council' });
  const measurement = measurementFromFrames([
    { type: 'provenance', provenance: { route: 'council', accounting: receipt } },
    { type: 'provenance', provenance: { route: 'council', accounting: receipt } },
  ]);
  assert.equal(measurement.costCents, 0.1);
  assert.equal(measurement.textSource, null);
  assert.equal(measurement.costMeasured, true);
  assert.equal(measurement.accounting, receipt);
});

test('cache miss receipts require an observed lookup rather than a route guess', () => {
  const receipt = buildTurnAccountingMeta({
    providerRequests: 1,
    providerAttempts: { failed: 0 },
    usage: { costUsd: 0.001 },
    cacheReads: { answerExact: { ms: 2, ok: true } },
  }, { route: 'council' });
  assert.equal(receipt.cache.decision, 'miss');
  assert.equal(receipt.cache.lookupAttempted, true);
  assert.equal(observationTelemetry({ provenance: { route: 'council' }, accounting: receipt }).cacheDecision, 'miss');
});

test('cache precision is correctness over labelled cache observations, not hit rate', () => {
  const goodCase = { id: 'cache-good', expect: { mustInclude: ['Canberra'] } };
  const badCase = { id: 'cache-bad', expect: { mustInclude: ['Canberra'] } };
  const observations = [
    { id: goodCase.id, answer: 'Canberra is the capital of Australia.', textSource: 'cache', latencyMs: 1, frames: [] },
    { id: badCase.id, answer: 'Sydney is the capital of Australia.', textSource: 'cache', latencyMs: 1, frames: [] },
  ];
  const grades = [gradeCase(goodCase, observations[0]), gradeCase(badCase, observations[1])];
  const metrics = summarise(grades, observations);
  assert.equal(metrics.cachePrecision, 0.5);
});

test('zero cache denominator stays null and cannot pass its hard gate', () => {
  const metrics = summarise([], []);
  assert.equal(metrics.cachePrecision, null);
  const verdict = evaluateGates(metrics, {
    gates: [{ name: 'cache', metric: 'cachePrecision', direction: 'min', threshold: 1, sample: 'cases', minSample: 3 }],
  });
  assert.equal(verdict.passed, false);
  assert.equal(verdict.results[0].status, 'inconclusive');
});

test('synthetic cost and cache gates distinguish measured pass, measured fail, and unknown', () => {
  const gates = [
    { name: 'cost', metric: 'costCentsPerTurn', direction: 'max', threshold: 5, sample: 'cases', minSample: 10 },
    { name: 'cache', metric: 'cachePrecision', direction: 'min', threshold: 1, sample: 'cases', minSample: 3 },
  ];
  const pass = evaluateGates({ cases: 10, costCentsPerTurn: 0, cachePrecision: 1 }, { gates });
  const fail = evaluateGates({ cases: 10, costCentsPerTurn: 5.01, cachePrecision: 0.5 }, { gates });
  const unknown = evaluateGates({ cases: 10, costCentsPerTurn: null, cachePrecision: null }, { gates });
  assert.equal(pass.passed, true);
  assert.deepEqual(fail.failed, ['cost', 'cache']);
  assert.deepEqual(unknown.inconclusive, ['cost', 'cache']);
  assert.equal(unknown.passed, false);
});

test('metric flags report whether the hard metrics are actually measured', () => {
  assert.deepEqual(metricMeasurementFlags({ costCentsPerTurn: 0, cachePrecision: 1 }), {
    COST_MEASURED: true,
    CACHE_PRECISION_MEASURED: true,
  });
  assert.deepEqual(metricMeasurementFlags({ costCentsPerTurn: null, cachePrecision: null }), {
    COST_MEASURED: false,
    CACHE_PRECISION_MEASURED: false,
  });
});
