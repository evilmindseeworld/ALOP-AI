'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyFailureKind } = require('./failure-kind');

test('failure classification keeps the four actionable terminal kinds', () => {
  assert.equal(classifyFailureKind({ code: 'OPENROUTER_DEADLINE' }), 'turn_deadline');
  assert.equal(classifyFailureKind({ code: 'OPENROUTER_RATE_LIMIT', status: 429 }), 'provider_rate_limited');
  assert.equal(classifyFailureKind({ code: 'OPENROUTER_DAILY_LIMIT', status: 429 }), 'provider_rate_limited');
  assert.equal(classifyFailureKind({ status: 429 }), 'provider_rate_limited');
  assert.equal(classifyFailureKind({ code: 'ETIMEDOUT' }), 'upstream_timeout');
  assert.equal(classifyFailureKind({ name: 'TimeoutError' }), 'upstream_timeout');
  assert.equal(classifyFailureKind({ status: 503 }), 'provider_error');
  assert.equal(classifyFailureKind({ code: 'OPENROUTER_HTTP_ERROR', status: 404 }), 'provider_error');
  assert.equal(classifyFailureKind({ code: 'ECONNRESET' }), 'provider_error');
  assert.equal(classifyFailureKind({ code: 'CIRCUIT_OPEN' }), 'provider_error');
});

test('local, cancelled, and unknown failures remain unclassified', () => {
  assert.equal(classifyFailureKind({ code: 'ANSWER_OUTPUT_CONTRACT' }), null);
  assert.equal(classifyFailureKind({ name: 'AbortError', status: 429 }), null);
  assert.equal(classifyFailureKind(new Error('not enough evidence')), null);
  assert.equal(classifyFailureKind(null), null);
});
