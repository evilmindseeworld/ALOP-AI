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
  normalizeInputV2,
  segmentSentencesV2,
  segmentClausesV2,
  semanticCaseFingerprint,
} = require('./photosynthesis-relation-evaluator');

test('discourse conjunctions preserve explicit propositions and sentence topology', () => {
  for (const [subject, verb] of [['Plants', 'capture'], ['Algae', 'absorb'], ['Green plants', 'store']]) {
    const first = `${subject} ${verb} light energy`;
    const second = `${subject.toLowerCase()} do not ${verb} light energy.`;
    for (const conjunction of ['', 'And ', 'But ']) {
      const result = evaluatePhotosynthesisRelationsV2(`${first}. ${conjunction}${second}`);
      assert.equal(result.passed, false);
      assert.equal(result.relationRecords.length, 2);
      assert.equal(result.contradictions.length, 1);
      assert.deepEqual(result.topology, [[0, 0], [1, 0]]);
    }
    assert.notEqual(semanticCaseFingerprint(`${first}. And ${second}`),
      semanticCaseFingerprint(`${first} and ${second}`));
    const positive = evaluatePhotosynthesisRelationsV2(`${first}. And ${subject.toLowerCase()} store light energy.`);
    assert.equal(positive.passed, true);
    assert.equal(positive.relationRecords.length, 2);
  }
});

test('explicit malformed continuations reject independently of binding-region boundaries', () => {
  for (const prefix of ['Plants capture light energy.', 'Algae absorb light energy;', 'Algae absorb light energy; Plants capture light energy']) {
    for (const conjunction of ['and', 'but', ', and', ', but']) {
      for (const tail of ['plants do not store.', 'plants does not store light energy.', 'plants and the the algae absorb light energy.']) {
        const input = `${prefix} ${conjunction} ${tail}`;
        const result = evaluatePhotosynthesisRelationsV2(input);
        assert.equal(result.hasMalformed, true, input);
        assert.equal(result.passed, false, input);
      }
    }
  }
});

test('malformed coordination ignores an optional comma before its explicit conjunction', () => {
  for (const verb of ['capture', 'absorb', 'harness', 'use', 'convert', 'transform', 'store']) {
    for (const conjunction of ['and', 'but']) {
      const left = `Photosynthesis uses chlorophyll to ${verb} carbon dioxide ${conjunction} light is nearby.`;
      const right = left.replace(` ${conjunction} `, `, ${conjunction} `);
      assert.equal(semanticCaseFingerprint(left), semanticCaseFingerprint(right), left);
      assert.deepEqual(evaluatePhotosynthesisRelationsV2(left), evaluatePhotosynthesisRelationsV2(right));
    }
  }
});

test('compound irregular noun number is independent of finite verb agreement', () => {
  for (const [singular, plural] of [['Dormouse', 'Dormice'], ['Titmouse', 'Titmice'], ['Woodmouse', 'Woodmice']]) {
    for (const predicate of ['capture', 'do capture', 'do not capture', 'must capture', 'do not fail to capture', 'have captured']) {
      const input = `${plural} ${predicate} light energy.`;
      assert.equal(evaluatePhotosynthesisRelationsV2(input).hasMalformed, false, input);
      assert.equal(semanticCaseFingerprint(input), semanticCaseFingerprint(`Otters ${predicate} light energy.`));
    }
    for (const input of [`${plural} does capture light energy.`, `A ${plural} must capture light energy.`, `${singular} do capture light energy.`]) {
      assert.equal(evaluatePhotosynthesisRelationsV2(input).hasMalformed, true, input);
    }
  }
});

test('every coordinated noun phrase member uses the same complete active and passive grammar', () => {
  const valid = ['plants and algae', 'plants and the algae', 'the plants and algae', 'the plants and the algae'];
  const invalid = ['plants and the the algae', 'the the plants and algae', 'plants and a algae', 'plants and', 'plants and stone dust heap'];
  for (const subject of [...valid, ...invalid]) {
    for (const input of [`${subject} absorb light energy.`, `Light energy is absorbed by ${subject}.`]) {
      const result = evaluatePhotosynthesisRelationsV2(input);
      assert.equal(result.hasMalformed, invalid.includes(subject), input);
      assert.equal(result.passed, valid.includes(subject), input);
    }
  }
});

test('unlicensed noun piles never manufacture a mediated infinitive frame', () => {
  const pair = ['Photosynthesis light energy capture chlorophyll.', 'Photosynthesis sunlight capture chlorophyll.'];
  for (const input of pair) {
    const result = evaluatePhotosynthesisRelationsV2(input);
    assert.equal(result.passed, false);
    assert.equal(result.hasMalformed, true);
    assert.deepEqual(result.relationRecords, []);
  }
  assert.equal(semanticCaseFingerprint(pair[0]), semanticCaseFingerprint(pair[1]));
  assert.equal(evaluatePhotosynthesisRelationsV2('Plants capture chlorophyll.').relationRecords[0].grammarShape, 'ACTIVE_SIMPLE');
});

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

test('punctuation glyph spacing preserves one semantic boundary and drops empty fragments', () => {
  const equivalent = [
    ['Plants harness light energy.', 'Plants harness light energy!'],
    ['Plants harness light energy.', 'Plants harness light energy?'],
    ['Plants harness light energy?!', 'Plants harness light energy? !'],
    ['Plants harness light energy!?', 'Plants harness light energy! ?'],
    ['Plants harness light energy!!', 'Plants harness light energy! !'],
    ['Plants harness light energy??', 'Plants harness light energy? ?'],
    ['Plants harness light energy?! Light energy exists.', 'Plants harness light energy? ! Light energy exists.'],
  ];
  for (const [left, right] of equivalent) {
    const a = evaluatePhotosynthesisRelationsV2(left);
    const b = evaluatePhotosynthesisRelationsV2(right);
    assert.equal(normalizeInputV2(left), normalizeInputV2(right), `${left} <> ${right}`);
    assert.equal(a.hasMalformed, b.hasMalformed, `${left} <> ${right}`);
    assert.deepEqual(a.topology, b.topology, `${left} <> ${right}`);
    assert.deepEqual(a.relationRecords.map(({ grammarShape }) => grammarShape),
      b.relationRecords.map(({ grammarShape }) => grammarShape), `${left} <> ${right}`);
    assert.equal(semanticCaseFingerprint(left), semanticCaseFingerprint(right), `${left} <> ${right}`);
  }
  assert.deepEqual(segmentSentencesV2('Plants harness light energy? !').map(({ index }) => index), [0]);
  assert.deepEqual(segmentSentencesV2('!!! ? !'), []);
  assert.deepEqual(segmentClausesV2('Plants harness light energy; ; !!!').map(({ index }) => index), [0]);
  const semicolon = semanticCaseFingerprint('Plants capture light energy; algae absorb light energy.');
  const colon = semanticCaseFingerprint('Plants capture light energy: algae absorb light energy.');
  const sentence = semanticCaseFingerprint('Plants capture light energy. Algae absorb light energy.');
  assert.equal(semicolon, colon);
  assert.notEqual(semicolon, sentence);
});

test('unsupported subjects retain number without retaining their lexical spelling', () => {
  const equivalent = [
    ['Larvae capture light energy.', 'Tapirs capture light energy.'],
    ['The vertebrae do not capture light energy.', 'The fungi do not capture light energy.'],
    ['The corpora may capture light energy.', 'The genera may capture light energy.'],
    ['The lens does capture light energy.', 'The tapir does capture light energy.'],
    ['Formulae have captured light energy.', 'Alumni have captured light energy.'],
  ];
  for (const [left, right] of equivalent) {
    const a = evaluatePhotosynthesisRelationsV2(left);
    const b = evaluatePhotosynthesisRelationsV2(right);
    assert.equal(a.hasMalformed, false, left);
    assert.equal(b.hasMalformed, false, right);
    assert.equal(a.passed, false, left);
    assert.equal(b.passed, false, right);
    assert.equal(semanticCaseFingerprint(left), semanticCaseFingerprint(right), `${left} <> ${right}`);
  }
  for (const answer of [
    'Larvae does capture light energy.',
    'A vertebrae do capture light energy.',
    'A plants do capture light energy.',
    'The fungi does capture light energy.',
    'The lichens does capture light energy.',
  ]) {
    assert.equal(evaluatePhotosynthesisRelationsV2(answer).hasMalformed, true, answer);
  }
  assert.equal(evaluatePhotosynthesisRelationsV2('A lens captures light energy.').hasMalformed, false);
  assert.equal(evaluatePhotosynthesisRelationsV2('Lenses capture light energy.').hasMalformed, false);
});

test('a fresh noun set exercises productive and irregular plural rules', () => {
  const equivalent = [
    ['The wolf captures light energy.', 'The tomato captures light energy.'],
    ['The wolves do not capture light energy.', 'The tomatoes do not capture light energy.'],
    ['Wolves have captured light energy.', 'Tomatoes have captured light energy.'],
  ];
  for (const [left, right] of equivalent) {
    const a = evaluatePhotosynthesisRelationsV2(left);
    const b = evaluatePhotosynthesisRelationsV2(right);
    assert.equal(a.hasMalformed, false, left);
    assert.equal(b.hasMalformed, false, right);
    assert.equal(a.passed, b.passed, `${left} <> ${right}`);
    assert.equal(semanticCaseFingerprint(left), semanticCaseFingerprint(right), `${left} <> ${right}`);
  }
  for (const answer of [
    'The wolves does capture light energy.',
    'The tomatoes does capture light energy.',
    'A wolves do capture light energy.',
    'A tomatoes do capture light energy.',
  ]) {
    assert.equal(evaluatePhotosynthesisRelationsV2(answer).hasMalformed, true, answer);
  }
});

test('semicolon resets prior antecedents and permits a new local antecedent', () => {
  const crossBoundary = evaluatePhotosynthesisRelationsV2(
    'Photosynthesis harnesses light energy; but photosynthesis does not harness it.',
  );
  const crossBoundaryWithAnd = evaluatePhotosynthesisRelationsV2(
    'Photosynthesis harnesses light energy; and photosynthesis does not harness it.',
  );
  assert.equal(crossBoundary.contradictions.length, 0);
  assert.equal(crossBoundary.relationRecords.some((record) =>
    record.lightObject?.binding === 'PRONOUN_ANTECEDENT'), false);
  assert.equal(semanticCaseFingerprint(crossBoundary), semanticCaseFingerprint(crossBoundaryWithAnd));
  assert.equal(crossBoundaryWithAnd.relationRecords.some((record) =>
    record.lightObject?.binding === 'PRONOUN_ANTECEDENT'), false);

  for (const answer of [
    'Plants store light energy; photosynthesis harnesses light energy but photosynthesis does not harness it.',
    'Algae absorb light energy; plant stores light energy but plant does not store it.',
  ]) {
    const result = evaluatePhotosynthesisRelationsV2(answer);
    assert.equal(result.passed, false, answer);
    assert.equal(result.contradictions.length, 1, answer);
    assert.equal(result.relationRecords.at(-1)?.lightObject?.binding, 'PRONOUN_ANTECEDENT', answer);
  }
});

test('passive agents use active noun-phrase number and coordination validation', () => {
  for (const answer of [
    'Light energy is captured by a plant.',
    'Light energy is captured by plants.',
    'Light energy must be captured by plants.',
    'Light energy has been captured by a plant.',
  ]) {
    assert.equal(evaluatePhotosynthesisRelationsV2(answer).passed, true, answer);
  }
  for (const answer of [
    'Light energy is captured by a plants.',
    'Light energy is captured by an plants.',
    'Light energy is captured by a lichens.',
    'Light energy must be captured by an algae.',
    'Light energy has been captured by a basalts.',
    'Light energy is captured by and plants.',
  ]) {
    const result = evaluatePhotosynthesisRelationsV2(answer);
    assert.equal(result.passed, false, answer);
    assert.equal(result.relationRecords.some((record) => record.voice === 'PASSIVE' && record.qualifies), false, answer);
  }
});

test('explicit predicate continuations require complete object frames and consumed tails', () => {
  for (const answer of [
    'Plants capture light energy but plants do not store.',
    'Plants capture light energy but plants do not store it of near.',
    'Plants capture light energy but plants do not store it during photosynthesis of near.',
  ]) {
    const result = evaluatePhotosynthesisRelationsV2(answer);
    assert.equal(result.hasMalformed, true, answer);
    assert.equal(result.passed, false, answer);
  }
  for (const answer of [
    'Plants capture light energy but plants do not store light energy.',
    'Plants capture light energy but plants do not store it.',
    'Plants capture light energy but do not store it.',
    'Plants capture light energy but plants do not store it during photosynthesis.',
  ]) {
    assert.equal(evaluatePhotosynthesisRelationsV2(answer).hasMalformed, false, answer);
  }
});

test('optional comma does not control explicit-subject conjunction segmentation', () => {
  const pairs = [
    ['Plants capture light energy and algae absorb light energy.',
      'Plants capture light energy, and algae absorb light energy.'],
    ['Lichens capture light energy and basalts absorb light energy.',
      'Lichens capture light energy, and basalts absorb light energy.'],
    ['Plants capture light energy and algae do not absorb light energy.',
      'Plants capture light energy, and algae do not absorb light energy.'],
  ];
  for (const [left, right] of pairs) {
    const a = evaluatePhotosynthesisRelationsV2(left);
    const b = evaluatePhotosynthesisRelationsV2(right);
    assert.equal(a.passed, b.passed, `${left} <> ${right}`);
    assert.equal(a.hasMalformed, false, left);
    assert.equal(b.hasMalformed, false, right);
    assert.equal(a.relationRecords.length, 2, left);
    assert.equal(b.relationRecords.length, 2, right);
    assert.equal(semanticCaseFingerprint(left), semanticCaseFingerprint(right), `${left} <> ${right}`);
  }
  const sharedSubject = evaluatePhotosynthesisRelationsV2('Plants capture and store light energy.');
  assert.deepEqual(sharedSubject.relationRecords.map((record) => record.verbLemma), ['capture', 'store']);
  assert.equal(sharedSubject.relationRecords.every((record) => record.grammarShape === 'ACTIVE_COORDINATED_SHARED_OBJECT'), true);
  const threePropositions = evaluatePhotosynthesisRelationsV2(
    'Plants capture light energy and algae absorb light energy and green plants store light energy.',
  );
  assert.equal(threePropositions.passed, true);
  assert.equal(threePropositions.hasMalformed, false);
  assert.equal(threePropositions.relationRecords.length, 3);
});
