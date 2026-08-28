'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SOURCE = readFileSync(join(__dirname, 'evaluation.js'), 'utf8');
const current = require('./evaluation');

const loadMutant = (source) => {
  const module = { exports: {} };
  const localRequire = (request) => require(join(__dirname, request));
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
};

const haiku = 'Endpoints whisper soft\nLogs scream in silent rows\nRetries spin, nothing works\nCoffee fuels the fix';
const structured = 'The generated artifact is validated before it is returned to the caller.\nreturn xy';

test('mutation: widening the short-tail detector catches the legitimate poetry fixture', () => {
  assert.equal(current.isLikelyComplete(haiku), true);
  const mutantSource = SOURCE.replace('trailingWord.length <= 2', 'trailingWord.length <= 3');
  assert.notEqual(mutantSource, SOURCE, 'the guarded production expression was not found');
  assert.equal(loadMutant(mutantSource).isLikelyComplete(haiku), false,
    'the positive fixture did not catch the broadened tail heuristic');
});

test('mutation: removing the structured-line exception catches a code-shaped ending', () => {
  assert.equal(current.isLikelyComplete(structured), true);
  const mutantSource = SOURCE.replace('&& !structuredLine', '&& true');
  assert.notEqual(mutantSource, SOURCE, 'the structured-line guard was not found');
  assert.equal(loadMutant(mutantSource).isLikelyComplete(structured), false,
    'the positive fixture did not catch removal of the structured-line guard');
});
