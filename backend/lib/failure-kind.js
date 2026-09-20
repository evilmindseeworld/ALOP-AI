'use strict';

/*
 * A small, provider-agnostic vocabulary for the terminal failure that a turn
 * already observed. This is deliberately an error-shape classifier, not a
 * message parser: provider bodies may contain user text and must never become
 * durable provenance.
 */

const RATE_LIMIT_CODES = new Set([
  'OPENROUTER_RATE_LIMIT',
  'OPENROUTER_DAILY_LIMIT',
]);

const UPSTREAM_TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UPSTREAM_TIMEOUT',
]);

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
]);

/**
 * @param {unknown} error
 * @returns {'provider_error'|'provider_rate_limited'|'upstream_timeout'|'turn_deadline'|null}
 */
function classifyFailureKind(error) {
  if (!error || typeof error !== 'object') return null;
  if (error.name === 'AbortError') return null;

  const code = typeof error.code === 'string' ? error.code.toUpperCase() : '';
  const status = Number(error.status);

  if (code === 'OPENROUTER_DEADLINE') return 'turn_deadline';
  if (status === 429 || RATE_LIMIT_CODES.has(code)) return 'provider_rate_limited';
  if (UPSTREAM_TIMEOUT_CODES.has(code) || error.name === 'TimeoutError') return 'upstream_timeout';
  if (NETWORK_CODES.has(code) || code === 'CIRCUIT_OPEN') return 'provider_error';
  if (Number.isFinite(status) && status >= 500 && status <= 599) return 'provider_error';
  if (code.startsWith('OPENROUTER_') && code !== 'OPENROUTER_DEADLINE') return 'provider_error';

  return null;
}

module.exports = { classifyFailureKind };
