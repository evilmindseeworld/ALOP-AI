'use strict';

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
