'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const current = require('./photosynthesis-relation-evaluator');

const SOURCE = readFileSync(join(__dirname, 'photosynthesis-relation-evaluator.js'), 'utf8').replace(/\r\n/g, '\n');

const replaceOnce = (source, needle, replacement, label) => {
  const first = source.indexOf(needle);
  assert.notEqual(first, -1, `mutation anchor vanished: ${label}`);
  assert.equal(source.indexOf(needle, first + needle.length), -1, `mutation anchor is not unique: ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
};

const loadMutant = (source) => {
  const module = { exports: {} };
  new Function('module', 'exports', source)(module, module.exports);
  return module.exports;
};

const V2_CASES = [
  ...require('./photosynthesis-relation-cases').canonicalCases,
  ...require('./photosynthesis-relation-cases').generatedV2Cases,
  ...require('./photosynthesis-relation-cases').b5SemanticSupplementCases,
];

const v2CaseFails = (item, evaluator) => {
  const result = evaluator(item.text);
  if ((result.passed ? 'PASS' : 'FAIL') !== item.expectedDecision) return true;
  if (item.expectedPolarity && result.polarity !== item.expectedPolarity) return true;
  const observed = [
    ...result.diagnostics,
    ...result.relationRecords.flatMap((record) => [
      record.grammarShape,
      record.subjectValidity,
      record.polarity,
      record.polarityReason,
      record.controlChain?.type,
      record.lightObject?.binding,
      ...record.rejectionReasons,
    ]),
  ].filter(Boolean);
  return (item.requiredDiagnostics || []).some((required) => !observed.some(
    (actual) => String(actual).toLowerCase().includes(required.toLowerCase()),
  ));
};

const assertMutationKilledAcrossClasses = (id, evaluator, thresholds) => {
  for (const [classId, minimum] of Object.entries(thresholds)) {
    const failures = V2_CASES.filter((item) => item.classIds?.includes(classId)
      && v2CaseFails(item, evaluator)).length;
    assert.ok(failures >= minimum, `${id} ${classId}: ${failures}/${minimum} frozen cases killed`);
  }
};

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
