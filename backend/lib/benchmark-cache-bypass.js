'use strict';

const crypto = require('node:crypto');

const HEADER = 'x-alop-benchmark-cache-bypass';
const SECRET_ENV = 'ALOP_BENCHMARK_CACHE_BYPASS_SECRET';

/**
 * Authorise the evaluator to skip both answer-cache tiers for one request.
 *
 * A header by itself is not enough: otherwise any caller could turn a cheap
 * cache hit into a model request on demand. The secret stays in the process
 * environment and is compared without logging either side. An absent or bad
 * secret is a normal cacheable request, never an accidental bypass.
 */
function benchmarkCacheBypass({ headers = {}, env = process.env } = {}) {
  const supplied = headers && typeof headers === 'object' && !Array.isArray(headers)
    ? headers[HEADER]
    : null;
  const requested = typeof supplied === 'string' && supplied.length > 0;
  if (!requested) return { enabled: false, requested: false, reason: 'not_requested' };

  const configured = typeof env?.[SECRET_ENV] === 'string' ? env[SECRET_ENV] : '';
  if (!configured) return { enabled: false, requested: true, reason: 'not_configured' };

  const given = Buffer.from(supplied, 'utf8');
  const expected = Buffer.from(configured, 'utf8');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { enabled: false, requested: true, reason: 'invalid_secret' };
  }

  return { enabled: true, requested: true, reason: 'authorized' };
}

module.exports = { benchmarkCacheBypass, HEADER, SECRET_ENV };
