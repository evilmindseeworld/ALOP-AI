'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluatePhotosynthesisRelationsV2: evaluate,
  normalizeInputV2,
  segmentSentencesV2,
  segmentClausesV2,
  semanticCaseFingerprint,
} = require('./photosynthesis-relation-evaluator');

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
    const a = evaluate(left);
    const b = evaluate(right);
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
    const a = evaluate(left);
    const b = evaluate(right);
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
    assert.equal(evaluate(answer).hasMalformed, true, answer);
  }
  assert.equal(evaluate('A lens captures light energy.').hasMalformed, false);
  assert.equal(evaluate('Lenses capture light energy.').hasMalformed, false);
});

test('a fresh noun set exercises productive and irregular plural rules', () => {
  const equivalent = [
    ['The wolf captures light energy.', 'The tomato captures light energy.'],
    ['The wolves do not capture light energy.', 'The tomatoes do not capture light energy.'],
    ['Wolves have captured light energy.', 'Tomatoes have captured light energy.'],
  ];
  for (const [left, right] of equivalent) {
    const a = evaluate(left);
    const b = evaluate(right);
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
    assert.equal(evaluate(answer).hasMalformed, true, answer);
  }
});

test('semicolon resets prior antecedents and permits a new local antecedent', () => {
  const crossBoundary = evaluate(
    'Photosynthesis harnesses light energy; but photosynthesis does not harness it.',
  );
  const crossBoundaryWithAnd = evaluate(
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
    const result = evaluate(answer);
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
    assert.equal(evaluate(answer).passed, true, answer);
  }
  for (const answer of [
    'Light energy is captured by a plants.',
    'Light energy is captured by an plants.',
    'Light energy is captured by a lichens.',
    'Light energy must be captured by an algae.',
    'Light energy has been captured by a basalts.',
    'Light energy is captured by and plants.',
  ]) {
    const result = evaluate(answer);
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
    const result = evaluate(answer);
    assert.equal(result.hasMalformed, true, answer);
    assert.equal(result.passed, false, answer);
  }
  for (const answer of [
    'Plants capture light energy but plants do not store light energy.',
    'Plants capture light energy but plants do not store it.',
    'Plants capture light energy but do not store it.',
    'Plants capture light energy but plants do not store it during photosynthesis.',
  ]) {
    assert.equal(evaluate(answer).hasMalformed, false, answer);
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
    const a = evaluate(left);
    const b = evaluate(right);
    assert.equal(a.passed, b.passed, `${left} <> ${right}`);
    assert.equal(a.hasMalformed, false, left);
    assert.equal(b.hasMalformed, false, right);
    assert.equal(a.relationRecords.length, 2, left);
    assert.equal(b.relationRecords.length, 2, right);
    assert.equal(semanticCaseFingerprint(left), semanticCaseFingerprint(right), `${left} <> ${right}`);
  }
  const sharedSubject = evaluate('Plants capture and store light energy.');
  assert.deepEqual(sharedSubject.relationRecords.map((record) => record.verbLemma), ['capture', 'store']);
  assert.equal(sharedSubject.relationRecords.every((record) => record.grammarShape === 'ACTIVE_COORDINATED_SHARED_OBJECT'), true);
  const threePropositions = evaluate(
    'Plants capture light energy and algae absorb light energy and green plants store light energy.',
  );
  assert.equal(threePropositions.passed, true);
  assert.equal(threePropositions.hasMalformed, false);
  assert.equal(threePropositions.relationRecords.length, 3);
});
