'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SERVER = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

test('search council keeps the base call path and does not inject a metered adapter', () => {
  const start = SERVER.indexOf('const searchDrafts = await runCouncilWithWhip(');
  const end = SERVER.indexOf('if (turnSignal.aborted) return;', start);
  assert.ok(start >= 0 && end > start, 'search council call site not found');
  const searchCall = SERVER.slice(start, end);
  assert.doesNotMatch(searchCall, /\bcallModel\s*:/);
  assert.doesNotMatch(searchCall, /meteredCallModel|modelPacer|providerHealth/);
  assert.match(SERVER, /runCouncil\(members, messages, whipMs, quorum, tokenLimit, \{ callModel, onSeat, \.\.\.options \}\)/);
});
