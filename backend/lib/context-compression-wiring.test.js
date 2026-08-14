'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
const ROUTE = SOURCE.slice(SOURCE.indexOf("app.post('/api/council'"), SOURCE.indexOf('// ===== OVERLAY'));

test('the council route builds one bounded context projection before prompt assembly', () => {
  assert.match(SOURCE, /require\('\.\/lib\/context-compression'\)/);
  assert.match(ROUTE, /compressConversationContext\(histArr, pv\.value, \{\s*complexity: selection\.complexity/s);
  assert.match(ROUTE, /const promptHistory = compressedContext\.messages/);
  assert.match(ROUTE, /telemetry\.recordContextCompression\(compressedContext\.stats\)/);
});

test('all council answer paths use the compressed projection, not a raw tail slice', () => {
  for (const path of ['probeMsgs', 'memMsgs', 'extMsgs', 'wikiMsgs', 'councilMsgs', 'fbMsgs']) {
    const line = ROUTE.split('\n').find((sourceLine) => sourceLine.includes(`const ${path} =`));
    assert.ok(line, `${path} prompt was not found`);
    assert.match(line, /promptHistory/);
    assert.doesNotMatch(line, /histArr\.slice/);
  }
});

test('compression is not allowed to weaken shared-cache personalisation', () => {
  const gate = ROUTE.indexOf('const hasConversationHistory =');
  assert.ok(gate > 0);
  const window = ROUTE.slice(gate, gate + 350);
  assert.match(window, /histArr\.length/);
  assert.doesNotMatch(window, /promptHistory/);
});

test('the context window note is server-authored and only appears after omission', () => {
  const context = ROUTE.slice(ROUTE.indexOf('const contextMsgs ='), ROUTE.indexOf('console.log(`[COUNCIL] ${user.email}'));
  assert.match(context, /compressedContext\.stats\.droppedMessages/);
  assert.match(context, /CONTEXT WINDOW:/);
  assert.doesNotMatch(context, /pv\.value|histArr/);
});
