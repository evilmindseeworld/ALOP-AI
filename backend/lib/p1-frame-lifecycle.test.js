'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  evaluatePhotosynthesisRelationsV2,
  semanticCaseFingerprint,
} = require('./photosynthesis-relation-evaluator');

const freshNouns = Object.freeze([
  'maples', 'cedars', 'willows', 'orchids', 'cattails', 'reeds', 'clovers', 'vines',
  'shrubs', 'seedlings', 'saplings', 'acorns', 'petals', 'roots', 'flowers', 'grains',
  'seeds', 'berries', 'herbs', 'grasses', 'leaves', 'stems', 'cones', 'lichens',
]);
const validSubjects = Object.freeze([
  'plants',
  'plants and algae',
  'green plants and algae',
  'plants, algae, and green plants',
]);
const predicates = Object.freeze(['absorb', 'capture']);
const voices = Object.freeze(['ACTIVE', 'PASSIVE']);
const boundaries = Object.freeze(['; ', '. ', '. And ', '. But ']);
const malformedShapes = Object.freeze(['initial', 'middle', 'final', 'determiner']);

function predicateForms(predicate) {
  return predicate === 'absorb'
    ? { active: 'absorb sunlight', passiveObject: 'Sunlight', past: 'absorbed' }
    : { active: 'capture light energy', passiveObject: 'Light energy', past: 'captured' };
}

function malformedSubject(shape, noun) {
  if (shape === 'initial') return ', and plants and ' + noun;
  if (shape === 'middle') return 'plants, , and ' + noun;
  if (shape === 'final') return 'plants and ' + noun + ', ,';
  return 'plants and the';
}

function makeFrame(kind, voice, predicate, noun, shape, subjectIndex) {
  const forms = predicateForms(predicate);
  if (kind === 'valid') {
    const subject = validSubjects[subjectIndex % validSubjects.length];
    return voice === 'ACTIVE'
      ? subject + ' ' + forms.active
      : forms.passiveObject + ' is ' + forms.past + ' by ' + subject + ' during photosynthesis';
  }
  const subject = malformedSubject(shape, noun);
  return voice === 'ACTIVE'
    ? subject + ' ' + forms.active
    : forms.passiveObject + ' is ' + forms.past + ' by ' + subject + ' during photosynthesis';
}

function recordSignature(record) {
  return {
    qualifies: record.qualifies,
    rejectionReasons: record.rejectionReasons,
    grammarShape: record.grammarShape,
    voice: record.voice,
    verbLemma: record.verbLemma,
    subjectValidity: record.subjectValidity,
    subjectSet: record.subjectSet && {
      lemma: record.subjectSet.lemma,
      role: record.subjectSet.role,
      valid: record.subjectSet.valid,
      validityReason: record.subjectSet.validityReason,
    },
    directObject: record.directObject && {
      role: record.directObject.role,
      normalized: record.directObject.normalized,
    },
    lightObject: record.lightObject && {
      role: record.lightObject.role,
      normalized: record.lightObject.normalized,
    },
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

function assertComposition(frames, joins, label, evaluator = evaluatePhotosynthesisRelationsV2) {
  const singles = frames.map((frame) => evaluator(frame));
  let input = frames[0];
  for (let index = 1; index < frames.length; index += 1) {
    input += joins[index - 1] + frames[index];
  }
  const composed = evaluator(input);
  const malformed = singles.some((result) => result.hasMalformed);

  assert.equal(composed.hasMalformed, malformed, label + ': document malformed aggregate');
  assert.equal(composed.passed, !malformed && singles.some((result) => result.passed),
    label + ': document pass aggregate');

  const expectedRecordCount = singles.reduce((count, result) => count + result.relationRecords.length, 0);
  assert.equal(composed.relationRecords.length, expectedRecordCount, label + ': relation ownership cardinality');
  let offset = 0;
  for (let index = 0; index < singles.length; index += 1) {
    const expected = singles[index].relationRecords.map(recordSignature);
    const actual = composed.relationRecords.slice(offset, offset + expected.length).map(recordSignature);
    assert.deepEqual(actual, expected, label + ': local relation result for frame ' + index);
    offset += expected.length;
  }

  const expectedTopology = singles.flatMap((result) => result.coordinationTopology.map(topologySignature));
  assert.deepEqual(composed.coordinationTopology.map(topologySignature), expectedTopology,
    label + ': topology remains ordered and frame-local');
}

function compositionInput(frames, joins) {
  return frames.slice(1).reduce((input, frame, index) => input + joins[index] + frame, frames[0]);
}

function assertSourcePackageParity(frames, joins, label, packagedEvaluator) {
  for (const frame of frames) {
    assert.deepEqual(packagedEvaluator(frame), evaluatePhotosynthesisRelationsV2(frame), label + ': single-frame parity');
  }
  const input = compositionInput(frames, joins);
  assert.deepEqual(packagedEvaluator(input), evaluatePhotosynthesisRelationsV2(input), label + ': composition parity');
}

const twoFrameCases = [];
const statePairs = [
  ['valid', 'valid'],
  ['valid', 'malformed'],
  ['malformed', 'valid'],
  ['malformed', 'malformed'],
];
for (const states of statePairs) {
  for (let boundaryIndex = 0; boundaryIndex < boundaries.length; boundaryIndex += 1) {
    for (const predicateA of predicates) {
      for (const predicateB of predicates) {
        for (const voiceA of voices) {
          for (const voiceB of voices) {
            for (let shapeIndex = 0; shapeIndex < malformedShapes.length; shapeIndex += 1) {
              const caseIndex = twoFrameCases.length;
              const noun = freshNouns[caseIndex % freshNouns.length];
              const frames = [
                makeFrame(states[0], voiceA, predicateA, noun, malformedShapes[shapeIndex], caseIndex),
                makeFrame(states[1], voiceB, predicateB, freshNouns[(caseIndex + 7) % freshNouns.length],
                  malformedShapes[shapeIndex], caseIndex + 1),
              ];
              twoFrameCases.push({
                frames,
                joins: [boundaries[boundaryIndex]],
                label: 'two-frame-' + caseIndex,
              });
            }
          }
        }
      }
    }
  }
}

const threeFrameCases = [];
const stateOrders = [
  ['valid', 'valid', 'malformed'],
  ['valid', 'malformed', 'valid'],
  ['malformed', 'valid', 'valid'],
  ['malformed', 'malformed', 'valid'],
  ['malformed', 'valid', 'malformed'],
  ['valid', 'malformed', 'malformed'],
  ['valid', 'valid', 'valid'],
  ['malformed', 'malformed', 'malformed'],
];
const joinPatterns = [
  ['; ', '; '],
  ['. ', '. '],
  ['. And ', '. But '],
  ['. But ', '. And '],
];
const predicatePatterns = [
  ['absorb', 'absorb', 'absorb'],
  ['absorb', 'capture', 'absorb'],
];
const voicePatterns = [
  ['ACTIVE', 'ACTIVE', 'ACTIVE'],
  ['PASSIVE', 'ACTIVE', 'PASSIVE'],
];
for (const states of stateOrders) {
  for (const joins of joinPatterns) {
    for (const predicatePattern of predicatePatterns) {
      for (const voicePattern of voicePatterns) {
        for (let shapeIndex = 0; shapeIndex < 2; shapeIndex += 1) {
          const caseIndex = threeFrameCases.length;
          const frames = states.map((state, frameIndex) => makeFrame(
            state,
            voicePattern[frameIndex],
            predicatePattern[frameIndex],
            freshNouns[(caseIndex + frameIndex * 5) % freshNouns.length],
            malformedShapes[(shapeIndex + frameIndex) % malformedShapes.length],
            caseIndex + frameIndex,
          ));
          threeFrameCases.push({
            frames,
            joins,
            label: 'three-frame-' + caseIndex,
          });
        }
      }
    }
  }
}

test('frame lifecycle composition properties cover source and package across 1,024 two-frame and 256 three-frame cases', async (t) => {
  const { createDerivedEvaluator } = await import(pathToFileURL(join(
    __dirname, '..', 'scripts', 'run-photosynthesis-relation-mutations.mjs',
  )).href);
  const packagedEvaluator = createDerivedEvaluator().evaluatePhotosynthesisRelationsV2;
  assert.equal(twoFrameCases.length, 1024);
  assert.equal(threeFrameCases.length, 256);

  for (const item of twoFrameCases) {
    assertComposition(item.frames, item.joins, item.label);
    assertSourcePackageParity(item.frames, item.joins, item.label, packagedEvaluator);
  }
  for (const item of threeFrameCases) {
    assertComposition(item.frames, item.joins, item.label);
    assertSourcePackageParity(item.frames, item.joins, item.label, packagedEvaluator);
  }
  t.diagnostic('source/package parity checked for ' + (twoFrameCases.length + threeFrameCases.length)
    + ' composed inputs and their independent frames');
});

test('duplicate semantic frames remain separate and malformed same-predicate siblings stay local', () => {
  assertComposition([
    'plants and algae absorb sunlight',
    'plants and algae absorb sunlight',
  ], ['; '], 'duplicate-semantic-frames');

  assertComposition([
    'plants and algae absorb sunlight',
    'green plants and algae absorb sunlight',
    'plants, , and algae absorb sunlight',
  ], ['; ', '; '], 'same-predicate-three-frame-collision');

  assertComposition([
    'plants absorb sunlight',
    'plants, , and algae absorb sunlight',
  ], ['; '], 'single-topology-sibling');
});

test('cross-sentence malformed frame leaves the following valid frame locally intact', () => {
  assertComposition([
    ', and plants and algae absorb sunlight',
    'plants and algae absorb sunlight',
  ], ['. And '], 'cross-sentence-malformed-first');

  assertComposition([
    'plants and algae absorb sunlight',
    ', and plants and algae absorb sunlight',
  ], ['. But '], 'cross-sentence-malformed-second');
});

test('frame identity remains private and outside the frozen semantic projection', () => {
  const result = evaluatePhotosynthesisRelationsV2(
    'plants and algae absorb sunlight; plants, , and algae absorb sunlight',
  );
  assert.equal(result.relationRecords.some((record) => Object.hasOwn(record, 'frameId')), false);
  assert.equal(result.coordinationTopology.some((group) => Object.hasOwn(group, 'frameId')), false);
  const fingerprint = semanticCaseFingerprint(result);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
});
