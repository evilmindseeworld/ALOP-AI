'use strict';

const crypto = require('node:crypto');

const HEADER = 'x-alop-benchmark-cache-bypass';
const SECRET_ENV = 'ALOP_BENCHMARK_CACHE_BYPASS_SECRET';
const VALIDATION_HEADER = 'x-alop-benchmark-cache-validation';
const VALIDATION_RUN_HEADER = 'x-alop-benchmark-cache-validation-run';
const VALIDATION_CASE_HEADER = 'x-alop-benchmark-cache-validation-case';
const VALIDATION_PHASE_HEADER = 'x-alop-benchmark-cache-validation-phase';
const PREFLIGHT_HEADER = 'x-alop-benchmark-zero-price-preflight';
const SAFE_BINDING = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const VALIDATION_PHASES = new Set(['seed', 'hit']);

const headerValue = (headers, name) => headers && typeof headers === 'object' && !Array.isArray(headers)
  && typeof headers[name] === 'string'
  ? headers[name]
  : null;

const authorize = (supplied, env) => {
  if (typeof supplied !== 'string' || supplied.length === 0) return { requested: false, reason: 'not_requested' };
  const configured = typeof env?.[SECRET_ENV] === 'string' ? env[SECRET_ENV] : '';
  if (!configured) return { requested: true, reason: 'not_configured' };
  const given = Buffer.from(supplied, 'utf8');
  const expected = Buffer.from(configured, 'utf8');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { requested: true, reason: 'invalid_secret' };
  }
  return { requested: true, reason: 'authorized' };
};

/**
 * Authorise the evaluator to skip both answer-cache tiers for one request.
 *
 * A header by itself is not enough: otherwise any caller could turn a cheap
 * cache hit into a model request on demand. The secret stays in the process
 * environment and is compared without logging either side. An absent or bad
 * secret is a normal cacheable request, never an accidental bypass.
 */
function benchmarkCacheBypass({ headers = {}, env = process.env } = {}) {
  const auth = authorize(headerValue(headers, HEADER), env);
  return { enabled: auth.reason === 'authorized', ...auth };
}

/**
 * Authorise the fixed cache-validation experiment. This is deliberately a
 * different header from the bypass header: a valid validation request gets an
 * isolated cache namespace, while ordinary production cache semantics remain
 * enabled and the bypass flag remains false.
 */
function benchmarkCacheValidation({ headers = {}, env = process.env } = {}) {
  const auth = authorize(headerValue(headers, VALIDATION_HEADER), env);
  if (auth.reason !== 'authorized') return { enabled: false, ...auth };
  const runId = headerValue(headers, VALIDATION_RUN_HEADER);
  const caseId = headerValue(headers, VALIDATION_CASE_HEADER);
  const phase = headerValue(headers, VALIDATION_PHASE_HEADER);
  if (!SAFE_BINDING.test(runId || '') || !SAFE_BINDING.test(caseId || '') || !VALIDATION_PHASES.has(phase)) {
    return { enabled: false, requested: true, reason: 'invalid_binding' };
  }
  return { enabled: true, requested: true, reason: 'authorized', runId, caseId, phase };
}

/** Authorise a metadata-only zero-price preflight with the same evaluator secret. */
function benchmarkZeroPricePreflight({ headers = {}, env = process.env } = {}) {
  const auth = authorize(headerValue(headers, PREFLIGHT_HEADER), env);
  return { enabled: auth.reason === 'authorized', ...auth };
}

module.exports = {
  benchmarkCacheBypass,
  benchmarkCacheValidation,
  benchmarkZeroPricePreflight,
  HEADER,
  SECRET_ENV,
  VALIDATION_HEADER,
  VALIDATION_RUN_HEADER,
  VALIDATION_CASE_HEADER,
  VALIDATION_PHASE_HEADER,
  PREFLIGHT_HEADER,
};
