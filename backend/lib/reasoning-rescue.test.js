'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { rescueReasoning } = require('./reasoning-rescue');
const { parseOpenRouterSseLine } = require('./openrouter');

const passthrough = (text) => ({ text });

test('reasoning is never promoted while the model also wrote an answer', () => {
  assert.equal(
    rescueReasoning({ emittedLength: 12, reasoningParts: ['I should check the date.'], sanitize: passthrough }),
    null,
  );
});

test('reasoning IS promoted when the stream produced no answer content at all', () => {
  const rescued = rescueReasoning({
    emittedLength: 0,
    reasoningParts: ['The capital ', 'is Paris.'],
    sanitize: passthrough,
  });
  assert.deepEqual(rescued, { text: 'The capital is Paris.' });
});

test('whitespace-only reasoning is not an answer', () => {
  assert.equal(rescueReasoning({ emittedLength: 0, reasoningParts: ['  \n '], sanitize: passthrough }), null);
  assert.equal(rescueReasoning({ emittedLength: 0, reasoningParts: [], sanitize: passthrough }), null);
});

/* The sanitiser is not decoration. A model reasoning out loud about which tool
 * to call writes the protocol block it was taught, and without this the block
 * would be promoted to an answer and shown to the user as one. */
test('the protocol sanitiser can refuse a rescue', () => {
  const rejecting = () => ({ text: '', rejected: true });
  assert.equal(
    rescueReasoning({ emittedLength: 0, reasoningParts: ['{"tool_call": ...}'], sanitize: rejecting }),
    null,
  );
});

test('a sanitiser that empties the text yields no answer', () => {
  assert.equal(
    rescueReasoning({ emittedLength: 0, reasoningParts: ['xx'], sanitize: () => ({ text: '   ' }) }),
    null,
  );
});

/* END TO END ACROSS THE SEAM. The parser splits the two fields and the rescue
 * decides what to do with them; a test of either alone would pass while the
 * pair disagreed about which field carries what. */
test('parser and rescue agree: thinking beside an answer is discarded, thinking alone is kept', () => {
  const frames = [
    'data: {"choices":[{"delta":{"reasoning":"Let me think. "}}]}',
    'data: {"choices":[{"delta":{"reasoning":"Paris is the capital."}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
  ].map(parseOpenRouterSseLine);
  const emitted = frames.filter((f) => f.text).map((f) => f.text);
  const reasoning = frames.filter((f) => f.reasoning).map((f) => f.reasoning);
  assert.deepEqual(emitted, [], 'no reasoning delta may reach the answer stream');
  assert.deepEqual(
    rescueReasoning({ emittedLength: emitted.join('').length, reasoningParts: reasoning, sanitize: passthrough }),
    { text: 'Let me think. Paris is the capital.' },
  );

  const withAnswer = [
    'data: {"choices":[{"delta":{"reasoning":"Let me think. "}}]}',
    'data: {"choices":[{"delta":{"content":"Paris."}}]}',
  ].map(parseOpenRouterSseLine);
  const answerText = withAnswer.filter((f) => f.text).map((f) => f.text).join('');
  assert.equal(answerText, 'Paris.');
  assert.equal(
    rescueReasoning({
      emittedLength: answerText.length,
      reasoningParts: withAnswer.filter((f) => f.reasoning).map((f) => f.reasoning),
      sanitize: passthrough,
    }),
    null,
  );
});

/* THE WIRING, asserted in the source because server.js cannot be required —
 * the same seam stream-open-order.test.js uses. A module that is correct and
 * unreferenced is worth nothing on the path that writes every answer. */
test('server.js streams reasoning nowhere except through the rescue', () => {
  const source = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /require\('\.\/lib\/reasoning-rescue'\)/, 'the rescue must be wired into server.js');
  assert.match(source, /rescueReasoning\(\{/, 'streamOnce must call it');
  assert.doesNotMatch(
    source,
    /type: 'chunk', text: frame\.reasoning/,
    'a reasoning delta must never be written straight to the socket',
  );
});
