'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const evaluator = require('./photosynthesis-relation-evaluator');

const frameProjection = (result) => result[Object.getOwnPropertySymbols(result)
  .find((symbol) => symbol.description === 'V2_FRAME_PROJECTIONS')];
const packageEvaluator = async () => (await import(pathToFileURL(join(
  __dirname,
  '..',
  'scripts',
  'run-photosynthesis-relation-mutations.mjs',
)).href)).createDerivedEvaluator();

const exactCases = [
  {
    input: 'Light is stored by plants, and and algae, and plants, , and algae absorb sunlight',
    passiveMembers: ['plants', '', 'algae'],
    activeMembers: ['plants', '', 'algae'],
    activeMalformed: true,
  },
  {
    input: 'Light is stored by plants, algae, and, and green plants and photosynthetic bacteria use chlorophyll to capture sunlight',
    passiveMembers: ['plants', 'algae', ''],
    activeMembers: ['green plants', 'photosynthetic bacteria'],
    activeMalformed: false,
    activeHasOwnedCoreAndSupport: true,
  },
];

function assertMalformedPassiveBoundary(item, api) {
  const result = api.evaluatePhotosynthesisRelationsV2(item.input);
  const frames = frameProjection(result);
  assert.equal(result.passed, false, item.input);
  assert.equal(frames.length, 2, item.input);
  assert.equal(frames[0].malformed, true, item.input);
  assert.equal(frames[1].malformed, item.activeMalformed, item.input);
  assert.deepEqual(frames[0].coordinationTopology[0].rawMembers, item.passiveMembers, item.input);
  assert.equal(frames[0].coordinationTopology[0].cardinality, item.passiveMembers.length, item.input);
  assert.ok(frames[0].records.filter((record) => record.relationType === 'CORE_LIGHT_RELATION')
    .every((record) => !record.qualifies), item.input);
  assert.deepEqual(frames[1].coordinationTopology[0].rawMembers
    || frames[1].coordinationTopology[0].orderedMembers.map(([surface]) => surface), item.activeMembers, item.input);
  if (item.activeHasOwnedCoreAndSupport) {
    const activeRecords = frames[1].records;
    const coreSubjects = activeRecords.filter((record) => record.relationType === 'CORE_LIGHT_RELATION' && record.qualifies)
      .map((record) => record.subjectSet.surface).sort();
    const supportSubjects = activeRecords.filter((record) => record.relationType === 'CHLOROPHYLL_SUPPORT' && record.qualifies)
      .map((record) => record.subjectSet.surface).sort();
    assert.deepEqual(coreSubjects, item.activeMembers.slice().sort(), item.input);
    assert.deepEqual(supportSubjects, item.activeMembers.slice().sort(), item.input);
  }
  return result;
}

test('auditor cases preserve malformed passive ownership and comma-and sibling boundaries', async () => {
  const packaged = await packageEvaluator();
  for (const item of exactCases) {
    const source = assertMalformedPassiveBoundary(item, evaluator);
    const built = assertMalformedPassiveBoundary(item, packaged);
    assert.deepEqual(built, source, item.input);
    assert.deepEqual(frameProjection(built), frameProjection(source), item.input);
    assert.equal(packaged.semanticCaseFingerprint(built), evaluator.semanticCaseFingerprint(source), item.input);
  }

  const malformedFingerprint = evaluator.semanticCaseFingerprint(exactCases[0].input);
  assert.notEqual(malformedFingerprint, evaluator.semanticCaseFingerprint('Light is stored by plants'));
});

test('valid passive lists and multiword mediated siblings remain valid', async () => {
  const packaged = await packageEvaluator();
  const controls = [
    'Light is stored by plants and algae, and plants and algae absorb sunlight',
    'Light is stored by plants and algae, and green plants and photosynthetic bacteria use chlorophyll to capture sunlight',
  ];
  for (const input of controls) {
    const source = evaluator.evaluatePhotosynthesisRelationsV2(input);
    const built = packaged.evaluatePhotosynthesisRelationsV2(input);
    assert.equal(source.passed, true, input);
    assert.equal(source.hasMalformed, false, input);
    assert.equal(frameProjection(source).length, 2, input);
    assert.deepEqual(built, source, input);
  }
});
function normalizedTopologyMembers(frame) {
  const topology = frame.coordinationTopology[0];
  const members = topology.rawMembers || topology.orderedMembers.map(([surface]) => surface);
  return members.map((surface) => surface ? evaluator.normalizeExactFormLemmaV2(surface) : '');
}

function assertMalformedPassiveMatrixCase(item, api) {
  const result = api.evaluatePhotosynthesisRelationsV2(item.input);
  const frames = frameProjection(result);
  assert.equal(result.passed, false, item.input);
  assert.equal(result.hasMalformed, true, item.input);
  assert.equal(frames.length, 2, item.input);
  assert.equal(frames[0].frameId, 0, item.input);
  assert.equal(frames[1].frameId, 1, item.input);
  assert.equal(frames[0].malformed, true, item.input);
  assert.equal(frames[1].malformed, item.sibling.malformed, item.input);
  assert.deepEqual(normalizedTopologyMembers(frames[0]), item.passiveMembers.map((x) => x ? evaluator.normalizeExactFormLemmaV2(x) : ''), item.input);
  assert.equal(frames[0].coordinationTopology[0].cardinality, item.passiveMembers.length, item.input);
  assert.deepEqual(normalizedTopologyMembers(frames[1]), item.sibling.members.map((x) => x ? evaluator.normalizeExactFormLemmaV2(x) : ''), item.input);
  assert.ok(frames[0].records.filter((record) => record.relationType === 'CORE_LIGHT_RELATION')
    .every((record) => !record.qualifies), item.input);
  assert.equal(frames[0].records.some((record) => record.relationType === 'CHLOROPHYLL_SUPPORT'), false, item.input);
  assert.ok(frames[0].records.every((record) => record.voice === 'PASSIVE'
    && record.verbLemma === 'store' && record.verbForm === 'PAST_PARTICIPLE'), item.input);
  if (item.sibling.malformed) {
    assert.ok(frames[1].records.every((record) => !record.qualifies), item.input);
    assert.equal(frames[1].records.some((record) => record.relationType === 'CHLOROPHYLL_SUPPORT'), false, item.input);
  } else if (item.sibling.voice === 'PASSIVE') {
    const core = frames[1].records.filter((record) => record.relationType === 'CORE_LIGHT_RELATION' && record.qualifies);
    assert.ok(core.length > 0, item.input);
    assert.ok(core.every((record) => record.voice === 'PASSIVE'
      && record.verbLemma === item.sibling.verbLemma && record.verbForm === item.sibling.verbForm), item.input);
  } else {
    const core = frames[1].records.filter((record) => record.relationType === 'CORE_LIGHT_RELATION' && record.qualifies);
    assert.deepEqual(core.map((record) => record.subjectSet.surface).sort(), item.sibling.members.slice().sort(), item.input);
    assert.ok(core.every((record) => record.voice === 'ACTIVE'
      && record.verbLemma === item.sibling.verbLemma && record.verbForm === item.sibling.verbForm), item.input);
    const support = frames[1].records.filter((record) => record.relationType === 'CHLOROPHYLL_SUPPORT' && record.qualifies);
    assert.deepEqual(support.map((record) => record.subjectSet.surface).sort(), item.sibling.supportMembers.slice().sort(), item.input);
    assert.ok(frames[1].records.every((record) => record.evidenceSpan.text === frames[1].text), item.input);
  }
  return result;
}

const directedPassiveShapes = [
  { id: 'A', render: ([a, b]) => `${a}, and and ${b}`, members: ([a, b]) => [a, '', b] },
  { id: 'B', render: ([a, b]) => `${a} and and ${b}`, members: ([a, b]) => [a, '', b] },
  { id: 'C', render: ([a, b]) => `${a}, , and ${b}`, members: ([a, b]) => [a, '', b] },
  { id: 'D', render: ([a, b]) => `${a}, ${b}, and`, members: ([a, b]) => [a, b, ''] },
  { id: 'E', render: ([a, b, c]) => `${a}, ${b}, , and ${c}`, members: ([a, b, c]) => [a, b, '', c] },
  { id: 'F', render: ([a, b, c]) => `${a} and ${b} and and ${c}`, members: ([a, b, c]) => [a, b, '', c] },
  { id: 'G', render: ([a, b, c]) => `${a}, and and ${b} and and ${c}`, members: ([a, b, c]) => [a, '', b, '', c] },
];
const directedPassiveSubjects = [
  ['plants', 'algae'],
  ['plants', 'photosynthetic bacteria'],
  ['green plants', 'algae'],
  ['green plants', 'photosynthetic bacteria'],
  ['plants', 'algae', 'photosynthetic bacteria'],
];
const directedSiblings = [
  { id: 'simple-active', render: (xs, light) => `${xs[0]} captured ${light}`, members: (xs) => [xs[0]], voice: 'ACTIVE', verbLemma: 'capture', verbForm: 'PAST', malformed: false, supportMembers: [] },
  { id: 'coordinated-active', render: (xs, light) => `${xs[0]} and ${xs[1]} absorb ${light}`, members: (xs) => xs.slice(0, 2), voice: 'ACTIVE', verbLemma: 'absorb', verbForm: 'BASE', malformed: false, supportMembers: [] },
  { id: 'multiword-active', render: (_xs, light) => `green plants captured ${light}`, members: () => ['green plants'], voice: 'ACTIVE', verbLemma: 'capture', verbForm: 'PAST', malformed: false, supportMembers: [] },
  { id: 'mediated-active', render: (_xs, light) => `green plants and photosynthetic bacteria use chlorophyll to capture ${light}`, members: () => ['green plants', 'photosynthetic bacteria'], voice: 'ACTIVE', verbLemma: 'capture', verbForm: 'BASE', malformed: false, supportMembers: ['green plants', 'photosynthetic bacteria'] },
  { id: 'modal-active', render: (_xs, light) => `photosynthetic bacteria must absorb ${light}`, members: () => ['photosynthetic bacteria'], voice: 'ACTIVE', verbLemma: 'absorb', verbForm: 'BASE', malformed: false, supportMembers: [] },
  { id: 'valid-passive', render: (xs) => `Light is stored by ${xs[0]} and ${xs[1]}`, members: (xs) => xs.slice(0, 2), voice: 'PASSIVE', verbLemma: 'store', verbForm: 'PAST_PARTICIPLE', malformed: false, supportMembers: [] },
  { id: 'malformed-active', render: (xs, light) => `${xs[0]} and and ${xs[1]} absorb ${light}`, members: (xs) => [xs[0], '', xs[1]], voice: 'ACTIVE', verbLemma: 'absorb', verbForm: 'BASE', malformed: true, supportMembers: [] },
];

 test('directed malformed-passive/comma-and matrix preserves ownership, locality, records, and fingerprints', async () => {
  const packaged = await packageEvaluator();
  const boundaries = [', and ', ' and ', ' but ', ', but ', '; ', '. '];
  const contexts = ['', ' in photosynthesis', ' for photosynthesis'];
  const keys = new Set();
  let cases = 0;
  for (const shape of directedPassiveShapes) for (const passiveSubjects of directedPassiveSubjects)
    for (const sibling of directedSiblings) for (const boundary of boundaries) for (const context of contexts) {
      if (['E', 'F', 'G'].includes(shape.id) && passiveSubjects.length !== 3) continue;
      if (['A', 'B', 'C', 'D'].includes(shape.id) && passiveSubjects.length !== 2) continue;
      if (boundary === ' and ' && ['coordinated-active', 'mediated-active', 'malformed-active'].includes(sibling.id)) continue;
      const passiveRole = shape.render(passiveSubjects);
      const passiveMembers = shape.members(passiveSubjects);
      const siblingSubjects = ['plants', 'algae', 'green plants', 'photosynthetic bacteria'];
      const siblingText = sibling.render(siblingSubjects, 'sunlight');
      const input = `Light is stored by ${passiveRole}${boundary}${siblingText}${context}`;
      const key = JSON.stringify({ shape: shape.id, passiveMembers, sibling: sibling.id, boundary, context, passiveSubjects });
      assert.equal(keys.has(key), false, input);
      keys.add(key);
      const item = { input, passiveMembers, sibling: { ...sibling, members: sibling.members(siblingSubjects), supportMembers: sibling.supportMembers } };
      const source = assertMalformedPassiveMatrixCase(item, evaluator);
      const built = assertMalformedPassiveMatrixCase(item, packaged);
      assert.deepEqual(built, source, input);
      assert.deepEqual(frameProjection(built), frameProjection(source), input);
      assert.equal(packaged.semanticCaseFingerprint(built), evaluator.semanticCaseFingerprint(source), input);

      const validRole = passiveSubjects.join(' and ');
      const validTwin = `Light is stored by ${validRole}${boundary}${siblingText}${context}`;
      const validSource = evaluator.evaluatePhotosynthesisRelationsV2(validTwin);
      const validBuilt = packaged.evaluatePhotosynthesisRelationsV2(validTwin);
      const validFrames = frameProjection(validSource);
      assert.deepEqual(validBuilt, validSource, validTwin);
      assert.equal(validFrames.length, 2, validTwin);
      assert.equal(validFrames[0].malformed, false, validTwin);
      assert.deepEqual(normalizedTopologyMembers(validFrames[0]), passiveSubjects.map((x) => evaluator.normalizeExactFormLemmaV2(x)), validTwin);
      assert.notEqual(evaluator.semanticCaseFingerprint(source), evaluator.semanticCaseFingerprint(validSource), input);
      cases += 1;
    }
  assert.equal(cases, 2223);
  assert.equal(keys.size, cases);
  console.log(`MALFORMED_PASSIVE_BOUNDARY_MATRIX ${cases}/${keys.size}; failures=0; source/package mismatches=0`);
});

test('terminal-empty passive roles stop before the next supported sibling member', async () => {
  const packaged = await packageEvaluator();
  const cases = [
    { input: 'Light is stored by plants, ,, and algae absorb sunlight', passiveMembers: ['plants', '', ''], activeMembers: ['algae'] },
    { input: 'Light is stored by plants, algae, ,, and green plants absorb sunlight', passiveMembers: ['plants', 'algae', '', ''], activeMembers: ['green plants'] },
  ];
  for (const item of cases) {
    const source = evaluator.evaluatePhotosynthesisRelationsV2(item.input);
    const built = packaged.evaluatePhotosynthesisRelationsV2(item.input);
    const frames = frameProjection(source);
    assert.equal(source.passed, false, item.input);
    assert.equal(frames.length, 2, item.input);
    assert.equal(frames[0].malformed, true, item.input);
    assert.equal(frames[1].malformed, false, item.input);
    assert.deepEqual(frames[0].coordinationTopology[0].rawMembers, item.passiveMembers, item.input);
    assert.equal(frames[0].coordinationTopology[0].cardinality, item.passiveMembers.length, item.input);
    assert.deepEqual(normalizedTopologyMembers(frames[1]), item.activeMembers.map((x) => evaluator.normalizeExactFormLemmaV2(x)), item.input);
    assert.deepEqual(built, source, item.input);
    assert.equal(packaged.semanticCaseFingerprint(built), evaluator.semanticCaseFingerprint(source), item.input);
  }
});

test('malformed passive ownership remains local across three-frame orderings', async () => {
  const packaged = await packageEvaluator();
  const cases = [
    {
      input: 'Light is stored by plants, and and algae, and plants capture sunlight, and green plants absorb light',
      expected: [['plants', '', 'algae'], ['plants'], ['green plants']], malformed: [true, false, false],
    },
    {
      input: 'Plants capture sunlight; Light is stored by plants, algae, and, and green plants capture sunlight',
      expected: [['plants'], ['plants', 'algae', ''], ['green plants']], malformed: [false, true, false],
    },
    {
      input: 'Light is stored by plants, algae, and, and plants and and algae absorb sunlight, and green plants absorb sunlight',
      expected: [['plants', 'algae', ''], ['plants', '', 'algae'], ['green plants']], malformed: [true, true, false],
    },
    {
      input: 'Light is stored by plants, algae, and, and green plants and photosynthetic bacteria use chlorophyll to capture sunlight, and plants absorb light',
      expected: [['plants', 'algae', ''], ['green plants', 'photosynthetic bacteria'], ['plants']], malformed: [true, false, false],
    },
    {
      input: 'Plants must capture sunlight; Light is stored by plants, algae, and, and green plants capture sunlight',
      expected: [['plants'], ['plants', 'algae', ''], ['green plants']], malformed: [false, true, false],
    },
    {
      input: 'Plants capture sunlight; Algae absorb sunlight; Light is stored by plants, algae, and',
      expected: [['plants'], ['algae'], ['plants', 'algae', '']], malformed: [false, false, true],
    },
  ];
  for (const item of cases) {
    const source = evaluator.evaluatePhotosynthesisRelationsV2(item.input);
    const built = packaged.evaluatePhotosynthesisRelationsV2(item.input);
    const frames = frameProjection(source);
    assert.equal(source.passed, false, item.input);
    assert.equal(frames.length, 3, item.input);
    assert.deepEqual(frames.map((frame) => frame.malformed), item.malformed, item.input);
    assert.deepEqual(frames.map(normalizedTopologyMembers), item.expected.map((members) => members.map((x) => x ? evaluator.normalizeExactFormLemmaV2(x) : '')), item.input);
    assert.deepEqual(built, source, item.input);
    assert.equal(packaged.semanticCaseFingerprint(built), evaluator.semanticCaseFingerprint(source), item.input);
  }
});

test('H-I boundary-commitment mutations produce semantic ownership failures without crash credit', () => {
  const { readFileSync } = require('node:fs');
  const sourceText = readFileSync(join(__dirname, 'photosynthesis-relation-evaluator.js'), 'utf8');
  const loadMutant = (mutated) => {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', mutated)(require, module, module.exports);
    return module.exports;
  };
  const replaceOnce = (text, before, after) => {
    assert.equal(text.split(before).length, 2, `mutation anchor must be unique: ${before}`);
    return text.replace(before, after);
  };
  const h = loadMutant(replaceOnce(sourceText,
    "if (['and', 'or', 'rather', 'but'].includes(tokens[0]?.form)) return false;",
    'if (false) return false;'));
  const i = loadMutant(replaceOnce(sourceText,
    "if (subject.coordinator !== 'AND' || !subject.members.some((member) => member.valid)) return false;",
    "if (subject.coordinator !== 'AND' || !subject.members.some((member) => member.valid) || !subject.members.at(-1)?.surface) return false;"));
  const first = exactCases[0].input;
  const second = exactCases[1].input;
  assert.doesNotThrow(() => h.evaluatePhotosynthesisRelationsV2(first));
  const hFrames = frameProjection(h.evaluatePhotosynthesisRelationsV2(first));
  assert.equal(hFrames[0].malformed, false);
  assert.ok(hFrames[0].records.some((record) => record.relationType === 'CORE_LIGHT_RELATION' && record.qualifies));
  assert.doesNotThrow(() => i.evaluatePhotosynthesisRelationsV2(second));
  const iFrames = frameProjection(i.evaluatePhotosynthesisRelationsV2(second));
  assert.deepEqual(iFrames[0].coordinationTopology[0].rawMembers, ['plants', 'algae', '', 'green plants']);
  assert.deepEqual(normalizedTopologyMembers(iFrames[1]), ['photosynthetic bacteria']);
  assert.equal(iFrames[1].records.some((record) => record.relationType === 'CHLOROPHYLL_SUPPORT'
    && record.subjectSet.surface === 'green plants'), false);
  console.log('NEW_H-I_MUTATIONS 2/2 MEANINGFUL; crashes=0');
});


test('supported context adjacency leaves malformed passive members and mediated support ownership unchanged', async () => {
  const packaged = await packageEvaluator();
  const cases = [
    {
      input: 'Light is stored by plants, and and algae in photosynthesis, and green plants and photosynthetic bacteria use chlorophyll to capture sunlight',
      control: 'Light is stored by plants, and and algae, and green plants and photosynthetic bacteria use chlorophyll to capture sunlight',
      passiveMembers: ['plants', '', 'algae'],
    },
    {
      input: 'Light is stored by plants, and and algae for photosynthesis, and green plants and photosynthetic bacteria use chlorophyll to capture sunlight',
      control: 'Light is stored by plants, and and algae, and green plants and photosynthetic bacteria use chlorophyll to capture sunlight',
      passiveMembers: ['plants', '', 'algae'],
    },
    {
      input: 'Light is stored by plants, , and algae in photosynthesis, and green plants and photosynthetic bacteria use chlorophyll to capture sunlight',
      control: 'Light is stored by plants, , and algae, and green plants and photosynthetic bacteria use chlorophyll to capture sunlight',
      passiveMembers: ['plants', '', 'algae'],
    },
    {
      input: 'Light is stored by plants, , and algae for photosynthesis, and green plants and photosynthetic bacteria use chlorophyll to capture sunlight',
      control: 'Light is stored by plants, , and algae, and green plants and photosynthetic bacteria use chlorophyll to capture sunlight',
      passiveMembers: ['plants', '', 'algae'],
    },
  ];
  for (const item of cases) {
    const source = evaluator.evaluatePhotosynthesisRelationsV2(item.input);
    const built = packaged.evaluatePhotosynthesisRelationsV2(item.input);
    const control = evaluator.evaluatePhotosynthesisRelationsV2(item.control);
    const frames = frameProjection(source);
    const controlFrames = frameProjection(control);
    assert.equal(source.passed, false, item.input);
    assert.equal(frames.length, 2, item.input);
    assert.equal(controlFrames.length, 2, item.control);
    assert.equal(frames[0].malformed, true, item.input);
    assert.equal(controlFrames[0].malformed, true, item.control);
    assert.deepEqual(normalizedTopologyMembers(frames[0]), item.passiveMembers.map((x) => x ? evaluator.normalizeExactFormLemmaV2(x) : ''), item.input);
    assert.deepEqual(normalizedTopologyMembers(frames[0]), normalizedTopologyMembers(controlFrames[0]), item.input);
    assert.equal(frames[0].coordinationTopology[0].cardinality, controlFrames[0].coordinationTopology[0].cardinality, item.input);
    assert.ok(frames[0].records.every((record) => record.processContext === 'LOCAL_ADJUNCT'), item.input);
    assert.ok(controlFrames[0].records.every((record) => record.processContext === null), item.control);
    assert.deepEqual(normalizedTopologyMembers(frames[1]), ['green plants', 'photosynthetic bacteria'], item.input);
    const core = frames[1].records.filter((record) => record.relationType === 'CORE_LIGHT_RELATION' && record.qualifies);
    const support = frames[1].records.filter((record) => record.relationType === 'CHLOROPHYLL_SUPPORT' && record.qualifies);
    assert.deepEqual(core.map((record) => record.subjectSet.surface).sort(), ['green plants', 'photosynthetic bacteria'], item.input);
    assert.deepEqual(support.map((record) => record.subjectSet.surface).sort(), ['green plants', 'photosynthetic bacteria'], item.input);
    assert.ok(frames[1].records.every((record) => record.processContext === 'EXPLICIT_SUBJECT'), item.input);
    assert.deepEqual(built, source, item.input);
    assert.equal(packaged.semanticCaseFingerprint(built), evaluator.semanticCaseFingerprint(source), item.input);
  }
});

function holdoutRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function createMalformedPassiveHoldoutCase(random, familyIndex) {
  const subjects = ['plants', 'algae', 'green plants', 'photosynthetic bacteria', 'some bacteria'];
  const verbs = ['capture', 'absorb', 'harness', 'convert', 'transform', 'store'];
  const past = (verb) => verb + (verb.endsWith('e') ? 'd' : 'ed');
  const pick = (values) => values[Math.floor(random() * values.length)];
  const sample = (count) => {
    const pool = subjects.slice();
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [pool[index], pool[swap]] = [pool[swap], pool[index]];
    }
    return pool.slice(0, count);
  };
  const makeMalformedPassive = () => {
    const patterns = [
      { id: 'comma-duplicate', count: 2, render: ([a, b]) => `${a}, and and ${b}`, members: ([a, b]) => [a, '', b] },
      { id: 'plain-duplicate', count: 2, render: ([a, b]) => `${a} and and ${b}`, members: ([a, b]) => [a, '', b] },
      { id: 'comma-empty', count: 2, render: ([a, b]) => `${a}, , and ${b}`, members: ([a, b]) => [a, '', b] },
      { id: 'terminal-empty', count: 2, render: ([a, b]) => `${a}, ${b}, and`, members: ([a, b]) => [a, b, ''] },
      { id: 'internal-empty', count: 3, render: ([a, b, c]) => `${a}, ${b}, , and ${c}`, members: ([a, b, c]) => [a, b, '', c] },
      { id: 'duplicate-after-and', count: 3, render: ([a, b, c]) => `${a} and ${b} and and ${c}`, members: ([a, b, c]) => [a, b, '', c] },
      { id: 'repeated-empty', count: 3, render: ([a, b, c]) => `${a}, and and ${b} and and ${c}`, members: ([a, b, c]) => [a, '', b, '', c] },
    ];
    const pattern = pick(patterns);
    const members = sample(pattern.count);
    const verbLemma = pick(verbs);
    return {
      type: 'malformed-passive',
      shape: pattern.id,
      text: `Light is ${past(verbLemma)} by ${pattern.render(members)}`,
      members: pattern.members(members),
      malformed: true,
      voice: 'PASSIVE',
      grammarShape: 'PASSIVE_LOCAL_AGENT',
      verbLemma,
      verbForm: 'PAST_PARTICIPLE',
      modal: null,
      supportMembers: [],
    };
  };
  const makeValidActive = (forcedType = null) => {
    const type = forcedType || pick(['simple-active', 'coordinated-active', 'multiword-active', 'mediated-active', 'modal-active', 'malformed-active']);
    const light = pick(['light', 'sunlight', 'solar energy']);
    if (type === 'simple-active') {
      const subject = pick(subjects);
      const verbLemma = pick(verbs);
      return { type, text: `${subject} ${past(verbLemma)} ${light}`, members: [subject], malformed: false, voice: 'ACTIVE', grammarShape: 'ACTIVE_SIMPLE', verbLemma, verbForm: 'PAST', modal: null, supportMembers: [] };
    }
    if (type === 'multiword-active') {
      const subject = pick(['green plants', 'photosynthetic bacteria', 'some bacteria']);
      const verbLemma = pick(['capture', 'absorb', 'harness', 'convert', 'transform']);
      return { type, text: `${subject} ${past(verbLemma)} ${light}`, members: [subject], malformed: false, voice: 'ACTIVE', grammarShape: 'ACTIVE_SIMPLE', verbLemma, verbForm: 'PAST', modal: null, supportMembers: [] };
    }
    if (type === 'coordinated-active') {
      const members = sample(2);
      const verbLemma = pick(['capture', 'absorb', 'harness', 'convert', 'transform']);
      return { type, text: `${members[0]} and ${members[1]} ${verbLemma} ${light}`, members, malformed: false, voice: 'ACTIVE', grammarShape: 'ACTIVE_SIMPLE', verbLemma, verbForm: 'BASE', modal: null, supportMembers: [] };
    }
    if (type === 'mediated-active') {
      const members = sample(2);
      return { type, text: `${members[0]} and ${members[1]} use chlorophyll to capture ${light}`, members, malformed: false, voice: 'ACTIVE', grammarShape: 'ACTIVE_INFINITIVAL_MEDIATED', verbLemma: 'capture', verbForm: 'BASE', modal: null, supportMembers: members.slice() };
    }
    if (type === 'modal-active') {
      const subject = pick(subjects);
      const verbLemma = pick(['capture', 'absorb', 'harness', 'convert', 'transform']);
      return { type, text: `${subject} must ${verbLemma} ${light}`, members: [subject], malformed: false, voice: 'ACTIVE', grammarShape: 'ACTIVE_SIMPLE', verbLemma, verbForm: 'BASE', modal: 'must', supportMembers: [] };
    }
    if (type === 'valid-passive') {
      const members = sample(2);
      const verbLemma = pick(verbs);
      return { type, text: `Light is ${past(verbLemma)} by ${members[0]} and ${members[1]}`, members, malformed: false, voice: 'PASSIVE', grammarShape: 'PASSIVE_LOCAL_AGENT', verbLemma, verbForm: 'PAST_PARTICIPLE', modal: null, supportMembers: [] };
    }
    const members = sample(2);
    const verbLemma = pick(verbs);
    return { type, text: `${members[0]} and and ${members[1]} ${past(verbLemma)} ${light}`, members: [members[0], '', members[1]], malformed: true, voice: 'ACTIVE', grammarShape: 'ACTIVE_SIMPLE', verbLemma, verbForm: 'PAST', modal: null, supportMembers: [] };
  };
  const makeModal = () => {
    const subject = pick(subjects);
    const verbLemma = pick(['capture', 'absorb', 'harness', 'convert', 'transform']);
    return { type: 'modal-active', text: `${subject} must ${verbLemma} sunlight`, members: [subject], malformed: false, voice: 'ACTIVE', grammarShape: 'ACTIVE_SIMPLE', verbLemma, verbForm: 'BASE', modal: 'must', supportMembers: [] };
  };
  const badPassive = makeMalformedPassive();
  let frames;
  switch (familyIndex) {
    case 0: frames = [badPassive, makeValidActive()]; break;
    case 1: frames = [makeValidActive('simple-active'), badPassive, makeValidActive('simple-active')]; break;
    case 2: frames = [badPassive, makeValidActive('malformed-active'), makeValidActive('simple-active')]; break;
    case 3: frames = [badPassive, makeValidActive('mediated-active'), makeValidActive('simple-active')]; break;
    case 4: frames = [makeModal(), badPassive, makeValidActive('simple-active')]; break;
    case 5: frames = [makeValidActive('simple-active'), makeValidActive('simple-active'), badPassive]; break;
    case 6: frames = [badPassive, makeValidActive('simple-active'), makeValidActive('simple-active')]; break;
    case 7: frames = [badPassive, makeValidActive('mediated-active'), makeValidActive('valid-passive')]; break;
    default: throw new Error(`unknown holdout family ${familyIndex}`);
  }
  const allowedBoundaries = [', and ', ', and ', ', and ', ' but ', ', but ', '; ', '. '];
  const boundaries = [];
  for (let index = 0; index < frames.length - 1; index += 1) {
    const left = frames[index], right = frames[index + 1];
    const ambiguousBareAnd = left.type === 'malformed-passive'
      && (right.type === 'coordinated-active' || right.type === 'mediated-active' || right.type === 'malformed-active');
    const candidate = pick(allowedBoundaries);
    boundaries.push(ambiguousBareAnd && candidate === ' and ' ? ', and ' : candidate);
  }
  const context = pick(['', ' in photosynthesis', ' for photosynthesis']);
  const contextTarget = familyIndex === 5 ? Math.floor(random() * 2) : frames.length - 1;
  const text = frames.map((frame, index) => frame.text + (index === contextTarget ? context : '')).reduce((all, part, index) => all + (index ? boundaries[index - 1] : '') + part, '');
  const boundaryClass = (boundary) => boundary.includes('.') ? 'SENTENCE'
    : boundary.includes(';') || boundary.includes(':') ? 'HARD'
      : boundary.includes('but') ? 'BUT' : 'AND';
  const structuralKey = JSON.stringify({
    frames: frames.map((frame) => ({
      grammarShape: frame.grammarShape,
      orderedSubjects: frame.members.map((surface) => surface ? evaluator.normalizeExactFormLemmaV2(surface) : ''),
      coordinationType: frame.members.length > 1 ? 'AND' : 'SINGLE',
      cardinality: frame.members.length,
      malformed: frame.malformed,
      voice: frame.voice,
      verbLemma: frame.verbLemma,
      verbForm: frame.verbForm,
      modal: frame.modal,
      mediatedSubjects: frame.supportMembers.map((surface) => evaluator.normalizeExactFormLemmaV2(surface)),
    })),
    boundaryTopology: boundaries.map(boundaryClass),
  });
  return { text, frames, boundaries, structuralKey, familyIndex };
}

function assertMalformedPassiveHoldoutCase(item, api) {
  const result = api.evaluatePhotosynthesisRelationsV2(item.text);
  const frames = frameProjection(result);
  assert.equal(result.passed, false, item.text);
  assert.equal(result.hasMalformed, true, item.text);
  assert.equal(frames.length, item.frames.length, item.text);
  for (let index = 0; index < item.frames.length; index += 1) {
    const expected = item.frames[index], actual = frames[index];
    assert.equal(actual.frameId, index, item.text);
    assert.equal(actual.malformed, expected.malformed, item.text);
    assert.deepEqual(normalizedTopologyMembers(actual), expected.members.map((surface) => surface ? evaluator.normalizeExactFormLemmaV2(surface) : ''), item.text);
    assert.equal(actual.coordinationTopology[0].cardinality, expected.members.length, item.text);
    if (expected.malformed) {
      assert.ok(actual.records.every((record) => !record.qualifies), item.text);
      assert.equal(actual.records.some((record) => record.relationType === 'CHLOROPHYLL_SUPPORT' && record.qualifies), false, item.text);
    } else if (expected.voice === 'PASSIVE') {
      const core = actual.records.filter((record) => record.relationType === 'CORE_LIGHT_RELATION' && record.qualifies);
      assert.ok(core.length > 0, item.text);
      assert.ok(core.every((record) => record.voice === 'PASSIVE' && record.verbLemma === expected.verbLemma
        && record.verbForm === expected.verbForm && record.lightObject.binding === 'PASSIVE_SUBJECT'), item.text);
    } else {
      const core = actual.records.filter((record) => record.relationType === 'CORE_LIGHT_RELATION' && record.qualifies);
      assert.deepEqual(core.map((record) => record.subjectSet.surface).sort(), expected.members.slice().sort(), item.text);
      assert.ok(core.every((record) => record.voice === 'ACTIVE' && record.verbLemma === expected.verbLemma
        && record.verbForm === expected.verbForm), item.text);
      const support = actual.records.filter((record) => record.relationType === 'CHLOROPHYLL_SUPPORT' && record.qualifies);
      assert.deepEqual(support.map((record) => record.subjectSet.surface).sort(), expected.supportMembers.slice().sort(), item.text);
      assert.ok(support.every((record) => record.verbLemma === 'use' && record.verbForm === 'BASE'), item.text);
    }
  }
  return result;
}

test('fresh deterministic malformed-passive holdout covers 4,500 unique structural keys with source/package parity', async () => {
  const packaged = await packageEvaluator();
  const seeds = [0x63C7A291, 0xD48B5F06];
  const cases = [];
  const keys = new Set();
  const inputs = new Set();
  const familyCounts = Array(8).fill(0);
  const shapeCounts = Object.create(null);
  const boundaryCounts = Object.create(null);
  const contextCases = { in: 0, for: 0, none: 0 };
  for (const seed of seeds) {
    const random = holdoutRandom(seed);
    let accepted = 0;
    for (let attempts = 0; accepted < 2250; attempts += 1) {
      assert.ok(attempts < 200000, `holdout generator stalled for seed 0x${seed.toString(16)}`);
      const familyIndex = accepted % 8;
      const item = createMalformedPassiveHoldoutCase(random, familyIndex);
      if (keys.has(item.structuralKey) || inputs.has(item.text)) continue;
      keys.add(item.structuralKey);
      inputs.add(item.text);
      cases.push(item);
      familyCounts[familyIndex] += 1;
      shapeCounts[item.frames.find((frame) => frame.type === 'malformed-passive').shape] =
        (shapeCounts[item.frames.find((frame) => frame.type === 'malformed-passive').shape] || 0) + 1;
      for (const boundary of item.boundaries) {
        const type = boundary.includes(', and') ? 'comma-and' : boundary.includes(' but') ? 'but'
          : boundary.includes(';') ? 'semicolon' : boundary.includes('.') ? 'period' : 'plain-and';
        boundaryCounts[type] = (boundaryCounts[type] || 0) + 1;
      }
      if (item.text.includes(' in photosynthesis')) contextCases.in += 1;
      else if (item.text.includes(' for photosynthesis')) contextCases.for += 1;
      else contextCases.none += 1;
      accepted += 1;
    }
  }
  assert.equal(cases.length, 4500);
  assert.ok(keys.size >= 3500, `unique normalized structural keys ${keys.size} < 3500`);
  assert.equal(keys.size, cases.length, 'holdout structural keys must be unique');
  const failures = [];
  for (const item of cases) {
    try {
      const source = assertMalformedPassiveHoldoutCase(item, evaluator);
      const built = assertMalformedPassiveHoldoutCase(item, packaged);
      assert.deepEqual(built, source, item.text);
      assert.deepEqual(frameProjection(built), frameProjection(source), item.text);
      assert.equal(packaged.semanticCaseFingerprint(built), evaluator.semanticCaseFingerprint(source), item.text);
    } catch (error) {
      const sourceResult = evaluator.evaluatePhotosynthesisRelationsV2(item.text);
      const sourceFrames = frameProjection(sourceResult);
      failures.push({ family: item.familyIndex, shape: item.frames.find((frame) => frame.type === 'malformed-passive').shape, siblingTypes: item.frames.map((frame) => frame.type), input: item.text, error: error.message, actual: sourceFrames.map((frame) => ({ malformed: frame.malformed, members: normalizedTopologyMembers(frame), records: frame.records.map((record) => [record.relationType, record.qualifies, record.voice, record.verbLemma, record.verbForm]) })), expected: item.frames.map((frame) => ({ type: frame.type, malformed: frame.malformed, members: frame.members })) });
    }
  }
  const failureFamilies = Object.create(null);
  for (const failure of failures) { const key = `family-${failure.family}/${failure.shape}`; failureFamilies[key] = (failureFamilies[key] || 0) + 1; }
  console.log(`MALFORMED_PASSIVE_HOLDOUT ${JSON.stringify({ seeds: seeds.map((seed) => `0x${seed.toString(16).toUpperCase()}`), cases: cases.length, uniqueStructuralKeys: keys.size, familyCounts, shapeCounts, boundaryCounts, contextCases, materialFailures: failures.length, failureFamilies, examples: failures.slice(0, 24) })}`);
  assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 8)));
});