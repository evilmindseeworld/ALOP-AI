'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { DEFAULT_HEAD_LADDER } = require('./model-ladder');

const SERVER = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

const DEAD_ROUTES = [
  'openai/gpt-oss-20b:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
];

const CURRENT_COUNCIL = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'cohere/north-mini-code:free',
  'poolside/laguna-s-2.1:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
];

/* server.js cannot be imported in a unit test: its boot contract exits when
 * required infrastructure variables are absent. Parse the literal council
 * block that the process executes instead of starting a second server. */
const councilIds = (source, marker) => {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} is missing`);
  const end = source.indexOf(']', start);
  assert.ok(end > start, `${marker} has no closing array`);
  return [...source.slice(start, end).matchAll(/\bmodel:\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
};

test('the runtime council no longer selects the two upstream-dead free routes', () => {
  const configured = councilIds(SERVER, 'const COUNCIL = [');
  assert.deepEqual(configured, CURRENT_COUNCIL);
  for (const dead of DEAD_ROUTES) {
    assert.ok(!configured.includes(dead), `${dead} remains runtime-selectable`);
  }
});

test('route removal leaves an existing non-empty free head fallback ladder', () => {
  assert.ok(CURRENT_COUNCIL.length > 0);
  assert.deepEqual(DEFAULT_HEAD_LADDER.map(({ model }) => model), [
    'nvidia/nemotron-3-super-120b-a12b:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
  ]);
});
