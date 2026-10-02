'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
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
    'if (explicitContinuation || explicitTargetFrame) frame.malformedExplicitContinuation = true;',
    'if (explicitContinuation) frame.malformedExplicitContinuation = true;',
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

test('root invariant 005 mutation: restoring normalization-first order erases empty members', () => {
  const commaNormalizationMutation = replaceOnce(
    SOURCE,
    ".replace(/,\\s*(?=(?:and|but)\\b)/g, (comma, offset, input) => /,\\s*$/.test(input.slice(0, offset)) ? comma : ' ')",
    ".replace(/,\\s*(?=(?:and|but)\\b)/g, ' ')",
    'preservation of empty coordinated-member topology',
  );
  const mutant = loadMutant(replaceOnce(
    commaNormalizationMutation,
    'frame.rawStructuralAnalysis = analyzePreNormalizationCoordinationV2(frame);',
    'frame.rawStructuralAnalysis = [];',
    'previous normalization-first ordering',
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

test('five-root closure mutations are killed by the bounded regression controls', async (t) => {
  await t.test('R1 raw topology cannot depend on subject ending at the predicate', () => {
    const mutant = loadMutant(replaceOnce(
      SOURCE,
      'if(!isTargetRelationFrameV2(tokens,predicateIndex))continue;',
      'if(subject.end!==predicateIndex||!isTargetRelationFrameV2(tokens,predicateIndex))continue;',
      'R1 predicate-adjacent subject gate',
    )).evaluatePhotosynthesisRelationsV2;
    const answer = ', and plants and algae must absorb sunlight';
    const currentResult = current.evaluatePhotosynthesisRelationsV2(answer);
    const mutantResult = mutant(answer);
    assert.equal(currentResult.coordinationTopology.some((group) => group.shapeValid === false), true);
    assert.equal(mutantResult.coordinationTopology.some((group) => group.shapeValid === false), false);
  });

  await t.test('R2 normalized clause re-segmentation cannot merge raw sibling ownership', () => {
    const mutant = loadMutant(replaceOnce(
      SOURCE,
      'for (const clause of segmentClausesV2(sentence)) {',
      "for (const clause of [{ text: sentence.text, index: 0, boundaryBefore: 'start', discourseConjunction: null }]) {",
      'R2 normalized sibling merge',
    )).evaluatePhotosynthesisRelationsV2;
    const answer = 'Plants use chlorophyll to absorb sunlight and algae absorb sunlight';
    assert.equal(current.evaluatePhotosynthesisRelationsV2(answer).topology.length, 2);
    assert.equal(mutant(answer).topology.length, 1);
  });

  await t.test('R3 truncating local support resolution loses later frames', () => {
    const mutant = loadMutant(replaceOnce(SOURCE, 'return supports;', 'return supports.slice(0, 1);',
      'R3 first-support truncation')).evaluatePhotosynthesisRelationsV2;
    const answer = 'Plants use chlorophyll to absorb sunlight; algae use chlorophyll to absorb sunlight';
    const supportCount = (run) => run(answer).relationRecords.filter((record) => record.relationType === 'CHLOROPHYLL_SUPPORT').length;
    assert.equal(supportCount(current.evaluatePhotosynthesisRelationsV2), 2);
    assert.equal(supportCount(mutant), 1);
  });

  await t.test('R4 assigning every record to every frame loses mediation ownership', () => {
    const mutant = loadMutant(replaceOnce(
      SOURCE,
      'records:relationRecords.filter((record)=>record[V2_FRAME_OWNER]===frame.frameId),',
      "records:relationRecords.toSorted((left,right)=>Number(left.relationType==='CHLOROPHYLL_SUPPORT')-Number(right.relationType==='CHLOROPHYLL_SUPPORT')) ,",
      'R4 collapsed frame record ownership',
    )).semanticCaseFingerprint;
    const first = 'Plants use chlorophyll to absorb sunlight; algae absorb sunlight';
    const second = 'Plants absorb sunlight; algae use chlorophyll to absorb sunlight';
    assert.notEqual(current.semanticCaseFingerprint(first), current.semanticCaseFingerprint(second));
    assert.equal(mutant(first), mutant(second));
  });

  await t.test('R5 replacing shared morphology with a use-specific past rule changes BASE', () => {
    const mutant = loadMutant(replaceOnce(
      SOURCE,
      "const form=surface===lemma?'BASE':/ed$/.test(surface)?'PAST':/ing$/.test(surface)?'PRESENT_PARTICIPLE':'PRESENT_3SG';",
      "const form=surface==='use'?'PAST':surface===lemma?'BASE':/ed$/.test(surface)?'PAST':/ing$/.test(surface)?'PRESENT_PARTICIPLE':'PRESENT_3SG';",
      'R5 ad hoc mediator morphology',
    )).evaluatePhotosynthesisRelationsV2;
    const answer = 'Plants use chlorophyll to absorb sunlight';
    const supportForm = (run) => run(answer).relationRecords
      .find((record) => record.relationType === 'CHLOROPHYLL_SUPPORT')?.verbForm;
    assert.equal(supportForm(current.evaluatePhotosynthesisRelationsV2), 'BASE');
    assert.equal(supportForm(mutant), 'PAST');
  });
});


// Frame lifecycle architecture mutations A-E.
(function frameLifecycleMutationSuite() {
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const current = require('./photosynthesis-relation-evaluator').evaluatePhotosynthesisRelationsV2;

const SOURCE = readFileSync(join(__dirname, 'photosynthesis-relation-evaluator.js'), 'utf8').replace(/\r\n/g, '\n');
const validSubjects = ['plants', 'plants and algae', 'green plants and algae', 'plants, algae, and green plants'];
const freshNouns = ['maples', 'cedars', 'willows', 'orchids', 'cattails', 'reeds'];
const boundaries = ['; ', '. ', '. And ', '. But '];

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  assert.notEqual(first, -1, label + ': anchor missing');
  assert.equal(source.indexOf(needle, first + needle.length), -1, label + ': anchor duplicated');
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function loadMutant(source) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(require, module, module.exports);
  return module.exports.evaluatePhotosynthesisRelationsV2;
}

function makeFrame(kind, voice, predicate, noun, shape, subjectIndex) {
  const forms = predicate === 'absorb'
    ? { active: 'absorb sunlight', object: 'Sunlight', past: 'absorbed' }
    : { active: 'capture light energy', object: 'Light energy', past: 'captured' };
  if (kind === 'valid') {
    const subject = validSubjects[subjectIndex % validSubjects.length];
    return voice === 'ACTIVE'
      ? subject + ' ' + forms.active
      : forms.object + ' is ' + forms.past + ' by ' + subject + ' during photosynthesis';
  }
  const subject = shape === 'initial' ? ', and plants and ' + noun
    : shape === 'middle' ? 'plants, , and ' + noun
      : shape === 'final' ? 'plants and ' + noun + ', ,' : 'plants and the';
  return voice === 'ACTIVE'
    ? subject + ' ' + forms.active
    : forms.object + ' is ' + forms.past + ' by ' + subject + ' during photosynthesis';
}

function recordSignature(record) {
  return {
    qualifies: record.qualifies,
    rejectionReasons: record.rejectionReasons,
    grammarShape: record.grammarShape,
    voice: record.voice,
    verbLemma: record.verbLemma,
    subjectValidity: record.subjectValidity,
    subjectSet: record.subjectSet && [
      record.subjectSet.lemma,
      record.subjectSet.role,
      record.subjectSet.valid,
      record.subjectSet.validityReason,
    ],
    directObject: record.directObject && [record.directObject.role, record.directObject.normalized],
    lightObject: record.lightObject && [record.lightObject.role, record.lightObject.normalized],
    polarity: record.polarity,
  };
}

function topologySignature(group) {
  return {
    type: group.type,
    cardinality: group.cardinality,
    orderedMembers: group.orderedMembers,
    shapeValid: group.shapeValid,
    rawMembers: group.rawMembers,
  };
}

function addFailure(rows, caseId, property) {
  rows.push({ caseId, property });
}

function checkComposition(evaluator, frames, joins, caseId, rows) {
  try {
    const singles = frames.map((frame) => evaluator(frame));
    let input = frames[0];
    for (let index = 1; index < frames.length; index += 1) input += joins[index - 1] + frames[index];
    const composed = evaluator(input);
    const malformed = singles.some((result) => result.hasMalformed);

    if (composed.hasMalformed !== malformed) addFailure(rows, caseId, 'document.hasMalformed');
    if (composed.passed !== (!malformed && singles.some((result) => result.passed))) {
      addFailure(rows, caseId, 'document.passed');
    }
    const expectedCount = singles.reduce((count, result) => count + result.relationRecords.length, 0);
    if (composed.relationRecords.length !== expectedCount) {
      addFailure(rows, caseId, 'relation.record-count');
    } else {
      let offset = 0;
      for (let index = 0; index < singles.length; index += 1) {
        const expected = singles[index].relationRecords.map(recordSignature);
        const actual = composed.relationRecords.slice(offset, offset + expected.length).map(recordSignature);
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          addFailure(rows, caseId, 'relation.frame-' + index);
        }
        offset += expected.length;
      }
    }
    const expectedTopology = singles.flatMap((result) => result.coordinationTopology.map(topologySignature));
    if (JSON.stringify(composed.coordinationTopology.map(topologySignature)) !== JSON.stringify(expectedTopology)) {
      addFailure(rows, caseId, 'topology.frame-order-and-ownership');
    }
  } catch (error) {
    addFailure(rows, caseId, 'exception:' + error.name);
  }
}

function mutationCases() {
  const result = [];
  const states = [['valid', 'malformed'], ['malformed', 'valid']];
  const voicePairs = [['ACTIVE', 'ACTIVE'], ['PASSIVE', 'ACTIVE'], ['ACTIVE', 'PASSIVE'], ['PASSIVE', 'PASSIVE']];
  const predicatePairs = [['absorb', 'absorb'], ['absorb', 'capture']];
  const shapes = ['initial', 'middle', 'final', 'determiner'];
  for (let stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
    for (let boundaryIndex = 0; boundaryIndex < boundaries.length; boundaryIndex += 1) {
      for (let voiceIndex = 0; voiceIndex < voicePairs.length; voiceIndex += 1) {
        for (let predicateIndex = 0; predicateIndex < predicatePairs.length; predicateIndex += 1) {
          for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex += 1) {
            const index = result.length;
            result.push({
              frames: [
                makeFrame(states[stateIndex][0], voicePairs[voiceIndex][0], predicatePairs[predicateIndex][0],
                  freshNouns[index % freshNouns.length], shapes[shapeIndex], index),
                makeFrame(states[stateIndex][1], voicePairs[voiceIndex][1], predicatePairs[predicateIndex][1],
                  freshNouns[(index + 2) % freshNouns.length], shapes[shapeIndex], index + 1),
              ],
              joins: [boundaries[boundaryIndex]],
              id: 'matrix-' + index,
            });
          }
        }
      }
    }
  }
  for (let index = 0; index < validSubjects.length; index += 1) {
    const frame = makeFrame('valid', 'ACTIVE', 'absorb', 'maples', 'middle', index);
    result.push({ frames: [frame, frame], joins: ['; '], id: 'duplicate-' + index });
  }
  return result;
}

const cases = mutationCases();

function assertMutationKilled(id, mutant) {
  const failures = [];
  for (const item of cases) checkComposition(mutant, item.frames, item.joins, item.id, failures);
  const affectedCases = new Set(failures.map((failure) => failure.caseId));
  const properties = new Set(failures.map((failure) => failure.property));
  assert.ok(failures.length >= 2, id + ': failures=' + JSON.stringify(failures.slice(0, 8)));
  assert.ok(affectedCases.size >= 2, id + ': affected cases=' + affectedCases.size);
  return { failureCount: failures.length, affectedCases: affectedCases.size, properties: [...properties] };
}

test('MUT-A broadcasts one malformed frame to every relation record', (t) => {
  const mutant = loadMutant(replaceOnce(
    SOURCE,
    '    if (!frames[record.frameId]?.malformedReasons.size) continue;',
    '    if (!hasMalformed) continue;',
    'MUT-A broadcast',
  ));
  const result = assertMutationKilled('MUT-A', mutant);
  t.diagnostic('MUT-A attributable failures: ' + result.failureCount + ' across ' + result.affectedCases + ' cases; properties=' + result.properties.join(','));
  assert.ok(result.properties.some((property) => property.startsWith('relation.frame-')));
});

test('MUT-B removes frame identity from malformed topology replacement', (t) => {
  const mutant = loadMutant(replaceOnce(
    SOURCE,
    '    frame.rawStructuralAnalysis.length\n      ? frame.rawStructuralAnalysis.map((finding) => ({',
    '    frames.some((owner) => owner.rawStructuralAnalysis.length)\n      ? frame.rawStructuralAnalysis.map((finding) => ({',
    'MUT-B topology ownership',
  ));
  const result = assertMutationKilled('MUT-B', mutant);
  t.diagnostic('MUT-B attributable failures: ' + result.failureCount + ' across ' + result.affectedCases + ' cases; properties=' + result.properties.join(','));
  assert.ok(result.properties.includes('topology.frame-order-and-ownership'));
});

test('MUT-C attaches raw malformed state to the next sibling', (t) => {
  const mutant = loadMutant(replaceOnce(
    SOURCE,
    '    frame.rawStructuralAnalysis = analyzePreNormalizationCoordinationV2(frame);',
    '    frame.rawStructuralAnalysis = analyzePreNormalizationCoordinationV2(frames[frame.frameOrdinal - 1] || frame);',
    'MUT-C raw attachment',
  ));
  const result = assertMutationKilled('MUT-C', mutant);
  t.diagnostic('MUT-C attributable failures: ' + result.failureCount + ' across ' + result.affectedCases + ' cases; properties=' + result.properties.join(','));
  assert.ok(result.properties.some((property) => property.startsWith('document.')));
});

test('MUT-D uses sentence, voice, and predicate tuple as topology identity', (t) => {
  const mutant = loadMutant(replaceOnce(
    SOURCE,
    '  const reportedCoordinationTopology = ownedCoordinationTopologies;',
    '  const seenCoarseKeys = new Set();\n'
      + '  const reportedCoordinationTopology = ownedCoordinationTopologies.filter((group) => {\n'
      + '    const key = String(group.sentenceIndex) + "|" + group.voice + "|" + group.predicateLemma;\n'
      + '    if (seenCoarseKeys.has(key)) return false;\n'
      + '    seenCoarseKeys.add(key);\n'
      + '    return true;\n'
      + '  });',
    'MUT-D coarse topology identity',
  ));
  const result = assertMutationKilled('MUT-D', mutant);
  t.diagnostic('MUT-D attributable failures: ' + result.failureCount + ' across ' + result.affectedCases + ' cases; properties=' + result.properties.join(','));
  assert.ok(result.properties.includes('topology.frame-order-and-ownership'));
});

test('MUT-E merges semantically identical sibling topology groups', (t) => {
  const mutant = loadMutant(replaceOnce(
    SOURCE,
    '  const reportedCoordinationTopology = ownedCoordinationTopologies;',
    '  const seenTopologyShapes = new Set();\n'
      + '  const reportedCoordinationTopology = ownedCoordinationTopologies.filter((group) => {\n'
      + '    const key = JSON.stringify([group.type, group.cardinality, group.orderedMembers, group.shapeValid, group.rawMembers]);\n'
      + '    if (seenTopologyShapes.has(key)) return false;\n'
      + '    seenTopologyShapes.add(key);\n'
      + '    return true;\n'
      + '  });',
    'MUT-E duplicate topology merge',
  ));
  const result = assertMutationKilled('MUT-E', mutant);
  t.diagnostic('MUT-E attributable failures: ' + result.failureCount + ' across ' + result.affectedCases + ' cases; properties=' + result.properties.join(','));
  assert.ok(result.properties.includes('topology.frame-order-and-ownership'));
});
})();

// Independent seeded P1 boundary/passive closure holdout and in-memory mutants.
(function boundaryPassiveClosureHoldoutSuite() {
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { join } = require('node:path');
const { dirname } = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  evaluatePhotosynthesisRelationsV2,
  semanticCaseFingerprint,
} = require('./photosynthesis-relation-evaluator');

// This holdout has a separate seed and generative matrix from the exact blocker
// regressions. Subjects, context tails, boundary shapes, and their compositions
// are selected before evaluation; no outcome is used to generate an oracle.
const HOLDOUT_SEED = 0xB0A7C10F;
const REQUIRED_CASES = 500;
const REQUIRED_STRUCTURAL_KEYS = 400;
const SUBJECTS = [
  'green plants', 'plants', 'algae', 'photosynthetic bacteria',
  'some bacteria', 'plant', 'alga', 'photosynthetic bacterium',
];
const CONTEXTS = ['during photosynthesis', 'in photosynthesis', 'for photosynthesis'];
const EXACT_ROWS_EXCLUDED = new Set([
  'Green plants store solar light but algae use chlorophyll to transform sunlight but photosynthetic bacteria transform sunlight',
  'Green plants store solar light but algae transform sunlight but photosynthetic bacteria use chlorophyll to transform sunlight',
  'Solar light is stored by green plants and algae during photosynthesis and photosynthetic bacteria transform sunlight',
  'Solar light is stored by green plants, but algae transform sunlight',
  'Solar light is stored by green plants in photosynthesis',
  'Solar light is stored by green plants for photosynthesis',
  'Solar light is stored by green plants and algae for photosynthesis and photosynthetic bacteria transform sunlight',
  'Plants and algae absorb sunlight; plants, , and algae absorb sunlight.',
  'Plants, , and algae absorb sunlight. And plants and algae absorb sunlight.',
]);

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function mutateExactlyOnce(source, mutantId, anchor, replacement) {
  const occurrences = source.split(anchor).length - 1;
  assert.equal(occurrences, 1, `${mutantId} source anchor count`);
  return source.replace(anchor, replacement);
}

function compileEvaluatorMutant(mutantId, transform) {
  const evaluatorPath = require.resolve('./photosynthesis-relation-evaluator');
  const source = fs.readFileSync(evaluatorPath, 'utf8');
  const mutatedSource = transform(source);
  assert.notEqual(mutatedSource, source, `${mutantId} must change exactly one production expression`);
  const mutantModule = new Module(`${evaluatorPath}#${mutantId}`, module);
  mutantModule.filename = evaluatorPath;
  mutantModule.paths = Module._nodeModulePaths(dirname(evaluatorPath));
  mutantModule._compile(mutatedSource, evaluatorPath);
  return mutantModule.exports;
}

function summarizeMutationOutput(result) {
  return {
    passed: result.passed,
    hasMalformed: result.hasMalformed,
    topology: result.topology,
    records: result.relationRecords.map((record) => ({
      subject: record.subjectSet?.lemma || null,
      voice: record.voice || null,
      qualifies: record.qualifies,
      relationType: record.relationType,
      context: record.processContext || null,
      evidence: record.evidenceSpan?.text || null,
    })),
    groups: result.coordinationTopology.map((group) => ({
      rawMembers: group.rawMembers,
      orderedMembers: group.orderedMembers,
      shapeValid: group.shapeValid,
      cardinality: group.cardinality,
    })),
  };
}

function assertMutantKilled(mutantId, input, mutantEvaluator, oracleName, oracle) {
  const result = mutantEvaluator.evaluatePhotosynthesisRelationsV2(input);
  let failure;
  try {
    oracle(result);
  } catch (error) {
    failure = error;
  }
  const assertionFailed = failure && (failure.code === 'ERR_ASSERTION' || failure.name === 'AssertionError');
  assert.ok(assertionFailed,
    `${mutantId} survived oracle ${oracleName}; failure=${failure?.name || 'none'}:${failure?.code || 'no-code'}; output=${JSON.stringify(summarizeMutationOutput(result))}`);
  console.log(`MUTANT_KILL ${JSON.stringify({
    mutantId,
    input,
    mutatedOutput: summarizeMutationOutput(result),
    killedByOracle: oracleName,
    failingAssertion: failure.message.split('\n')[0],
  })}`);
}

function isSingular(subject) {
  return ['plant', 'alga', 'photosynthetic bacterium'].includes(subject);
}

function inflect(subject, plural, singular) {
  return isSingular(subject) ? singular : plural;
}

function core(subject, verb) {
  return `${subject} ${inflect(subject, verb, `${verb}s`)} sunlight`;
}

function stored(subject) {
  return `${subject} ${inflect(subject, 'store', 'stores')} solar light`;
}

function mediated(subject) {
  return `${subject} ${inflect(subject, 'use', 'uses')} chlorophyll to transform sunlight`;
}

function subjectsFor(aIndex, bIndex) {
  const a = SUBJECTS[aIndex];
  const b = SUBJECTS[bIndex];
  let offset = 1 + (aIndex % 6);
  if (offset === SUBJECTS.length / 2) offset += 1;
  const cIndex = (bIndex + offset) % SUBJECTS.length;
  let dIndex = (cIndex + 1 + (bIndex % 6)) % SUBJECTS.length;
  if (dIndex === cIndex) dIndex = (dIndex + 1) % SUBJECTS.length;
  const c = SUBJECTS[cIndex];
  const d = SUBJECTS[dIndex];
  return { a, b, c, d };
}

function subjectLemma(subject) {
  return subject === 'plants' ? 'plant' : subject;
}

function buildCase(mode, aIndex, bIndex, random) {
  const { a, b, c, d } = subjectsFor(aIndex, bIndex);
  const context = CONTEXTS[Math.floor(random() * CONTEXTS.length)];
  const common = { mode, a, b, c, d, context };
  switch (mode) {
    case 0: {
      const mediator = random() < 0.5 ? b : c;
      const plain = mediator === b ? c : b;
      const input = `${stored(a)} but ${mediated(mediator)} but ${core(plain, 'transform')}`;
      return { ...common, kind: 'repeated-but-three-frames', input, mediator, plain };
    }
    case 1: {
      const input = `Solar light is stored by ${a} and ${b} ${context} and ${core(c, 'transform')}`;
      return { ...common, kind: 'passive-agent-and-active-sibling', input };
    }
    case 2: {
      const input = `Solar light is stored by ${a}, but ${core(b, 'transform')}`;
      return { ...common, kind: 'comma-but-boundary', input };
    }
    case 3: {
      const input = `Solar light is stored by ${a} and ${b} ${context}`;
      return { ...common, kind: 'passive-context-after-agent-list', input };
    }
    case 4: {
      const input = `Solar light is stored by ${a} and ${b} in photosynthesis but ${core(c, 'absorb')} but ${mediated(d)}`;
      return { ...common, kind: 'passive-context-and-repeated-but-composition', input };
    }
    case 5: {
      const input = `Solar light is stored by ${a},, and ${core(b, 'transform')} but ${core(c, 'absorb')}`;
      return { ...common, kind: 'double-comma-local-malformation-composition', input };
    }
    case 6: {
      const left = `${stored(a)} but ${core(b, 'transform')} but ${mediated(c)}`;
      const right = `${stored(a)} but ${mediated(b)} but ${core(c, 'transform')}`;
      return { ...common, kind: 'repeated-but-mediation-owner-move', input: left, pairedInput: right };
    }
    case 7: {
      const input = `Solar light is stored by ${a},,, and ${core(b, 'transform')} but ${core(c, 'absorb')} in photosynthesis`;
      return { ...common, kind: 'triple-comma-context-and-repeated-but-composition', input };
    }
    default:
      throw new Error(`unknown holdout mode ${mode}`);
  }
}

function structuralKey(item) {
  // A key encodes clause shape, ordered subject identities, and context/punctuation
  // features. It intentionally omits case ordinal and raw whole-sentence text.
  const subjectSlots = {
    'repeated-but-three-frames': [item.a, item.mediator, item.plain],
    'passive-agent-and-active-sibling': [item.a, item.b, item.c],
    'comma-but-boundary': [item.a, item.b],
    'passive-context-after-agent-list': [item.a, item.b],
    'passive-context-and-repeated-but-composition': [item.a, item.b, item.c, item.d],
    'double-comma-local-malformation-composition': [item.a, item.b, item.c],
    'repeated-but-mediation-owner-move': [item.a, item.b, item.c],
    'triple-comma-context-and-repeated-but-composition': [item.a, item.b, item.c],
  }[item.kind];
  const context = {
    'passive-agent-and-active-sibling': item.context,
    'passive-context-after-agent-list': item.context,
    'passive-context-and-repeated-but-composition': 'in photosynthesis',
    'triple-comma-context-and-repeated-but-composition': 'active-tail:in photosynthesis',
  }[item.kind] || null;
  return JSON.stringify({
    kind: item.kind,
    subjects: subjectSlots,
    context,
    boundary: item.kind.includes('comma') ? (item.kind.includes('double') ? ',,' : item.kind.includes('triple') ? ',,,' : ',but') : 'but/and',
  });
}

function buildHoldout() {
  const candidates = [];
  const variationRandom = createRandom(HOLDOUT_SEED);
  for (let mode = 0; mode < 8; mode += 1) {
    for (let aIndex = 0; aIndex < SUBJECTS.length; aIndex += 1) {
      for (let bIndex = 0; bIndex < SUBJECTS.length; bIndex += 1) {
        const item = buildCase(mode, aIndex, bIndex, variationRandom);
        item.key = structuralKey(item);
        candidates.push(item);
      }
    }
  }
  const excluded = candidates.filter((item) => EXACT_ROWS_EXCLUDED.has(item.input)
    || (item.pairedInput && EXACT_ROWS_EXCLUDED.has(item.pairedInput)));
  const eligible = candidates.filter((item) => !EXACT_ROWS_EXCLUDED.has(item.input)
    && !(item.pairedInput && EXACT_ROWS_EXCLUDED.has(item.pairedInput)));
  const cases = shuffle(eligible, createRandom(HOLDOUT_SEED ^ 0x9E3779B9));
  return { candidates, excluded, cases };
}

async function loadPackageEvaluator() {
  const { createDerivedEvaluator } = await import(pathToFileURL(join(
    __dirname, '..', 'scripts', 'run-photosynthesis-relation-mutations.mjs',
  )).href);
  return createDerivedEvaluator();
}

function requireFrameTopology(result, expectedLength, item) {
  const expected = Array.from({ length: expectedLength }, (_, index) => [0, index]);
  assert.deepEqual(result.topology, expected, `${item.kind}: ${item.input}`);
}

function assertSubjectSequence(records, expected, item) {
  assert.deepEqual(records.filter((record) => record.relationType === 'CORE_LIGHT_RELATION')
    .map((record) => record.subjectSet.lemma), expected.map(subjectLemma), `${item.kind}: ${item.input}`);
}

function checkCase(item, packaged, evaluator = evaluatePhotosynthesisRelationsV2) {
  const result = evaluator(item.input);
  if (packaged) {
    assert.deepEqual(packaged.evaluatePhotosynthesisRelationsV2(item.input), result,
      `source/package trace: ${item.input}`);
  }
  switch (item.kind) {
    case 'repeated-but-three-frames':
      assert.equal(result.passed, true, item.input);
      assert.equal(result.hasMalformed, false, item.input);
      requireFrameTopology(result, 3, item);
      assert.ok(result.relationRecords.some((record) => record.relationType === 'CHLOROPHYLL_SUPPORT'
        && record.evidenceSpan.text.includes(item.mediator)), item.input);
      assert.equal(result.coordinationTopology.length, 3, item.input);
      break;
    case 'passive-agent-and-active-sibling':
      assert.equal(result.passed, true, item.input);
      assert.equal(result.hasMalformed, false, item.input);
      requireFrameTopology(result, 2, item);
      assertSubjectSequence(result.relationRecords, [item.a, item.b, item.c], item);
      assert.deepEqual(result.relationRecords.filter((record) => record.relationType === 'CORE_LIGHT_RELATION')
        .map((record) => record.voice), ['PASSIVE', 'PASSIVE', 'ACTIVE'], item.input);
      assert.deepEqual(result.coordinationTopology[0].orderedMembers
        .map(([lemma]) => lemma), [item.a, item.b].map(subjectLemma), item.input);
      break;
    case 'comma-but-boundary':
      assert.equal(result.passed, true, item.input);
      assert.equal(result.hasMalformed, false, item.input);
      requireFrameTopology(result, 2, item);
      assertSubjectSequence(result.relationRecords, [item.a, item.b], item);
      assert.equal(result.coordinationTopology[0].cardinality, 1, item.input);
      break;
    case 'passive-context-after-agent-list':
      assert.equal(result.passed, true, item.input);
      assert.equal(result.hasMalformed, false, item.input);
      requireFrameTopology(result, 1, item);
      assertSubjectSequence(result.relationRecords, [item.a, item.b], item);
      assert.deepEqual(result.relationRecords.map((record) => record.processContext), ['LOCAL_ADJUNCT', 'LOCAL_ADJUNCT'], item.input);
      assert.deepEqual(result.coordinationTopology[0].orderedMembers.map(([lemma]) => lemma), [item.a, item.b].map(subjectLemma), item.input);
      break;
    case 'passive-context-and-repeated-but-composition':
      assert.equal(result.passed, true, item.input);
      assert.equal(result.hasMalformed, false, item.input);
      requireFrameTopology(result, 3, item);
      assertSubjectSequence(result.relationRecords, [item.a, item.b, item.c, item.d], item);
      assert.deepEqual(result.relationRecords.filter((record) => record.voice === 'PASSIVE')
        .map((record) => record.processContext), ['LOCAL_ADJUNCT', 'LOCAL_ADJUNCT'], item.input);
      assert.ok(result.relationRecords.some((record) => record.relationType === 'CHLOROPHYLL_SUPPORT'
        && record.evidenceSpan.text.includes(item.d)), item.input);
      break;
    case 'double-comma-local-malformation-composition':
      assert.equal(result.passed, false, item.input);
      assert.equal(result.hasMalformed, true, item.input);
      requireFrameTopology(result, 3, item);
      assert.deepEqual(result.coordinationTopology[0].rawMembers, [item.a, ''], item.input);
      assert.deepEqual(result.relationRecords.filter((record) => record.qualifies)
        .map((record) => record.subjectSet.lemma), [item.b, item.c].map(subjectLemma), item.input);
      break;
    case 'repeated-but-mediation-owner-move': {
      const paired = evaluator(item.pairedInput);
      assert.equal(result.passed, true, item.input);
      assert.equal(paired.passed, true, item.pairedInput);
      requireFrameTopology(result, 3, item);
      requireFrameTopology(paired, 3, item);
      assert.ok(result.relationRecords.some((record) => record.relationType === 'CHLOROPHYLL_SUPPORT'
        && record.evidenceSpan.text.includes(item.c)), item.input);
      assert.ok(paired.relationRecords.some((record) => record.relationType === 'CHLOROPHYLL_SUPPORT'
        && record.evidenceSpan.text.includes(item.b)), item.pairedInput);
      assert.notEqual(semanticCaseFingerprint(result), semanticCaseFingerprint(paired), item.input);
      break;
    }
    case 'triple-comma-context-and-repeated-but-composition':
      assert.equal(result.passed, false, item.input);
      assert.equal(result.hasMalformed, true, item.input);
      requireFrameTopology(result, 3, item);
      assert.deepEqual(result.coordinationTopology[0].rawMembers, [item.a, '', ''], item.input);
      assert.deepEqual(result.relationRecords.filter((record) => record.qualifies)
        .map((record) => record.subjectSet.lemma), [item.b, item.c].map(subjectLemma), item.input);
      break;
    default:
      throw new Error(`unhandled holdout case ${item.kind}`);
  }
}

function assertNewB4Oracle(result, input) {
  assert.equal(result.passed, true, input);
  assert.equal(result.hasMalformed, false, input);
  assert.deepEqual(result.topology, [[0, 0], [0, 1]], input);
  assert.deepEqual(result.relationRecords.filter((record) => record.relationType === 'CORE_LIGHT_RELATION')
    .map((record) => [record.subjectSet.lemma, record.voice, record.qualifies, record.processContext]), [
    ['green plants', 'PASSIVE', true, 'LOCAL_ADJUNCT'],
    ['algae', 'PASSIVE', true, 'LOCAL_ADJUNCT'],
    ['photosynthetic bacteria', 'ACTIVE', true, 'EXPLICIT_SUBJECT'],
  ], input);
  assert.deepEqual(result.coordinationTopology[0].orderedMembers, [
    ['green plants', 'BIOLOGICAL_AGENT'], ['algae', 'BIOLOGICAL_AGENT'],
  ], input);
}

test('NEW-B1 mutant kill: repeated-BUT scanner stops after one partition', () => {
  const mutant = compileEvaluatorMutant('NEW-B1', (source) => mutateExactlyOnce(
    source,
    'NEW-B1',
    'const rightParts = splitIndependentConjunctionsV2(right);',
    "const rightParts = [{ text: right, boundaryBefore: 'start' }];",
  ));
  const item = buildCase(0, 1, 2, createRandom(HOLDOUT_SEED));
  assertMutantKilled('NEW-B1', item.input, mutant, 'three explicit frame occurrences', (result) => {
    assert.deepEqual(result.topology, [[0, 0], [0, 1], [0, 2]], item.input);
  });
});

test('NEW-B2 mutant kill: any later finite predicate counts as an independent clause', () => {
  const mutant = compileEvaluatorMutant('NEW-B2', (source) => mutateExactlyOnce(
    source,
    'NEW-B2',
    'if (validateActiveFinitePredicateV2(tokens, index, predicate, boundarySubject, auxiliary, control)) return true;',
    'return true;',
  ));
  const item = buildCase(1, 1, 2, () => 0);
  assertMutantKilled('NEW-B2', item.input, mutant, 'passive agent AND stays inside its coordinated frame', (result) => {
    assert.equal(result.passed, true, item.input);
    assert.equal(result.hasMalformed, false, item.input);
    assert.deepEqual(result.topology, [[0, 0], [0, 1]], item.input);
    assert.deepEqual(result.relationRecords.filter((record) => record.relationType === 'CORE_LIGHT_RELATION')
      .map((record) => [record.subjectSet.lemma, record.voice, record.qualifies]), [
      [subjectLemma(item.a), 'PASSIVE', true], [subjectLemma(item.b), 'PASSIVE', true],
      [subjectLemma(item.c), 'ACTIVE', true],
    ], item.input);
  });
});

test('NEW-B3 mutant kill: comma before BUT remains attached to the passive clause', () => {
  const mutant = compileEvaluatorMutant('NEW-B3', (source) => mutateExactlyOnce(
    source,
    'NEW-B3',
    'const separator = /,\\s*(and|but)\\s+|\\s+(and|but)\\s+/ig;',
    'const separator = /\\s+(and|but)\\s+/ig;',
  ));
  const item = buildCase(2, 1, 2, () => 0);
  assertMutantKilled('NEW-B3', item.input, mutant, 'comma-BUT clause boundary stays well formed', (result) => {
    assert.equal(result.passed, true, item.input);
    assert.equal(result.hasMalformed, false, item.input);
    assert.deepEqual(result.topology, [[0, 0], [0, 1]], item.input);
  });
});

test('NEW-B4 mutant kill: supported in/for context tails are not recognized', () => {
  const mutant = compileEvaluatorMutant('NEW-B4', (source) => mutateExactlyOnce(
    source,
    'NEW-B4',
    "if (V2_CONTEXT_ADJUNCT_TAILS.has(tail.join(' '))) return index;",
    "if (false && V2_CONTEXT_ADJUNCT_TAILS.has(tail.join(' '))) return index;",
  ));
  const input = 'Solar light is stored by green plants and algae for photosynthesis and photosynthetic bacteria transform sunlight';
  assertMutantKilled('NEW-B4', input, mutant, 'two passive agents and the active sibling retain local ownership', (result) => {
    assertNewB4Oracle(result, input);
  });
});

test('NEW-B4 cross-root context boundary preserves passive agents and the active sibling', async () => {
  const input = 'Solar light is stored by green plants and algae for photosynthesis and photosynthetic bacteria transform sunlight';
  const result = evaluatePhotosynthesisRelationsV2(input);
  const packaged = process.env.P1_BOUNDARY_HOLDOUT_SOURCE_ONLY === '1' ? null : await loadPackageEvaluator();

  // `for photosynthesis` is an accepted passive context adjunct. The adjacent
  // `and` starts a separately supported clause, so it must not be absorbed into
  // the passive-agent span as `algae for photosynthesis`.
  assertNewB4Oracle(result, input);
  if (packaged) assert.deepEqual(packaged.evaluatePhotosynthesisRelationsV2(input), result, `source/package trace: ${input}`);
});

test('seeded internal holdout covers four roots and cross-root compositions', async () => {
  const { candidates, excluded, cases } = buildHoldout();
  const sourceOnly = process.env.P1_BOUNDARY_HOLDOUT_SOURCE_ONLY === '1';
  const packaged = sourceOnly ? null : await loadPackageEvaluator();
  const keys = new Set(cases.map((item) => item.key));
  const inputs = new Set(cases.map((item) => item.input));
  const counts = Object.fromEntries([...new Set(candidates.map((item) => item.kind))]
    .map((kind) => [kind, cases.filter((item) => item.kind === kind).length]));

  assert.equal(candidates.length, 512, '8 structural families x 8 x 8 lexical slots');
  assert.ok(cases.length >= REQUIRED_CASES, `holdout count ${cases.length} < ${REQUIRED_CASES}`);
  assert.ok(keys.size >= REQUIRED_STRUCTURAL_KEYS, `unique structural keys ${keys.size} < ${REQUIRED_STRUCTURAL_KEYS}`);
  assert.equal(inputs.size, cases.length, 'source strings must remain unique');
  assert.ok(excluded.length > 0, 'the fixed exclusion list should be exercised by this matrix');
  assert.ok(Object.values(counts).every((count) => count > 0), 'every root/composition family must be represented');

  const failures = [];
  for (const item of cases) {
    try {
      checkCase(item, packaged);
      if (packaged && item.pairedInput) {
        assert.deepEqual(packaged.evaluatePhotosynthesisRelationsV2(item.pairedInput),
          evaluatePhotosynthesisRelationsV2(item.pairedInput), `source/package trace: ${item.pairedInput}`);
      }
    } catch (error) {
      failures.push({ kind: item.kind, input: item.input, pairedInput: item.pairedInput || null, message: error.message });
    }
  }

  console.log(`HOLDOUT_SUMMARY ${JSON.stringify({
    seed: `0x${HOLDOUT_SEED.toString(16).toUpperCase()}`,
    generated: candidates.length,
    excludedExactBlockerOrPermanentRows: excluded.length,
    excludedInputs: excluded.map(({ input }) => input).sort(),
    executed: cases.length,
    uniqueStructuralKeys: keys.size,
    uniqueInputs: inputs.size,
    coverage: counts,
    mutationKillCoverage: {
      NEW_B1_repeated_boundary_ownership: counts['repeated-but-three-frames'],
      NEW_B2_passive_agent_and_split_reachability: counts['passive-agent-and-active-sibling'],
      NEW_B3_comma_boundary_and_empty_member_locality: counts['comma-but-boundary']
        + counts['double-comma-local-malformation-composition']
        + counts['triple-comma-context-and-repeated-but-composition'],
      NEW_B4_context_tail_and_cross_root_boundary: counts['passive-context-after-agent-list']
        + counts['passive-context-and-repeated-but-composition'] + 1,
    },
    sourceOnly,
    sourcePackageParityCases: packaged ? cases.length + cases.filter((item) => item.pairedInput).length + 1 : 0,
    failures: failures.length,
  })}`);
  assert.equal(failures.length, 0, `holdout failures (${failures.length}): ${JSON.stringify(failures.slice(0, 20))}`);
});

})();
