'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTurnTelemetry } = require('./turn-telemetry');
const { gradeCase, summarise } = require('./evaluation');
const { evaluateGates } = require('./release-gates');
const {
  ZERO_PRICE_CATALOG,
  ZERO_PRICE_CATALOG_SOURCE,
  ZERO_PRICE_CATALOG_VERSION,
  isVerifiedZeroPriceModel,
} = require('./openrouter-zero-price-catalog');
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

const attempt = (outcome = 'ok', attemptNumber = 1, model = 'model:free') => ({
  provider: 'openrouter',
  model,
  phase: 'council',
  attempt: attemptNumber,
  outcome,
  status: outcome === 'ok' ? 200 : 503,
});

const snapshotFor = ({ costs = [], attempts = ['ok'], attemptModels = [], route = 'council' } = {}) => {
  const telemetry = createTurnTelemetry();
  for (const [index, outcome] of attempts.entries()) {
    telemetry.recordProviderAttempt(attempt(outcome, index + 1, attemptModels[index] || 'model:free'));
  }
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

test('the committed catalog, not FREE_ONLY, is the zero-price source of truth', () => {
  assert.ok(ZERO_PRICE_CATALOG.length >= 3);
  assert.ok(ZERO_PRICE_CATALOG.every((entry) => entry.verified === true
    && entry.inputUsdPerMillionTokens === 0
    && entry.outputUsdPerMillionTokens === 0
    && entry.source === ZERO_PRICE_CATALOG_SOURCE
    && entry.catalogVersion === ZERO_PRICE_CATALOG_VERSION));
  assert.equal(isVerifiedZeroPriceModel(ZERO_PRICE_CATALOG[0].model), true);
  assert.equal(isVerifiedZeroPriceModel('unlisted/model:free'), false);
  assert.equal(isVerifiedZeroPriceModel('openrouter/free'), false);
  assert.doesNotMatch(ZERO_PRICE_CATALOG_SOURCE, /FREE_ONLY/);
});

test('failed attempts to independently verified zero-price models measure truthful zero', () => {
  const model = ZERO_PRICE_CATALOG[0].model;
  const receipt = snapshotFor({
    attempts: ['http_error'],
    attemptModels: [model],
  });
  assert.equal(receipt.cost.measured, true);
  assert.equal(receipt.cost.costUsd, 0);
  assert.equal(receipt.cost.costCents, 0);
  assert.equal(receipt.cost.failedProviderAttempts, 1);
  assert.equal(receipt.cost.zeroPriceVerified, true);
  assert.equal(receipt.cost.zeroPriceCatalogVersion, ZERO_PRICE_CATALOG_VERSION);
  const measurement = measurementFromFrames([
    { type: 'provenance', provenance: { route: 'council', accounting: receipt } },
  ]);
  assert.equal(measurement.costCents, 0);
  assert.equal(measurement.costMeasured, true);
});

test('multiple verified zero-price attempts aggregate to one measured zero', () => {
  const models = [ZERO_PRICE_CATALOG[0].model, ZERO_PRICE_CATALOG[1].model, ZERO_PRICE_CATALOG[2].model];
  const receipt = snapshotFor({
    attempts: ['http_error', 'http_error', 'ok'],
    attemptModels: models,
  });
  assert.equal(receipt.cost.providerRequests, 3);
  assert.equal(receipt.cost.failedProviderAttempts, 2);
  assert.equal(receipt.cost.measured, true);
  assert.equal(receipt.cost.costCents, 0);
});

test('a verified zero-price failure aggregates with a settled priced success', () => {
  const receipt = snapshotFor({
    attempts: ['http_error', 'ok'],
    attemptModels: [ZERO_PRICE_CATALOG[0].model, 'openai/gpt-5.6-luna'],
    costs: [0.002],
  });
  assert.equal(receipt.cost.providerRequests, 2);
  assert.equal(receipt.cost.failedProviderAttempts, 1);
  assert.equal(receipt.cost.failedZeroPriceVerified, true);
  assert.equal(receipt.cost.measured, true);
  assert.equal(receipt.cost.costUsd, 0.002);
  assert.equal(receipt.cost.costCents, 0.2);
  const measurement = measurementFromFrames([
    { type: 'provenance', provenance: { route: 'council', accounting: receipt } },
  ]);
  assert.equal(measurement.costCents, 0.2);
});

test('unknown or nonzero failed routes remain unknown, even under FREE_ONLY', () => {
  const unknown = snapshotFor({
    attempts: ['http_error', 'ok'],
    attemptModels: ['unlisted/model:free', ZERO_PRICE_CATALOG[0].model],
    costs: [0],
  });
  const nonzero = snapshotFor({
    attempts: ['http_error'],
    attemptModels: ['openai/gpt-5.6-luna'],
  });
  assert.equal(unknown.cost.measured, false);
  assert.equal(unknown.cost.costCents, null);
  assert.equal(nonzero.cost.measured, false);
  assert.equal(nonzero.cost.costCents, null);
});

test('a nonzero usage conflict never gets overwritten by the zero-price catalog', () => {
  const receipt = snapshotFor({
    attempts: ['ok'],
    attemptModels: [ZERO_PRICE_CATALOG[0].model],
    costs: [0.001],
  });
  assert.equal(receipt.cost.measured, false);
  assert.equal(receipt.cost.costCents, null);
  assert.equal(receipt.cost.unknownReason, 'zero_price_catalog_conflict');
});

test('zero cost is derived only for a known no-provider route', () => {
  const local = snapshotFor({ route: 'arithmetic', attempts: [] });
  const missingRouteAccounting = snapshotFor({ route: 'council' });
  assert.equal(local.cost.measured, true);
  assert.equal(local.cost.costCents, 0);
  assert.equal(local.cost.noProviderEvidence, true);
  assert.equal(missingRouteAccounting.cost.measured, false);
  assert.equal(missingRouteAccounting.cost.costCents, null);
});

test('a no-provider zero is unknown when a usage receipt or provider evidence exists', () => {
  const usageReceipt = buildTurnAccountingMeta({
    providerRequests: 0,
    providerAttempts: { failed: 0, detail: [] },
    usage: usage(0),
  }, { route: 'arithmetic' });
  const providerDetail = buildTurnAccountingMeta({
    providerRequests: 0,
    providerAttempts: { failed: 0, detail: [attempt('ok')] },
    usage: null,
  }, { route: 'arithmetic' });

  for (const receipt of [usageReceipt, providerDetail]) {
    assert.equal(receipt.cost.measured, false);
    assert.equal(receipt.cost.costUsd, null);
    assert.equal(receipt.cost.unknownReason, 'contradictory_accounting');
    assert.equal(receipt.cost.noProviderEvidence, undefined);
  }
});

test('failed detail and positive provider spend cannot be represented as no-provider zero', () => {
  const failedDetail = buildTurnAccountingMeta({
    providerRequests: 0,
    providerAttempts: { failed: 1, detail: [attempt('http_error')] },
    usage: null,
  }, { route: 'arithmetic' });
  const positiveSpend = buildTurnAccountingMeta({
    providerRequests: 0,
    providerAttempts: { failed: 0, detail: [] },
    usage: usage(0.001),
  }, { route: 'answer_cache' });

  assert.equal(failedDetail.cost.measured, false);
  assert.equal(failedDetail.cost.costCents, null);
  assert.equal(positiveSpend.cost.measured, false);
  assert.equal(positiveSpend.cost.costCents, null);
});

test('the observation projection requires the explicit no-provider receipt marker', () => {
  const receipt = buildTurnAccountingMeta({
    providerRequests: 0,
    providerAttempts: { failed: 0, detail: [] },
    usage: null,
  }, { route: 'arithmetic' });
  const forged = { ...receipt, cost: { ...receipt.cost, noProviderEvidence: undefined } };
  assert.equal(observationTelemetry({ provenance: { route: 'arithmetic' }, accounting: receipt }).costCents, 0);
  assert.equal(observationTelemetry({ provenance: { route: 'arithmetic' }, accounting: forged }).costCents, null);
});

test('cache provenance labels a real cache hit and never labels a normal council route as a hit', () => {
  const hit = observationTelemetry({
    provenance: { route: 'answer_cache' },
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

test('a cache route without a complete hit receipt is not counted as a proven hit', () => {
  const observation = observationTelemetry({
    provenance: { route: 'answer_cache' },
    accounting: {
      schemaVersion: 1,
      cache: {
        source: 'turn_provenance.route',
        decision: 'hit',
        lookupAttempted: false,
        bypassRequested: false,
        bypassAccepted: false,
      },
    },
  });
  assert.equal(observation.cacheDecision, 'unknown');
  assert.equal(observation.cacheTelemetryMeasured, false);
  assert.equal(observation.textSource, null);
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
  const cacheReceipt = {
    schemaVersion: 1,
    cache: {
      source: 'turn_provenance.route',
      decision: 'hit',
      lookupAttempted: true,
      bypassRequested: false,
      bypassAccepted: false,
    },
  };
  const observations = [
    { id: goodCase.id, answer: 'Canberra is the capital of Australia.', textSource: 'cache', cacheDecision: 'hit', provenance: { route: 'answer_cache' }, accounting: cacheReceipt, latencyMs: 1, frames: [] },
    { id: badCase.id, answer: 'Sydney is the capital of Australia.', textSource: 'cache', cacheDecision: 'hit', provenance: { route: 'answer_cache' }, accounting: cacheReceipt, latencyMs: 1, frames: [] },
  ];
  const grades = [gradeCase(goodCase, observations[0]), gradeCase(badCase, observations[1])];
  const metrics = summarise(grades, observations);
  assert.equal(metrics.cachePrecision, 0.5);
  assert.equal(metrics.cachePrecisionCases, 2);
});

test('zero cache denominator stays null and cannot pass its hard gate', () => {
  const metrics = summarise([], []);
  assert.equal(metrics.cachePrecision, null);
  assert.equal(metrics.cachePrecisionCases, 0);
  const verdict = evaluateGates(metrics, {
    gates: [{ name: 'cache', metric: 'cachePrecision', direction: 'min', threshold: 1, sample: 'cachePrecisionCases', minSample: 3 }],
  });
  assert.equal(verdict.passed, false);
  assert.equal(verdict.results[0].status, 'inconclusive');
});

test('synthetic cost and cache gates distinguish measured pass, measured fail, and unknown', () => {
  const gates = [
    { name: 'cost', metric: 'costCentsPerTurn', direction: 'max', threshold: 5, sample: 'costMeasuredCases', minSample: 10 },
    { name: 'cache', metric: 'cachePrecision', direction: 'min', threshold: 1, sample: 'cachePrecisionCases', minSample: 3 },
  ];
  const pass = evaluateGates({ costMeasuredCases: 10, cachePrecisionCases: 3, costCentsPerTurn: 0, cachePrecision: 1 }, { gates });
  const fail = evaluateGates({ costMeasuredCases: 10, cachePrecisionCases: 3, costCentsPerTurn: 5.01, cachePrecision: 0.5 }, { gates });
  const unknown = evaluateGates({ costMeasuredCases: 0, cachePrecisionCases: 0, costCentsPerTurn: null, cachePrecision: null }, { gates });
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
