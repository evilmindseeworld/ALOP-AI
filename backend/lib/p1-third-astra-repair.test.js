const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');

test('PREQ-004 inherits subject agreement through contrast continuations', () => {
  const valid = [
    'Plants capture light energy but do not store it.',
    'Plant captures light energy but does not store it.',
    'Photosynthesis captures light energy but does not store it.',
    'Algae capture light energy but do not store it.',
    'Alga captures light energy but does not store it.',
  ];
  const invalid = [
    'Plants capture light energy but does not store it.',
    'Plant captures light energy but do not store it.',
    'Photosynthesis captures light energy but do not store it.',
    'Algae capture light energy but does not store it.',
    'Alga captures light energy but do not store it.',
    'Plants capture light energy but does not stores it.',
    'Plants capture light energy but did captured it.',
    'Plants capture light energy but did storing it.',
  ];
  for (const text of valid) assert.equal(evaluatePhotosynthesisRelationsV2(text).passed, true, text);
  for (const text of invalid) assert.equal(evaluatePhotosynthesisRelationsV2(text).passed, false, text);
});

test('PREQ-005 preserves explicit propositions and scoped contradiction topology', () => {
  for (const subject of ['Plant', 'Alga']) {
    const text = `${subject} captures light energy but ${subject.toLowerCase()} does not capture light energy.`;
    const result = evaluatePhotosynthesisRelationsV2(text);
    assert.equal(result.relationRecords.length, 2, text);
    assert.equal(result.relationRecords.every((record) => record.subjectSet?.lemma === subject.toLowerCase()), true, text);
    assert.deepEqual(result.relationRecords.map((record) => record.polarity), ['AFFIRMED', 'NEGATED'], text);
    assert.equal(result.contradictions.length, 1, text);
    assert.equal(result.polarity, 'CONTRADICTED', text);
    assert.equal(result.passed, false, text);
  }
  const unrelated = evaluatePhotosynthesisRelationsV2('Plant captures light energy but plant does not store light energy.');
  assert.equal(unrelated.contradictions.length, 0);
  assert.equal(unrelated.passed, true);
});

test('PREQ-009 permits optional passive context but keeps chlorophyll context local', () => {
  const noContext = evaluatePhotosynthesisRelationsV2('Light energy is captured by plants and algae.');
  assert.equal(noContext.passed, true);
  assert.equal(noContext.relationRecords.length, 2);
  assert.equal(noContext.relationRecords.every((record) => record.subjectSet?.valid === true), true);

  const withContext = evaluatePhotosynthesisRelationsV2('Light energy is captured by plants and algae during photosynthesis.');
  assert.equal(withContext.passed, true);
  assert.equal(withContext.relationRecords.length, 2);

  const chlorophyllMissing = evaluatePhotosynthesisRelationsV2('Light energy is captured by chlorophyll.');
  assert.equal(chlorophyllMissing.passed, false);
  const chlorophyllWithContext = evaluatePhotosynthesisRelationsV2('Light energy is captured by chlorophyll during photosynthesis.');
  assert.equal(chlorophyllWithContext.passed, true);
});
