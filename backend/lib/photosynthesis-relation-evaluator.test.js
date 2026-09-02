'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPECTED_GENERATED_CASE_COUNT,
  PHOTOSYNTHESIS_RELATION_CASES,
} = require('./photosynthesis-relation-cases');
const { evaluatePhotosynthesisRelations } = require('./photosynthesis-relation-evaluator');

test('photosynthesis-light-relation-v1 generated 823 cases with stable unique ids', () => {
  assert.equal(PHOTOSYNTHESIS_RELATION_CASES.length, 823);
  assert.equal(PHOTOSYNTHESIS_RELATION_CASES.length, EXPECTED_GENERATED_CASE_COUNT);
  assert.equal(new Set(PHOTOSYNTHESIS_RELATION_CASES.map(({ id }) => id)).size, 823);
  for (const testCase of PHOTOSYNTHESIS_RELATION_CASES) {
    const result = evaluatePhotosynthesisRelations(testCase.answer);
    assert.equal(result.passed, testCase.expected, testCase.id);
  }
});

test('relation-local-polarity exposes structured relationRecords', () => {
  const result = evaluatePhotosynthesisRelations(
    'Photosynthesis uses chlorophyll to capture light energy, but it does not release oxygen.',
  );
  assert.equal(result.passed, true);
  assert.ok(Array.isArray(result.relationRecords));
  assert.ok(result.relationRecords.some((record) => record.polarity === 'positive'));
  assert.ok(result.relationRecords.every((record) => record.sentenceIndex >= 0));
});
