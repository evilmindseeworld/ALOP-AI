'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  EXPECTED_GENERATED_CASE_COUNT,
  PHOTOSYNTHESIS_RELATION_CASES,
} = require('./photosynthesis-relation-cases');
const { gradeCase } = require('./evaluation');
const {
  evaluatePhotosynthesisRelations,
  PHOTOSYNTHESIS_SEMANTIC_EVALUATOR_REGISTRY,
  evaluatePhotosynthesisRelationsV2,
} = require('./photosynthesis-relation-evaluator');

const evaluateV2OrApprovedBase = evaluatePhotosynthesisRelationsV2 || evaluatePhotosynthesisRelations;

const FROZEN_V2_ROOT_CASES = [
  { id: 'ADV001', text: 'Photosynthesis may use chlorophyll to capture light energy.', expectedDecision: 'FAIL', expectedPolarity: 'UNCERTAIN' },
  { id: 'ADV002', text: 'Photosynthesis uses chlorophyll to capture carbon dioxide and light is nearby.', expectedDecision: 'FAIL', expectedPolarity: 'UNRESOLVED' },
  { id: 'ADV003', text: 'Photosynthesis chlorophyll capture light energy.', expectedDecision: 'FAIL', expectedPolarity: 'UNRESOLVED' },
  { id: 'ADV004', text: 'Photosynthesis does not fail to use chlorophyll to capture light energy.', expectedDecision: 'PASS', expectedPolarity: 'AFFIRMED' },
  { id: 'ADV005', text: 'Light energy is captured by chlorophyll during photosynthesis.', expectedDecision: 'PASS', expectedPolarity: 'AFFIRMED' },
  { id: 'ADV006', text: 'Animals and plants use chlorophyll to capture light energy during photosynthesis.', expectedDecision: 'FAIL', expectedPolarity: 'MIXED_INVALID' },
];

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

test('the photosynthesis semantic evaluator registry is immutable', () => {
  assert.equal(Object.isFrozen(PHOTOSYNTHESIS_SEMANTIC_EVALUATOR_REGISTRY), true);
  assert.equal(PHOTOSYNTHESIS_SEMANTIC_EVALUATOR_REGISTRY['photosynthesis-light-relation-v1'], evaluatePhotosynthesisRelations);
});

test('frozen V2 canonical ADV001-ADV006 are behaviorally red on the approved base', async (t) => {
  for (const item of FROZEN_V2_ROOT_CASES) {
    await t.test(item.id, () => {
      const result = evaluateV2OrApprovedBase(item.text);
      assert.equal(result.passed, item.expectedDecision === 'PASS', `${item.id}: ${item.text}`);
      assert.equal(result.polarity, item.expectedPolarity, `${item.id}: ${item.text}`);
      assert.equal(result.evaluatorId, 'photosynthesis-light-relation-v2', `${item.id}: ${item.text}`);
    });
  }
});

test('baseline-callable active V2 grammar RED cases', async (t) => {
  const cases = [
    { id: 'B1-valid-simple', text: 'Photosynthesis captures light energy.', passed: true },
    { id: 'B1-valid-coordinated-subjects', text: 'Plants and algae capture light energy.', passed: true },
    { id: 'B1-subject-agreement', text: 'Plants captures light energy.', passed: false, diagnostic: 'GRAMMAR_SHAPE_NOT_ACCEPTED' },
    { id: 'B1-bare-participle', text: 'Photosynthesis capturing light energy.', passed: false, diagnostic: 'GRAMMAR_SHAPE_NOT_ACCEPTED' },
    { id: 'B1-malformed-auxiliary', text: 'Photosynthesis are captures light energy.', passed: false, diagnostic: 'GRAMMAR_SHAPE_NOT_ACCEPTED' },
    { id: 'B1-unresolved-or', text: 'Plants or algae capture light energy.', passed: false, diagnostic: 'UNSUPPORTED_CO_SUBJECT' },
    { id: 'B1-comma-without-and', text: 'Plants, algae capture light energy.', passed: false, diagnostic: 'UNSUPPORTED_CO_SUBJECT' },
  ];

  for (const item of cases) {
    await t.test(item.id, () => {
      const result = evaluateV2OrApprovedBase(item.text);
      assert.equal(result.passed, item.passed, item.text);
      assert.equal(result.evaluatorId, 'photosynthesis-light-relation-v2', item.text);
      if (item.diagnostic) assert.ok(result.diagnostics?.includes(item.diagnostic), item.text);
    });
  }
});

test('baseline-callable passive V2 grammar RED cases', async (t) => {
  const rejected = [
    { id: 'B2-local-negation', text: 'Light energy is not captured by chlorophyll during photosynthesis.', polarity: 'NEGATED', reason: 'LOCAL_NEGATION' },
    { id: 'B2-uncertain-modal', text: 'Light energy may be captured by chlorophyll during photosynthesis.', polarity: 'UNCERTAIN', reason: 'POSSIBILITY' },
    { id: 'B2-stacked-modal', text: 'Light energy must may be captured by chlorophyll during photosynthesis.', polarity: 'UNRESOLVED', reason: 'STACKED_MODAL_CHAIN' },
    { id: 'B2-destructive-passive', text: 'Light energy is destroyed by chlorophyll during photosynthesis.', polarity: 'AFFIRMED', reason: 'DIRECT_ASSERTION', relationType: 'DESTRUCTIVE_RELATION' },
  ];
  const accepted = [
    'Light energy is captured by chlorophyll during photosynthesis.',
    'Light energy has been captured by chlorophyll during photosynthesis.',
    'Sunlight is absorbed by green plants during photosynthesis.',
    'Light energy must be captured by chlorophyll during photosynthesis.',
  ];

  for (const text of accepted) {
    await t.test(`B2-supported: ${text}`, () => {
      const result = evaluateV2OrApprovedBase(text);
      assert.equal(result.passed, true, text);
      assert.ok(result.relationRecords.some((record) => record.voice === 'PASSIVE' && record.qualifies), text);
    });
  }
  for (const item of rejected) {
    await t.test(item.id, () => {
      const result = evaluateV2OrApprovedBase(item.text);
      const record = result.relationRecords.find((entry) => entry.voice === 'PASSIVE');
      assert.equal(result.passed, false, item.text);
      assert.equal(record?.polarity, item.polarity, item.text);
      assert.equal(record?.polarityReason, item.reason, item.text);
      assert.equal(record?.qualifies, false, item.text);
      if (item.relationType) assert.equal(record?.relationType, item.relationType, item.text);
    });
  }
});

test('baseline-callable structured V2 composition RED cases', async (t) => {
  const wrongPigment = 'Photosynthesis captures light energy. Melanin rather than chlorophyll captures the light for photosynthesis.';
  const negatedWrongPigment = 'Photosynthesis captures light energy. Melanin does not capture light energy during photosynthesis.';
  const contradictions = [
    'Photosynthesis does not capture light energy. Photosynthesis captures light energy.',
    'Photosynthesis captures light energy. Photosynthesis does not capture light energy.',
  ];
  const nonContradiction = 'Photosynthesis captures light energy but does not store light energy.';
  const crossSentenceMediation = 'Photosynthesis uses chlorophyll to capture carbon dioxide. Plants capture light energy.';

  await t.test('asserted wrong pigment survives beside a valid relation', () => {
    const result = evaluateV2OrApprovedBase(wrongPigment);
    assert.equal(result.passed, false);
      assert.ok(result.invalidChlorophyllClaims?.some((record) => record.relationType === 'WRONG_PIGMENT_RELATION' && record.polarity === 'AFFIRMED'));
  });
  await t.test('negated wrong pigment retains local negation', () => {
    const result = evaluateV2OrApprovedBase(negatedWrongPigment);
    const record = result.relationRecords?.find((entry) => entry.relationType === 'WRONG_PIGMENT_RELATION');
    assert.ok(record);
    assert.equal(record.polarity, 'NEGATED');
    assert.equal(record.polarityReason, 'LOCAL_NEGATION');
    assert.equal(record.qualifies, false);
    assert.equal(result.passed, true);
    assert.equal(result.polarity, 'AFFIRMED');
    assert.equal(result.invalidChlorophyllClaims?.some((entry) => entry.polarity === 'NEGATED'), false);
  });
  for (const [index, text] of contradictions.entries()) {
    await t.test(`contradiction order ${index + 1}`, () => {
      const result = evaluateV2OrApprovedBase(text);
      assert.equal(result.passed, false, text);
      assert.equal(result.polarity, 'CONTRADICTED', text);
      assert.equal(result.contradictions?.length ?? 0, 1, text);
    });
  }
  await t.test('different target predicates are not fabricated into a contradiction', () => {
    const result = evaluateV2OrApprovedBase(nonContradiction);
    assert.equal(result.passed, true, nonContradiction);
    assert.equal(result.contradictions?.length ?? 0, 0, nonContradiction);
  });
  await t.test('chlorophyll mediation stays local to its sentence', () => {
    const result = evaluateV2OrApprovedBase(crossSentenceMediation);
    assert.equal(result.positiveChlorophyllBinding, false, crossSentenceMediation);
    assert.equal(result.relationRecords?.some((record) => record.relationType === 'CHLOROPHYLL_SUPPORT' && record.qualifies) ?? false, false, crossSentenceMediation);
  });
});

test('baseline-callable real dataset seam RED requires V2 dispatch', () => {
  const dataset = JSON.parse(readFileSync(join(__dirname, '..', 'evals', 'backend-intelligence-v2.json'), 'utf8'));
  const testCase = dataset.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
  const grade = gradeCase(testCase, { answer: 'Photosynthesis is how plants use chlorophyll to capture light energy.' });
  assert.equal(testCase.factualityChecks.evaluatorId, 'photosynthesis-light-relation-v2');
  assert.equal(grade.factuality.evaluatorId, 'photosynthesis-light-relation-v2');
  assert.equal(grade.factuality.passed, true);
});

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
  for (const text of valid) assert.equal(evaluateV2OrApprovedBase(text).passed, true, text);
  for (const text of invalid) assert.equal(evaluateV2OrApprovedBase(text).passed, false, text);
});

test('PREQ-004 retains a valid negated cross-lemma pronoun relation in factuality', () => {
  const text = 'Plants capture light energy but do not store it.';
  const result = evaluateV2OrApprovedBase(text);
  assert.equal(result.passed, true);
  assert.equal(result.polarity, 'AFFIRMED');
  assert.equal(result.hasMalformed, false);
  assert.deepEqual(result.relationRecords.map((record) => ({
    subject: record.subjectSet?.lemma,
    predicate: record.verbLemma,
    object: record.directObject?.normalized,
    binding: record.lightObject?.binding,
    polarity: record.polarity,
    qualifies: record.qualifies,
  })), [
    { subject: 'plant', predicate: 'capture', object: 'light-energy', binding: 'DIRECT_OBJECT', polarity: 'AFFIRMED', qualifies: true },
    { subject: 'plant', predicate: 'store', object: 'light-energy', binding: 'PRONOUN_ANTECEDENT', polarity: 'NEGATED', qualifies: false },
  ]);

  const dataset = JSON.parse(readFileSync(join(__dirname, '..', 'evals', 'backend-intelligence-v2.json'), 'utf8'));
  const item = dataset.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
  assert.ok(item);
  assert.equal(gradeCase(item, { answer: text }).factuality.passed, true);
});

test('PREQ-005 preserves explicit propositions and scoped contradiction topology', () => {
  for (const subject of ['Plant', 'Alga']) {
    const text = `${subject} captures light energy but ${subject.toLowerCase()} does not capture light energy.`;
    const result = evaluateV2OrApprovedBase(text);
    assert.equal(result.relationRecords.length, 2, text);
    assert.equal(result.relationRecords.every((record) => record.subjectSet?.lemma === subject.toLowerCase()), true, text);
    assert.deepEqual(result.relationRecords.map((record) => record.polarity), ['AFFIRMED', 'NEGATED'], text);
    assert.equal(result.contradictions.length, 1, text);
    assert.equal(result.polarity, 'CONTRADICTED', text);
    assert.equal(result.passed, false, text);
  }
  const unrelated = evaluateV2OrApprovedBase('Plant captures light energy but plant does not store light energy.');
  assert.equal(unrelated.contradictions.length, 0);
  assert.equal(unrelated.passed, true);
});

test('PREQ-009 permits optional passive context but keeps chlorophyll context local', () => {
  const noContext = evaluateV2OrApprovedBase('Light energy is captured by plants and algae.');
  assert.equal(noContext.passed, true);
  assert.equal(noContext.relationRecords.length, 2);
  assert.equal(noContext.relationRecords.every((record) => record.subjectSet?.valid === true), true);

  const withContext = evaluateV2OrApprovedBase('Light energy is captured by plants and algae during photosynthesis.');
  assert.equal(withContext.passed, true);
  assert.equal(withContext.relationRecords.length, 2);

  const chlorophyllMissing = evaluateV2OrApprovedBase('Light energy is captured by chlorophyll.');
  assert.equal(chlorophyllMissing.passed, false);
  const chlorophyllWithContext = evaluateV2OrApprovedBase('Light energy is captured by chlorophyll during photosynthesis.');
  assert.equal(chlorophyllWithContext.passed, true);
});
