'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const current = require('./photosynthesis-relation-evaluator');
const {
  malformedCases: coordinationTopologyCases,
  boundaryCases: coordinationBoundaryCases,
} = require('./photosynthesis-coordination-topology-cases');

const SOURCE = readFileSync(join(__dirname, 'photosynthesis-relation-evaluator.js'), 'utf8').replace(/\r\n/g, '\n');

const replaceOnce = (source, needle, replacement, label) => {
  const first = source.indexOf(needle);
  assert.notEqual(first, -1, `mutation anchor vanished: ${label}`);
  assert.equal(source.indexOf(needle, first + needle.length), -1, `mutation anchor is not unique: ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
};

const loadMutant = (source) => {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(require, module, module.exports);
  return module.exports;
};

const V2_CASES = [
  ...require('./photosynthesis-relation-cases').canonicalCases,
  ...require('./photosynthesis-relation-cases').generatedV2Cases,
  ...require('./photosynthesis-relation-cases').b5SemanticSupplementCases,
];

const v2CaseFails = (item, evaluator) => {
  try {
    const result = evaluator(item.text);
    return (result.passed ? 'PASS' : 'FAIL') !== item.expectedDecision
      || Boolean(item.expectedPolarity && result.polarity !== item.expectedPolarity);
  } catch {
    return true;
  }
};

const assertMutationKilledAcrossClasses = (id, evaluator, thresholds) => {
  const baselineFailures = V2_CASES.filter((item) => v2CaseFails(item, current.evaluatePhotosynthesisRelationsV2));
  assert.deepEqual(baselineFailures.map((item) => item.id), [], `${id}: baseline must satisfy every frozen decision/polarity`);
  for (const [classId, minimum] of Object.entries(thresholds)) {
    const failures = V2_CASES.filter((item) => item.classIds?.includes(classId)
      && !v2CaseFails(item, current.evaluatePhotosynthesisRelationsV2)
      && v2CaseFails(item, evaluator)).length;
    assert.ok(failures >= minimum, `${id} ${classId}: ${failures}/${minimum} frozen cases killed`);
  }
};

test('M1-M10 runner requires a green semantic baseline and counts only new frozen-behavior failures', () => {
  const runnerPath = join(__dirname, '..', 'scripts', 'run-photosynthesis-relation-mutations.mjs');
  const result = JSON.parse(execFileSync(process.execPath, [runnerPath], { encoding: 'utf8' }));
  assert.equal(result.oracle, 'explicit-frozen-semantics-baseline-differential-v1');
  assert.equal(result.cases, 206);
  assert.equal(result.baseline.passed, 206);
  assert.equal(result.baseline.failed, 0);
  assert.equal(result.mutations.length, 10);
  assert.ok(result.mutations.every((mutation) => mutation.killed));
  assert.equal(result.killed, 10);
});

test('M1: removing normalization is killed by compatibility-form input', () => {
  const answer = 'Ｐｈｏｔｏｓｙｎｔｈｅｓｉｓ uses chlorophyll to capture light energy.';
  assert.equal(current.evaluatePhotosynthesisRelations(answer).passed, true);
  const mutant = loadMutant(replaceOnce(
    SOURCE,
    ".normalize('NFKC')",
    ".normalize('NFD')",
    'M1 normalization',
  ));
  assert.equal(mutant.evaluatePhotosynthesisRelations(answer).passed, false);
});

test('M2: removing sentence segmentation is killed by a cross-sentence decoy', () => {
  const answer = 'Photosynthesis converts light energy into sugar. Chlorophyll is a pigment found in plants.';
  assert.equal(current.evaluatePhotosynthesisRelations(answer).passed, false);
  const mutant = loadMutant(replaceOnce(
    SOURCE,
    'const sentences = segmentSentences(normalized);',
    'const sentences = [{ index: 0, text: normalized }];',
    'M2 sentence segmentation',
  ));
  assert.equal(mutant.evaluatePhotosynthesisRelations(answer).passed, true);
});

test('M3: removing clause segmentation is killed by a clause-local decoy', () => {
  const answer = 'Photosynthesis converts light energy, but chlorophyll is a pigment found in plants.';
  assert.equal(current.evaluatePhotosynthesisRelations(answer).passed, false);
  const mutant = loadMutant(replaceOnce(
    SOURCE,
    'const clauses = segmentClauses(sentence.text);',
    'const clauses = [{ index: 0, text: sentence.text }];',
    'M3 clause segmentation',
  ));
  assert.equal(mutant.evaluatePhotosynthesisRelations(answer).passed, true);
});

test('M4: accepting an unsupported subject is killed by the entity control', () => {
  const answer = 'Bacteria use chlorophyll to capture light energy during photosynthesis.';
  assert.equal(current.evaluatePhotosynthesisRelations(answer).passed, false);
  const mutant = loadMutant(replaceOnce(
    SOURCE,
    'if (unsupportedSubject) return unsupportedSubject;',
    "if (unsupportedSubject) return { value: 'plant', sourceIndex: unsupportedSubject.sourceIndex };",
    'M4 subject binding',
  ));
  assert.equal(mutant.evaluatePhotosynthesisRelations(answer).passed, true);
});

test('M5: inventing an unbound light object is killed by missing-object control', () => {
  const answer = 'Photosynthesis uses chlorophyll during photosynthesis.';
  assert.equal(current.evaluatePhotosynthesisRelations(answer).passed, false);
  const mutant = loadMutant(replaceOnce(
    SOURCE,
    'if (!candidates.length) return null;',
    "if (!candidates.length) return { start: predicateIndex, end: predicateIndex + 1, value: 'light-energy' };",
    'M5 light-energy object binding',
  ));
  assert.equal(mutant.evaluatePhotosynthesisRelations(answer).passed, true);
});

test('M6: removing relation-local polarity is killed by a negated relation', () => {
  const answer = 'Photosynthesis does not use chlorophyll to capture light energy.';
  assert.equal(current.evaluatePhotosynthesisRelations(answer).passed, false);
  const mutant = loadMutant(replaceOnce(
    SOURCE,
    "if (NEGATION_LEMMAS.has(tokens[index].lemma)) return 'negative';",
    "if (NEGATION_LEMMAS.has(tokens[index].lemma)) return 'positive';",
    'M6 relation-local polarity',
  ));
  assert.equal(mutant.evaluatePhotosynthesisRelations(answer).passed, true);
});

test('M7: removing continuation resolution is killed by the approved pronoun form', () => {
  const answer = 'Photosynthesis converts light energy into sugar. It is driven by chlorophyll.';
  assert.equal(current.evaluatePhotosynthesisRelations(answer).passed, true);
  const mutant = loadMutant(replaceOnce(
    SOURCE,
    "if (next.subject === 'continuation') {",
    'if (false) {',
    'M7 continuation resolution',
  ));
  assert.equal(mutant.evaluatePhotosynthesisRelations(answer).passed, false);
});

test('M8: accepting unsupported subjects is killed across invalid-subject classes', () => {
  const source = replaceOnce(
    SOURCE,
    'valid:V2_SUBJECTS.has(surface)',
    'valid:true',
    'M8 unsupported subject acceptance',
  );
  const mutant = loadMutant(source).evaluatePhotosynthesisRelationsV2;
  assertMutationKilledAcrossClasses('M8', mutant, {
    COORDINATED_SUBJECTS_MIXED_INVALID: 4,
    INVALID_SUBJECT: 4,
  });
});

test('M9: accepting arbitrary direct objects as light is killed across object controls', () => {
  let source = replaceOnce(
    SOURCE,
    "let end=i+1,light=['light','sunlight'].includes(ts[i].form);",
    'let end=i+1,light=true;',
    'M9 direct-object role',
  );
  source = replaceOnce(
    source,
    '&& validateActiveTailV2(tokens, object.tokenEnd, pronoun, subjectSet, object);',
    '&& true;',
    'M9 unrestricted object tail',
  );
  const mutant = loadMutant(source).evaluatePhotosynthesisRelationsV2;
  assertMutationKilledAcrossClasses('M9', mutant, {
    DETACHED_OBJECT_DECOYS: 4,
    INVALID_OBJECT: 4,
  });
});

test('M10: suppressing all positive qualification is killed across positive classes', () => {
  const source = replaceOnce(
    SOURCE,
    "qualifies: valid && light && allowed && !destructive && !barrier\n          && !coordinatedPredicates.invalid && polarity === 'AFFIRMED',",
    'qualifies: false,',
    'M10 positive relation qualification',
  );
  const mutant = loadMutant(source).evaluatePhotosynthesisRelationsV2;
  assertMutationKilledAcrossClasses('M10', mutant, {
    AFFIRMATIVE_ACTIVE: 2,
    KNOWN_REGRESSIONS: 2,
  });
});

test('root invariant 001 mutation: dropping boundary-independent frame marking restores the pass leak', () => {
  const mutant = loadMutant(replaceOnce(
    SOURCE,
    'if (explicitContinuation || explicitTargetFrame) malformedExplicitContinuation = true;',
    'if (explicitContinuation) malformedExplicitContinuation = true;',
    'target-frame completeness independent of boundary',
  ));
  const probes = [
    'Plants capture light energy. Algae do not store.',
    'Plants capture light energy; Algae do not store.',
    'Plants capture light energy! Algae do not store.',
    'Plants capture light energy? Algae do not store.',
    'Plants capture light energy. Quokkas do not store.',
  ];
  for (const input of probes) {
    assert.equal(current.evaluatePhotosynthesisRelationsV2(input).passed, false, input);
    assert.equal(mutant.evaluatePhotosynthesisRelationsV2(input).passed, true, input);
  }
});

test('root invariant 002 mutation: removing productive louse/lice morphology reverses agreement', () => {
  const mutant = loadMutant(replaceOnce(
    SOURCE,
    "if (/louse$/i.test(word)) number = 'SINGULAR';\n  else if (word === 'lice' || (word.length >= 7 && /lice$/i.test(word))) number = 'PLURAL';\n  else if (/ae$/i.test(word) || /ora$/i.test(word)) number = 'PLURAL';",
    "if (/ae$/i.test(word) || /ora$/i.test(word)) number = 'PLURAL';",
    'productive compound louse/lice morphology',
  ));
  const correct = 'Booklice do capture light energy.';
  const incorrect = 'Booklice does capture light energy.';
  assert.equal(current.evaluatePhotosynthesisRelationsV2(correct).hasMalformed, false);
  assert.equal(current.evaluatePhotosynthesisRelationsV2(incorrect).hasMalformed, true);
  assert.equal(mutant.evaluatePhotosynthesisRelationsV2(correct).hasMalformed, true);
  assert.equal(mutant.evaluatePhotosynthesisRelationsV2(incorrect).hasMalformed, false);
});

test('root invariant 003 mutation: skipping member-head validation accepts a determiner-only tail', () => {
  const mutant = loadMutant(replaceOnce(
    SOURCE,
    '&&memberShapes.every(Boolean);',
    ';',
    'shared coordinated-member noun-head validation',
  ));
  const active = 'Plants capture light energy but algae and the absorb sunlight.';
  const passive = 'Light energy is absorbed by algae and the during photosynthesis.';
  for (const input of [active, passive]) {
    assert.equal(current.evaluatePhotosynthesisRelationsV2(input).hasMalformed, true, input);
    assert.equal(mutant.evaluatePhotosynthesisRelationsV2(input).hasMalformed, false, input);
  }
});

test('root invariant 005 mutation: destructive optional-comma normalization erases empty members', () => {
  const mutant = loadMutant(replaceOnce(
    SOURCE,
    ".replace(/,\\s*(?=(?:and|but)\\b)/g, (comma, offset, input) => /,\\s*$/.test(input.slice(0, offset)) ? comma : ' ')",
    ".replace(/,\\s*(?=(?:and|but)\\b)/g, ' ')",
    'preservation of empty coordinated-member topology',
  ));
  const subjects = [
    'plants, , and algae',
    'narwhals, , and plants',
    'plants, , and quokkas, green plants',
    'plants, algae, , and wombats',
  ];
  let violations = 0;
  for (const subject of subjects) {
    for (const input of [
      `${subject} absorb sunlight.`,
      `Sunlight is absorbed by ${subject} during photosynthesis.`,
    ]) {
      assert.equal(current.evaluatePhotosynthesisRelationsV2(input).hasMalformed, true, input);
      assert.equal(current.evaluatePhotosynthesisRelationsV2(input).passed, false, input);
      const result = mutant.evaluatePhotosynthesisRelationsV2(input);
      if (!result.hasMalformed || result.passed) violations += 1;
    }
  }
  assert.equal(violations, 8);
});

test('root invariant 006 mutation: preprocessing before raw topology validation salvages malformed frames', () => {
  const mutant = loadMutant(replaceOnce(
    SOURCE,
    'const rawMalformedCoordination=analyzePreNormalizationCoordinationV2(input);',
    'const rawMalformedCoordination=[];',
    'pre-normalization coordination topology annotation',
  ));
  const attacks = [...coordinationTopologyCases, ...coordinationBoundaryCases];
  let violations = 0;
  for (const { input } of attacks) {
    const expected = current.evaluatePhotosynthesisRelationsV2(input);
    assert.equal(expected.hasMalformed, true, input);
    assert.equal(expected.passed, false, input);
    const result = mutant.evaluatePhotosynthesisRelationsV2(input);
    if (!result.hasMalformed || result.passed) violations += 1;
  }
  assert.ok(violations >= 100, `destructive preprocessing mutant violations=${violations}`);
});

test('root invariant 004 mutation: recording a terminal boundary leaks punctuation into fingerprints', () => {
  const mutant = loadMutant(replaceOnce(
    SOURCE,
    'if(boundary&&!hasContentV2(text.slice(token.end)))continue;',
    '',
    'terminal punctuation projection',
  ));
  const withPeriod = 'Photosynthesis light energy capture chlorophyll.';
  const withoutPeriod = withPeriod.slice(0, -1);
  assert.equal(current.semanticCaseFingerprint(withPeriod), current.semanticCaseFingerprint(withoutPeriod));
  assert.notEqual(mutant.semanticCaseFingerprint(withPeriod), mutant.semanticCaseFingerprint(withoutPeriod));
});
