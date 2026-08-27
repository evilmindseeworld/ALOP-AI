'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canRetryStream } = require('./stream-retry-policy');

test('a turn deadline is terminal for the stream fallback ladder', () => {
  assert.equal(canRetryStream({ fallbackModel: 'recovery', error: { code: 'OPENROUTER_DEADLINE' } }), false);
  assert.equal(canRetryStream({ fallbackModel: 'recovery', error: { code: 'ECONNRESET' } }), true);
  assert.equal(canRetryStream({ fallbackModel: 'recovery', error: { code: 'ECONNRESET' }, wroteChars: 1 }), false);

  const controller = new AbortController();
  controller.abort();
  assert.equal(canRetryStream({ fallbackModel: 'recovery', error: { code: 'ECONNRESET' }, signal: controller.signal }), false);
});
