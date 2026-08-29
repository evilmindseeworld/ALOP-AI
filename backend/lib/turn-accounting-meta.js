'use strict';

/*
 * The evaluator's two hard metrics need two small, public receipts:
 *
 *   - provider-reported OpenRouter usage cost for the completed turn; and
 *   - the route that actually served the answer, so a cache hit is a labelled
 *     observation rather than a guess from a bypass flag.
 *
 * This module is intentionally a projection, not a second accounting system.
 * It accepts the turn telemetry snapshot that already exists and emits a
 * bounded allow-list. Unknown cost stays unknown. A failed OpenRouter attempt
 * makes the turn's cost unmeasured unless the existing provider usage receipt
 * has a complete, settled cost for the turn; the current snapshot has no
 * per-failed-attempt receipt, so refusing the number is the safe result.
 */

const SCHEMA_VERSION = 1;

const CACHE_HIT_ROUTES = new Set(['answer_cache', 'answer_cache_semantic']);

/* These routes are known to make no OpenRouter request. A zero here is derived
 * from the observed request counter, not from FREE_ONLY policy. */
const ZERO_OPENROUTER_ROUTES = new Set([
  'arithmetic', 'greeting', 'answer_cache', 'answer_cache_semantic',
]);

const UNKNOWN_USAGE = Object.freeze({
  promptTokens: null,
  completionTokens: null,
  totalTokens: null,
  costUsd: null,
});

const finiteNonNegative = (value) => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const nonNegativeInteger = (value) => {
  const number = finiteNonNegative(value);
  return number === null ? null : Math.floor(number);
};

const rounded = (value) => {
  const number = finiteNonNegative(value);
  return number === null ? null : Math.round(number * 1e6) / 1e6;
};

const unknownUsage = () => ({ ...UNKNOWN_USAGE });

/**
 * Build the bounded accounting receipt attached to a provenance frame.
 *
 * `providerAttempts` is OpenRouter-only on the production council route: the
 * route's `recordAttempt(phase)` sink receives rows from lib/openrouter.js, and
 * non-OpenRouter image/search providers do not enter this counter. Keeping that
 * scope explicit prevents this receipt from pretending to be an all-provider
 * invoice.
 */
function buildTurnAccountingMeta(
  snapshot = {},
  { route = 'unknown', cacheBypassRequested = false, cacheBypassAccepted = false } = {},
) {
  const attempts = snapshot?.providerAttempts && typeof snapshot.providerAttempts === 'object'
    ? snapshot.providerAttempts
    : {};
  const usage = snapshot?.usage && typeof snapshot.usage === 'object' ? snapshot.usage : null;
  const providerRequests = nonNegativeInteger(snapshot?.providerRequests);
  const failedProviderAttempts = nonNegativeInteger(attempts.failed);
  const reportedCostUsd = rounded(usage?.costUsd);
  const cacheReads = snapshot?.cacheReads && typeof snapshot.cacheReads === 'object'
    ? snapshot.cacheReads
    : {};
  const cacheLookupAttempted = Object.keys(cacheReads).length > 0;
  const noProviderSpend = providerRequests === 0
    && failedProviderAttempts === 0
    && ZERO_OPENROUTER_ROUTES.has(route);
  const costMeasured = noProviderSpend
    || (providerRequests !== null
      && providerRequests > 0
      && failedProviderAttempts === 0
      && reportedCostUsd !== null);
  const costUsd = noProviderSpend ? 0 : costMeasured ? reportedCostUsd : null;
  const costCents = costUsd === null ? null : rounded(costUsd * 100);

  let unknownReason = null;
  if (!costMeasured) {
    unknownReason = failedProviderAttempts > 0
      ? 'failed_provider_attempt_without_settled_cost'
      : providerRequests === 0 && !ZERO_OPENROUTER_ROUTES.has(route)
        ? 'provider_request_accounting_missing'
        : 'provider_usage_cost_missing';
  }

  const bypassRequested = Boolean(cacheBypassRequested);
  const bypassAccepted = Boolean(cacheBypassAccepted);
  const cacheHit = !bypassAccepted && CACHE_HIT_ROUTES.has(route);
  const cacheDecision = bypassAccepted
    ? 'bypass'
    : cacheHit
      ? 'hit'
      : cacheLookupAttempted ? 'miss' : 'unknown';

  return {
    schemaVersion: SCHEMA_VERSION,
    cost: {
      provider: 'openrouter',
      source: 'openrouter.response.usage.costUsd',
      measured: costMeasured,
      costUsd,
      costCents,
      providerRequests,
      failedProviderAttempts,
      ...(unknownReason ? { unknownReason } : {}),
    },
    cache: {
      source: 'turn_provenance.route',
      decision: cacheDecision,
      textSource: cacheHit ? 'cache' : null,
      lookupAttempted: cacheLookupAttempted,
      bypassRequested,
      bypassAccepted,
    },
  };
}

/**
 * Convert one provenance/accounting receipt into evaluator observation fields.
 * The bypass response header is a hard override: a contradictory or malformed
 * receipt must not turn a fresh execution into a cache hit.
 */
function observationTelemetry({ provenance = null, accounting = null, cacheStatus = null } = {}) {
  const route = typeof provenance?.route === 'string' ? provenance.route : null;
  const cache = accounting?.cache;
  const cacheReceiptValid = accounting?.schemaVersion === SCHEMA_VERSION
    && cache?.source === 'turn_provenance.route'
    && ['hit', 'miss', 'bypass', 'unknown'].includes(cache?.decision)
    && typeof cache?.lookupAttempted === 'boolean'
    && typeof cache?.bypassRequested === 'boolean'
    && typeof cache?.bypassAccepted === 'boolean';
  const bypassed = String(cacheStatus || '').toLowerCase() === 'bypass'
    || (cacheReceiptValid && cache.bypassAccepted === true);
  const actualCacheHit = !bypassed && CACHE_HIT_ROUTES.has(route);
  const cacheMiss = !bypassed
    && !actualCacheHit
    && cacheReceiptValid
    && cache.decision === 'miss'
    && cache.lookupAttempted === true;
  const cost = accounting?.cost;
  const costUsd = rounded(cost?.costUsd);
  const reportedCostCents = rounded(cost?.costCents);
  const providerRequests = nonNegativeInteger(cost?.providerRequests);
  const failedProviderAttempts = nonNegativeInteger(cost?.failedProviderAttempts);
  const trustedCost = cost?.provider === 'openrouter'
    && cost?.source === 'openrouter.response.usage.costUsd'
    && cost?.measured === true
    && providerRequests !== null
    && failedProviderAttempts === 0
    && (providerRequests > 0 || ZERO_OPENROUTER_ROUTES.has(route));
  const costCents = accounting?.schemaVersion === SCHEMA_VERSION
    && trustedCost
    && costUsd !== null
    && reportedCostCents !== null
    && reportedCostCents === rounded(costUsd * 100)
    ? reportedCostCents
    : null;

  return {
    costCents,
    textSource: actualCacheHit ? 'cache' : null,
    cacheDecision: bypassed ? 'bypass' : actualCacheHit ? 'hit' : cacheMiss ? 'miss' : 'unknown',
    cacheTelemetryMeasured: bypassed || actualCacheHit || cacheMiss,
    costMeasured: costCents !== null,
  };
}

/** Read the final receipt from SSE without counting duplicate frames twice. */
function measurementFromFrames(frames = [], cacheStatus = null) {
  let provenance = null;
  let accounting = null;
  for (const frame of Array.isArray(frames) ? frames : []) {
    if (!frame || frame.type !== 'provenance') continue;
    if (frame.provenance && typeof frame.provenance === 'object') provenance = frame.provenance;
    if (frame.accounting && typeof frame.accounting === 'object') accounting = frame.accounting;
    if (frame.provenance?.accounting && typeof frame.provenance.accounting === 'object') {
      accounting = frame.provenance.accounting;
    }
  }
  return {
    ...observationTelemetry({ provenance, accounting, cacheStatus }),
    provenance,
    accounting,
  };
}

const metricMeasurementFlags = (metrics = {}) => ({
  COST_MEASURED: Number.isFinite(metrics.costCentsPerTurn),
  CACHE_PRECISION_MEASURED: Number.isFinite(metrics.cachePrecision),
});

module.exports = {
  CACHE_HIT_ROUTES,
  SCHEMA_VERSION,
  UNKNOWN_USAGE,
  unknownUsage,
  buildTurnAccountingMeta,
  observationTelemetry,
  measurementFromFrames,
  metricMeasurementFlags,
};
