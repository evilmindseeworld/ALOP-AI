'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { TRADEOFF_GUIDANCE } = require('./synthesis-guidance');

const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

test('trade-off guidance covers benefits, costs, and diminishing returns for paraphrased questions', () => {
  const paraphrases = [
    'Should we add another independent review step?',
    'Would a second cache layer be worth operating?',
    'Is expanding the validation process justified here?',
  ];

  for (const question of paraphrases) {
    assert.ok(question.length > 0);
    assert.match(TRADEOFF_GUIDANCE, /marginal benefit/i);
    assert.match(TRADEOFF_GUIDANCE, /marginal cost/i);
    assert.match(TRADEOFF_GUIDANCE, /redundant|duplicate/i);
    assert.match(TRADEOFF_GUIDANCE, /diminishing returns/i);
  }
});

test('trade-off guidance is reasoning policy, not benchmark-specific matching', () => {
  assert.doesNotMatch(TRADEOFF_GUIDANCE, /model-disagreement-value/i);
  assert.doesNotMatch(TRADEOFF_GUIDANCE, /five models give nearly identical/i);
  assert.doesNotMatch(TRADEOFF_GUIDANCE, /redundant\|duplicate\|diminishing/i);
});

test('the general guidance reaches every direct council and synthesis writer', () => {
  assert.match(SOURCE, /require\('\.\/lib\/synthesis-guidance'\)/);
  const council = SOURCE.slice(SOURCE.indexOf('const councilSys ='), SOURCE.indexOf('const councilMsgs ='));
  const synthesis = SOURCE.slice(SOURCE.indexOf('const synthSys ='), SOURCE.indexOf('const researchBlock ='));
  assert.match(council, /TRADEOFF_GUIDANCE/);
  assert.match(synthesis, /TRADEOFF_GUIDANCE/);
  for (const [start, end] of [
    ['const searchSynthSys =', 'const searchSynthSysForAnswer ='],
    ['const wikiSys =', 'const wikiMsgs ='],
  ]) {
    assert.match(SOURCE.slice(SOURCE.indexOf(start), SOURCE.indexOf(end)), /TRADEOFF_GUIDANCE/);
  }
  assert.match(SOURCE, /policies: \[SOURCE_TRUTH_RULES, TRADEOFF_GUIDANCE,/);
});
