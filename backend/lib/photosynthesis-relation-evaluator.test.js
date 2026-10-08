'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  EXPECTED_GENERATED_CASE_COUNT,
  PHOTOSYNTHESIS_RELATION_CASES,
  canonicalCases,
  generatedV2Cases,
  b5SemanticSupplementCases,
} = require('./photosynthesis-relation-cases');
const { gradeCase } = require('./evaluation');
const {
  evaluatePhotosynthesisRelations,
  PHOTOSYNTHESIS_SEMANTIC_EVALUATOR_REGISTRY,
  evaluatePhotosynthesisRelationsV2,
  normalizeInputV2,
  tokenizeV2,
  extractSubjectSet,
  segmentSentencesV2,
  segmentClausesV2,
  semanticCaseFingerprint,
} = require('./photosynthesis-relation-evaluator');

const freshNouns = Object.freeze([
  'maples', 'cedars', 'willows', 'orchids', 'cattails', 'reeds', 'clovers', 'vines',
  'shrubs', 'seedlings', 'saplings', 'acorns', 'petals', 'roots', 'flowers', 'grains',
  'seeds', 'berries', 'herbs', 'grasses', 'leaves', 'stems', 'cones', 'lichens',
]);
const malformedTemplates = Object.freeze([
  ['initial', (noun) => `, and ${noun} and algae`],
  ['initial', (noun) => `, and plants and ${noun}`],
  ['initial', (noun) => `, and plants and algae and ${noun}`],
  ['initial', (noun) => `, ${noun} and algae`],
  ['initial', (noun) => `and , ${noun} and algae`],
  ['middle', (noun) => `plants, , and ${noun}`],
  ['middle', (noun) => `plants and , ${noun}`],
  ['middle', (noun) => `plants, and , ${noun}`],
  ['middle', (noun) => `plants, ${noun}, , and algae`],
  ['middle', (noun) => `plants, , and ${noun}, algae`],
  ['final', (noun) => `plants and ${noun}, ,`],
  ['final', (noun) => `plants and ${noun} and ,`],
]);
const coordinationTopologyCases = [];
for (const noun of freshNouns) {
  for (const [position, makeSubject] of malformedTemplates) {
    const subject = makeSubject(noun);
    const subjectVariants = [
      ['standard', subject],
      ['spaced', subject.replace(/,/g, ' , ').replace(/\s+/g, '   ')],
      ['linebreak', subject.replace(/\s+/g, '\n\t')],
    ];
    for (const [spacing, variant] of subjectVariants) {
      coordinationTopologyCases.push({
        position, noun, subject: variant, spacing, voice: 'active',
        input: `${variant} absorb sunlight.`,
      });
      coordinationTopologyCases.push({
        position, noun, subject: variant, spacing, voice: 'passive',
        input: `Sunlight is absorbed by ${variant} during photosynthesis.`,
      });
    }
  }
}
const coordinationBoundaryCases = [];
for (const noun of freshNouns) {
  const subject = `, and ${noun} and algae`;
  for (const [boundary, prefix] of [
    ['period', 'Plants capture light energy. '],
    ['semicolon', 'Plants capture light energy; '],
  ]) {
    for (const [spacing, variant] of [
      ['standard', subject],
      ['spaced', subject.replace(/,/g, ' , ').replace(/\s+/g, '   ')],
      ['linebreak', subject.replace(/\s+/g, '\n\t')],
    ]) {
      coordinationBoundaryCases.push({
        position: 'initial', noun, subject: variant, spacing, boundary, voice: 'active',
        input: `${prefix}${variant} absorb sunlight.`,
      });
      coordinationBoundaryCases.push({
        position: 'initial', noun, subject: variant, spacing, boundary, voice: 'passive',
        input: `${prefix}Sunlight is absorbed by ${variant} during photosynthesis.`,
      });
    }
  }
}
const coordinationValidControls = [];
for (const noun of freshNouns) {
  for (const [kind, continuation] of [
    ['plain', 'Plants and algae absorb sunlight.'],
    ['initial-and', 'And plants and algae absorb sunlight.'],
    ['initial-but', 'But plants and algae absorb sunlight.'],
  ]) coordinationValidControls.push({ noun, kind, input: `${noun} grow. ${continuation}` });
}
const optionalCommaControls = Object.freeze([
  'plants and algae', 'plants, and algae', 'plants, algae and plants', 'plants, algae, and plants',
]);

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

test('target-frame completeness is independent of clause and sentence boundary spelling', () => {
  const boundaries = [
    { name: 'semicolon', text: '; ', missingSubject: true },
    { name: 'period', text: '. ', missingSubject: true },
    { name: 'period-and', text: '. And ', missingSubject: true },
    { name: 'period-but', text: '. But ', missingSubject: true },
    { name: 'exclamation-and', text: '! And ', missingSubject: true },
    { name: 'question-but', text: '? But ', missingSubject: true },
    { name: 'same-clause-and', text: ' and ', missingSubject: false },
    { name: 'same-clause-but', text: ' but ', missingSubject: false },
  ];
  const frames = [
    { subject: 'Green plants', base: 'absorb', finite: 'absorb', singular: false },
    { subject: 'Algae', base: 'store', finite: 'store', singular: false },
    { subject: 'Some bacteria', base: 'convert', finite: 'convert', singular: false },
    { subject: 'A plant', base: 'capture', finite: 'captures', singular: true },
    { subject: 'Photosynthesis', base: 'use', finite: 'uses', singular: true },
  ];
  const first = 'Plants capture light energy';
  let inputs = 0, validFrames = 0, invalidFrames = 0, freshSubjectVerbPairs = 0;
  for (const boundary of boundaries) {
    for (const frame of frames) {
      const subject = boundary.text.includes('same-clause') ? frame.subject.toLowerCase() : frame.subject;
      const join = `${first}${boundary.text}`;
      const complete = `${join}${subject} ${frame.finite} light energy.`;
      const completeResult = evaluatePhotosynthesisRelationsV2(complete);
      assert.equal(completeResult.hasMalformed, false, `${boundary.name}: ${complete}`);
      assert.equal(completeResult.passed, true, `${boundary.name}: ${complete}`);
      inputs += 1; validFrames += 1;

      const auxiliary = frame.singular ? 'does not' : 'do not';
      for (const suffix of [
        `${subject} ${auxiliary} ${frame.base}.`,
        `${subject} does can ${frame.base} light energy.`,
        `${subject} ${frame.finite} light energy between.`,
      ]) {
        const input = `${join}${suffix}`;
        const result = evaluatePhotosynthesisRelationsV2(input);
        assert.equal(result.hasMalformed, true, `${boundary.name}: ${input}`);
        assert.equal(result.passed, false, `${boundary.name}: ${input}`);
        inputs += 1; invalidFrames += 1;
      }
      if (boundary.missingSubject) {
        const input = `${join}do not ${frame.base} light energy.`;
        const result = evaluatePhotosynthesisRelationsV2(input);
        assert.equal(result.hasMalformed, true, `${boundary.name}: ${input}`);
        assert.equal(result.passed, false, `${boundary.name}: ${input}`);
        inputs += 1; invalidFrames += 1;
      }
      freshSubjectVerbPairs += 1;
    }
  }
  assert.equal(inputs, 190);
  assert.equal(validFrames, 40);
  assert.equal(invalidFrames, 150);
  assert.equal(freshSubjectVerbPairs, 40);

  const localBinding = evaluatePhotosynthesisRelationsV2(
    'Plants store light energy; photosynthesis harnesses light energy but photosynthesis does not harness it.',
  );
  assert.equal(localBinding.passed, false);
  assert.equal(localBinding.hasMalformed, false);
  assert.equal(localBinding.contradictions.length, 1);
  assert.equal(localBinding.relationRecords.at(-1)?.lightObject?.binding, 'PRONOUN_ANTECEDENT');
  const resetBinding = evaluatePhotosynthesisRelationsV2(
    'Plants capture light energy; photosynthesis does not capture it.',
  );
  assert.equal(resetBinding.relationRecords.at(-1)?.lightObject?.binding, undefined);

  const unseenSubjects = ['Marmots', 'Quokkas', 'Puffins'];
  const explicitBoundaries = ['. ', '; ', '. And ', '. But ', '! And ', '? But '];
  let unseenSubjectFrames = 0;
  for (const subject of unseenSubjects) {
    for (const boundary of explicitBoundaries) {
      const input = `Plants capture light energy${boundary}${subject} do not store.`;
      const result = evaluatePhotosynthesisRelationsV2(input);
      assert.equal(result.hasMalformed, true, input);
      assert.equal(result.passed, false, input);
      unseenSubjectFrames += 1;
    }
  }
  assert.equal(unseenSubjectFrames, 18);
});

test('subject number is predicate-independent across fresh regular and compound plural families', () => {
  const pairs = [
    ['puffin', 'puffins'], ['tadpole', 'tadpoles'], ['narwhal', 'narwhals'],
    ['marmot', 'marmots'], ['salamander', 'salamanders'], ['gecko', 'geckos'],
    ['meerkat', 'meerkats'], ['lemur', 'lemurs'], ['wombat', 'wombats'],
    ['weevil', 'weevils'], ['lynx', 'lynxes'], ['goose', 'geese'],
    ['cactus', 'cacti'], ['booklouse', 'booklice'],
  ];
  const formsFor = (singular, plural) => [
    [`${plural} capture light energy.`, `${plural} captures light energy.`],
    [`${plural} do capture light energy.`, `${plural} does capture light energy.`],
    [`${plural} do not capture light energy.`, `${plural} does not capture light energy.`],
    [`${plural} have captured light energy.`, `${plural} has captured light energy.`],
    [`${plural} do not fail to capture light energy.`, `${plural} does not fail to capture light energy.`],
    [`${singular} captures light energy.`, `${singular} capture light energy.`],
    [`${singular} does capture light energy.`, `${singular} do capture light energy.`],
    [`${singular} does not capture light energy.`, `${singular} do not capture light energy.`],
    [`${singular} has captured light energy.`, `${singular} have captured light energy.`],
    [`${singular} does not fail to capture light energy.`, `${singular} do not fail to capture light energy.`],
  ];
  let inputs = 0, correct = 0, incorrect = 0, lexicalComparisons = 0;
  for (const [singular, plural] of pairs) {
    const pluralForms = formsFor(singular, plural).slice(0, 5);
    const singularForms = formsFor(singular, plural).slice(5);
    for (const [good, bad] of [...pluralForms, ...singularForms]) {
      const goodResult = evaluatePhotosynthesisRelationsV2(good);
      const badResult = evaluatePhotosynthesisRelationsV2(bad);
      assert.equal(goodResult.hasMalformed, false, good);
      assert.equal(badResult.hasMalformed, true, bad);
      inputs += 2; correct += 1; incorrect += 1;
    }
    const modalPlural = `${plural} can capture light energy.`;
    const modalSingular = `${singular} can capture light energy.`;
    assert.equal(evaluatePhotosynthesisRelationsV2(modalPlural).hasMalformed, false, modalPlural);
    assert.equal(evaluatePhotosynthesisRelationsV2(modalSingular).hasMalformed, false, modalSingular);
    assert.equal(semanticCaseFingerprint(modalPlural), semanticCaseFingerprint(
      `${pairs[0][1]} can capture light energy.`,
    ));
    inputs += 2; correct += 2; lexicalComparisons += 1;
  }

  for (const input of [
    'Plants and algae do capture light energy.',
    'Marmots and narwhals do capture light energy.',
    'Plants and algae does capture light energy.',
    'Marmots and narwhals does capture light energy.',
    'A narwhal does capture light energy.',
    'A narwhals does capture light energy.',
    'The narwhals do capture light energy.',
    'The narwhals does capture light energy.',
  ]) {
    const malformed = /does capture/.test(input) && /and|narwhals/.test(input)
      || input === 'A narwhals does capture light energy.';
    assert.equal(evaluatePhotosynthesisRelationsV2(input).hasMalformed, malformed, input);
    inputs += 1;
    if (malformed) incorrect += 1;
    else correct += 1;
  }
  assert.equal(evaluatePhotosynthesisRelationsV2('Quokka do capture light energy.').hasMalformed, true);
  assert.equal(evaluatePhotosynthesisRelationsV2('Quokka does capture light energy.').hasMalformed, false);
  const alice = evaluatePhotosynthesisRelationsV2('Alice does capture light energy.');
  const david = evaluatePhotosynthesisRelationsV2('David does capture light energy.');
  assert.equal(alice.hasMalformed, false);
  assert.equal(evaluatePhotosynthesisRelationsV2('Alice do capture light energy.').hasMalformed, true);
  assert.equal(semanticCaseFingerprint('Alice does capture light energy.'),
    semanticCaseFingerprint('David does capture light energy.'));
  inputs += 5; correct += 3; incorrect += 2;
  assert.equal(inputs, 321);
  assert.equal(correct, 175);
  assert.equal(incorrect, 146);
  assert.ok(inputs >= 100, `generated ${inputs} subject-number inputs`);
  assert.equal(correct + incorrect, inputs);
  assert.equal(lexicalComparisons, pairs.length);
});

test('a malformed coordinated member invalidates the whole active or passive noun phrase', () => {
  const valid = [
    'plants and algae', 'plants and the algae', 'the plants and algae',
    'the plants and the algae', 'algae and mosses', 'narwhals and puffins',
    'the narwhals and the puffins', 'a narwhal and some puffins',
  ];
  let validCases = 0, malformedCases = 0, emptyMemberCases = 0, generatedAttacks = 0;
  for (const subject of valid) {
    for (const input of [`${subject} absorb light energy.`, `Light energy is absorbed by ${subject} during photosynthesis.`]) {
      const result = evaluatePhotosynthesisRelationsV2(input);
      assert.equal(result.hasMalformed, false, input);
      if (/plants|algae/.test(subject) && !/mosses/.test(subject)) assert.equal(result.passed, true, input);
      validCases += 1;
    }
  }
  const invalid = [
    'plants and', 'plants and the', 'plants and a', 'plants and an', 'plants and some',
    'plants and the the algae', 'the the plants and algae', 'plants and and algae',
    'plants and , algae', 'plants and absorb', 'plants and the absorb',
  ];
  for (const subject of invalid) {
    for (const input of [`${subject} absorb light energy.`, `Light energy is absorbed by ${subject} during photosynthesis.`]) {
      const result = evaluatePhotosynthesisRelationsV2(input);
      assert.equal(result.hasMalformed, true, input);
      assert.equal(result.passed, false, input);
      malformedCases += 1;
      if (/and\s*$|^and\s|and\s+,|and\s+and/.test(subject)) emptyMemberCases += 1;
    }
  }
  const firstMembers = [
    'plants', 'algae', 'green plants', 'some bacteria', 'photosynthesis', 'chlorophyll',
    'a plant', 'the algae', 'narwhals', 'the geckos', 'beetles', 'some mosses', 'a fern',
  ];
  for (const first of firstMembers) {
    for (const determiner of ['the', 'a', 'an', 'some']) {
      const subject = `${first} and ${determiner}`;
      for (const input of [`${subject} absorb light energy.`, `Light energy is absorbed by ${subject} during photosynthesis.`]) {
        const result = evaluatePhotosynthesisRelationsV2(input);
        assert.equal(result.hasMalformed, true, input);
        assert.equal(result.passed, false, input);
        generatedAttacks += 1;
      }
    }
  }
  assert.equal(validCases, 16);
  assert.equal(generatedAttacks, 104);
  assert.ok(malformedCases >= 20);
  assert.ok(emptyMemberCases > 0);
  for (const input of [
    'Light energy is absorbed by and plants during photosynthesis.',
    'Plants capture light energy and , algae absorb sunlight.',
  ]) {
    const result = evaluatePhotosynthesisRelationsV2(input);
    assert.equal(result.hasMalformed, true, input);
    assert.equal(result.passed, false, input);
    emptyMemberCases += 1;
  }
  assert.equal(malformedCases, 22);
  assert.equal(emptyMemberCases, 8);
});

test('empty coordinated member topology survives comma normalization in active and passive noun phrases', () => {
  const malformedSubjects = [
    'plants, , and algae',
    'narwhals, , and plants',
    'plants and , quokkas',
    'wombats, and , plants',
    'plants, , algae',
    'puffins and , plants',
    'plants and ,',
    ', geckos and plants',
    'plants, , and quokkas, green plants',
    'plants, algae, , and wombats',
  ];
  const freshNouns = new Set(['narwhals', 'quokkas', 'wombats', 'puffins', 'geckos']);
  const validCommaControls = [
    'plants and algae',
    'plants, and algae',
    'plants, algae and green plants',
    'plants, algae, and green plants',
  ];
  let emptyMemberAttacks = 0, validControls = 0;
  for (const noun of freshNouns) assert.ok(malformedSubjects.some((subject) => subject.includes(noun)), noun);

  for (const subject of malformedSubjects) {
    const normalizedSubject = normalizeInputV2(subject);
    const tokens = tokenizeV2(normalizedSubject);
    const members = extractSubjectSet(tokens, tokens.length);
    assert.equal(members.shapeValid, false, subject);
    assert.ok(members.members.length >= 2, subject);
    for (const input of [
      `${subject} absorb sunlight.`,
      `Sunlight is absorbed by ${subject} during photosynthesis.`,
    ]) {
      const result = evaluatePhotosynthesisRelationsV2(input);
      assert.equal(result.hasMalformed, true, input);
      assert.equal(result.passed, false, input);
      emptyMemberAttacks += 1;
    }
  }

  for (const subject of validCommaControls) {
    const active = evaluatePhotosynthesisRelationsV2(`${subject} absorb sunlight.`);
    const passive = evaluatePhotosynthesisRelationsV2(`Sunlight is absorbed by ${subject} during photosynthesis.`);
    for (const result of [active, passive]) {
      assert.equal(result.hasMalformed, false, subject);
      assert.equal(result.passed, true, subject);
      validControls += 1;
    }
  }

  assert.equal(freshNouns.size, 5);
  assert.equal(emptyMemberAttacks, 20);
  assert.equal(validControls, 8);
});

test('ASTRA-BOUNDED-FINAL-002 validates raw coordination topology before normalization', () => {
  const active = evaluatePhotosynthesisRelationsV2(', and plants and algae absorb sunlight.');
  assert.equal(active.passed, false);
  assert.equal(active.hasMalformed, true);
  const activeTopology = active.coordinationTopology.find((group) => group.shapeValid === false);
  assert.ok(activeTopology);
  assert.deepEqual(activeTopology.rawMembers, ['', 'plants', 'algae']);
  assert.equal(activeTopology.cardinality, 3);
  assert.equal(activeTopology.type, 'AND');

  const passive = evaluatePhotosynthesisRelationsV2(
    'Sunlight is absorbed by , and plants and algae during photosynthesis.',
  );
  assert.equal(passive.passed, false);
  assert.equal(passive.hasMalformed, true);
  const passiveTopology = passive.coordinationTopology.find((group) => group.shapeValid === false);
  assert.deepEqual(passiveTopology?.rawMembers, ['', 'plants', 'algae']);
  assert.equal(passiveTopology?.cardinality, 3);
});

test('root invariant 006 mutation: preprocessing before raw topology validation salvages malformed frames', () => {
  const source = readFileSync(join(__dirname, 'photosynthesis-relation-evaluator.js'), 'utf8').replace(/\r\n/g, '\n');
  const anchor = 'frame.rawStructuralAnalysis = analyzePreNormalizationCoordinationV2(frame);';
  assert.equal(source.split(anchor).length, 2, 'raw-topology mutation anchor must occur once');
  const mutantSource = source.replace(anchor, 'frame.rawStructuralAnalysis = [];');
  const module = { exports: {} };
  new Function('require', 'module', 'exports', mutantSource)(require, module, module.exports);
  const attacks = [...coordinationTopologyCases, ...coordinationBoundaryCases];
  let violations = 0;
  for (const { input } of attacks) {
    const expected = evaluatePhotosynthesisRelationsV2(input);
    assert.equal(expected.hasMalformed, true, input);
    assert.equal(expected.passed, false, input);
    const result = module.exports.evaluatePhotosynthesisRelationsV2(input);
    if (!result.hasMalformed || result.passed
      || !result.coordinationTopology.some((group) => group.shapeValid === false)) violations += 1;
  }
  assert.ok(violations >= 100, `destructive preprocessing mutant violations=${violations}`);
});

test('coordination topology properties cover full source and committed-package evaluator paths', async () => {
  const { createDerivedEvaluator } = await import('../scripts/run-photosynthesis-relation-mutations.mjs');
  const packaged = createDerivedEvaluator().evaluatePhotosynthesisRelationsV2;
  const generatedAttacks = [...coordinationTopologyCases, ...coordinationBoundaryCases];
  const positionCounts = { initial: 0, middle: 0, final: 0 };
  let activePassivePairs = 0;
  let validControlCount = 0;

  for (const attack of generatedAttacks) {
    const source = evaluatePhotosynthesisRelationsV2(attack.input);
    assert.equal(source.passed, false, attack.input);
    assert.equal(source.hasMalformed, true, attack.input);
    const invalidTopology = source.coordinationTopology.find((group) => group.shapeValid === false);
    assert.ok(invalidTopology, attack.input);
    assert.equal(invalidTopology.cardinality, invalidTopology.rawMembers.length, attack.input);
    assert.deepEqual(packaged(attack.input), source, `source/package: ${attack.input}`);
    positionCounts[attack.position] += 1;
  }

  for (let index = 0; index < coordinationTopologyCases.length; index += 2) {
    const activeCase = coordinationTopologyCases[index];
    const passiveCase = coordinationTopologyCases[index + 1];
    assert.equal(activeCase.voice, 'active');
    assert.equal(passiveCase.voice, 'passive');
    const activeResult = evaluatePhotosynthesisRelationsV2(activeCase.input);
    const passiveResult = evaluatePhotosynthesisRelationsV2(passiveCase.input);
    assert.equal(activeResult.hasMalformed, passiveResult.hasMalformed, activeCase.subject);
    assert.equal(activeResult.passed, passiveResult.passed, activeCase.subject);
    activePassivePairs += 1;
  }

  for (const control of coordinationValidControls) {
    const source = evaluatePhotosynthesisRelationsV2(control.input);
    assert.equal(source.passed, true, control.input);
    assert.equal(source.hasMalformed, false, control.input);
    assert.deepEqual(packaged(control.input), source, `source/package: ${control.input}`);
    validControlCount += 1;
  }

  for (const subject of optionalCommaControls) {
    for (const input of [
      `${subject} absorb sunlight.`,
      `Sunlight is absorbed by ${subject} during photosynthesis.`,
    ]) {
      const source = evaluatePhotosynthesisRelationsV2(input);
      assert.equal(source.passed, true, input);
      assert.equal(source.hasMalformed, false, input);
      assert.deepEqual(packaged(input), source, `source/package: ${input}`);
      validControlCount += 1;
    }
  }

  assert.equal(freshNouns.length, 24);
  assert.ok(positionCounts.initial >= 100, `initial-empty cases=${positionCounts.initial}`);
  assert.ok(positionCounts.middle >= 100, `middle-empty cases=${positionCounts.middle}`);
  assert.ok(positionCounts.final >= 50, `final-empty cases=${positionCounts.final}`);
  assert.ok(activePassivePairs >= 50, `active/passive pairs=${activePassivePairs}`);
  assert.ok(validControlCount >= 50, `valid controls=${validControlCount}`);
  assert.ok(generatedAttacks.length + validControlCount >= 300);
});

test('terminal punctuation is cosmetic while genuine inter-proposition topology remains semantic', () => {
  const corpus = [...canonicalCases, ...generatedV2Cases, ...b5SemanticSupplementCases];
  assert.equal(corpus.length, 206);
  let corpusPairs = 0, corpusVariants = 0, freshVariants = 0;
  for (const item of corpus) {
    const base = item.text.replace(/[.!?]+\s*$/, '');
    const fingerprint = semanticCaseFingerprint(base);
    assert.equal(semanticCaseFingerprint(item.text), fingerprint, item.id);
    corpusPairs += 1;
    for (const punctuation of ['.', '!', '?']) {
      assert.equal(semanticCaseFingerprint(`${base}${punctuation}`), fingerprint, `${item.id}${punctuation}`);
      corpusVariants += 1;
    }
  }
  const malformedHeads = [
    'pademelons', 'cormorants', 'pipits', 'sundews', 'yews', 'sculpins', 'wallabies',
    'kingfishers', 'warthogs', 'barracudas', 'leafhoppers', 'puffbirds', 'marmosets',
    'tamarins', 'lorikeets', 'woodpeckers', 'terns', 'dunlins', 'warblers', 'gannets',
  ];
  for (const head of malformedHeads) {
    const base = `A ${head} light energy capture chlorophyll`;
    const fingerprint = semanticCaseFingerprint(base);
    for (const punctuation of ['', '.', '!', '?', '..', '...', '!?', '?!']) {
      assert.equal(semanticCaseFingerprint(`${base}${punctuation}`), fingerprint, `${head}${punctuation}`);
      freshVariants += 1;
    }
  }
  assert.equal(corpusPairs, 206);
  assert.equal(corpusVariants, 618);
  assert.equal(freshVariants, 160);

  const first = 'Plants capture light energy';
  const second = 'Algae absorb sunlight';
  const sentenceBoundaries = ['. ', '! ', '? '].map((mark) =>
    semanticCaseFingerprint(`${first}${mark}${second}.`));
  assert.equal(new Set(sentenceBoundaries).size, 1);
  const sameClause = semanticCaseFingerprint(`${first} and algae absorb sunlight.`);
  assert.notEqual(sentenceBoundaries[0], sameClause);
  for (const conjunction of ['And', 'But']) {
    const discourse = semanticCaseFingerprint(`${first}. ${conjunction} algae absorb sunlight.`);
    assert.notEqual(discourse, sameClause);
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

test('light aliases retain their grammatical role in descriptive propositions', () => {
  for (const boundary of ['.', ';', '?!']) {
    for (const tail of ['exists.', 'is present.', 'is nearby.']) {
      const prefix = `Photosynthesis converts chemicals${boundary} `;
      assert.equal(semanticCaseFingerprint(`${prefix}light energy ${tail}`),
        semanticCaseFingerprint(`${prefix}sunlight ${tail}`));
    }
  }
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


// Frame lifecycle composition properties and source/package parity.
(function frameLifecycleCompositionSuite() {
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

const mediatedTargets = Object.freeze(['capture', 'absorb', 'harness', 'use', 'convert', 'transform', 'store']);
const mediatedLightObjects = Object.freeze(['light', 'the light', 'light energy', 'the light energy', 'sunlight', 'solar energy', 'solar light']);
const mediatedSubjectPairs = Object.freeze([
  ['plants', 'algae'],
  ['green plants', 'some bacteria'],
  ['photosynthesis', 'plants'],
  ['chlorophyll', 'green plants'],
]);
const malformedMediatedShapes = Object.freeze([
  { id: 'initial-empty', make: (a, b) => `, and ${a} and ${b}`, members: (a, b) => ['', a, b], coordinator: 'AND' },
  { id: 'middle-empty', make: (a, b) => `${a}, , and ${b}`, members: (a, b) => [a, '', b], coordinator: 'AND' },
  { id: 'final-empty', make: (a, b) => `${a} and ${b} and`, members: (a, b) => [a, b, ''], coordinator: 'AND' },
  { id: 'determiner-only', make: (a) => `${a} and the`, members: (a) => [a, ''], coordinator: 'AND' },
]);
const mediatedChains = Object.freeze([
  { id: 'present-plural', surface: 'use', validSubject: 'Plants and algae', expectedPass: true, expectedPolarity: 'AFFIRMED' },
  { id: 'present-singular', surface: 'uses', validSubject: 'Photosynthesis', expectedPass: true, expectedPolarity: 'AFFIRMED' },
  { id: 'past', surface: 'used', validSubject: 'Plants and algae', expectedPass: true, expectedPolarity: 'AFFIRMED' },
  { id: 'modal', surface: 'may use', validSubject: 'Photosynthesis', expectedPass: false, expectedPolarity: 'UNCERTAIN' },
  { id: 'control', surface: 'does not fail to use', validSubject: 'Photosynthesis', expectedPass: true, expectedPolarity: 'AFFIRMED' },
]);
const malformedMediatedCases = [];
for (const shape of malformedMediatedShapes) {
  for (const chain of mediatedChains) {
    for (const target of mediatedTargets) {
      for (const object of mediatedLightObjects) {
        const index = malformedMediatedCases.length;
        const [first, second] = mediatedSubjectPairs[index % mediatedSubjectPairs.length];
        const subject = shape.make(first, second);
        malformedMediatedCases.push({
          id: `${shape.id}/${chain.id}/${target}/${object}`,
          shape,
          chain,
          target,
          object,
          rawMembers: shape.members(first, second),
          text: `${subject} ${chain.surface} chlorophyll to ${target} ${object}`,
        });
      }
    }
  }
}

test('ASTRA-FINAL-FRAME-001 rejects raw initial-empty mediated subject before normalization', () => {
  const malformedText = ', and green plants and algae use chlorophyll to harness solar energy.';
  const malformed = evaluatePhotosynthesisRelationsV2(malformedText);
  const validText = 'Green plants and algae use chlorophyll to harness solar energy.';
  const valid = evaluatePhotosynthesisRelationsV2(validText);
  const rawTopology = malformed.coordinationTopology.find((group) => group.shapeValid === false);

  assert.equal(malformed.passed, false);
  assert.equal(malformed.hasMalformed, true);
  assert.deepEqual(rawTopology?.rawMembers, ['', 'green plants', 'algae']);
  assert.equal(rawTopology?.cardinality, 3);
  assert.equal(valid.passed, true);
  assert.equal(valid.hasMalformed, false);
  assert.notEqual(semanticCaseFingerprint(malformedText), semanticCaseFingerprint(validText));
  assert.ok(malformed.relationRecords.length > 0);
  assert.equal(malformed.relationRecords.every((record) => !record.qualifies
    && record.rejectionReasons.includes('GRAMMAR_SHAPE_NOT_ACCEPTED')), true);
});

test('raw malformed subject topology is attached once across coordinated target predicates', () => {
  for (const input of [
    'plants, , and algae absorb sunlight and harness solar energy',
    'plants, , and algae absorb sunlight and use chlorophyll to harness solar energy',
  ]) {
    const result = evaluatePhotosynthesisRelationsV2(input);
    const malformed = result.coordinationTopology.filter((group) => group.shapeValid === false);

    assert.equal(result.passed, false, input);
    assert.equal(result.hasMalformed, true, input);
    assert.equal(malformed.length, 1, input);
    assert.equal(malformed[0].type, 'AND', input);
    assert.deepEqual(malformed[0].rawMembers, ['plants', '', 'algae'], input);
  }
});

test('terminal subject coordinators retain their raw AND, OR, or RATHER_THAN topology', async () => {
  const { createDerivedEvaluator } = await import(pathToFileURL(join(
    __dirname, '..', 'scripts', 'run-photosynthesis-relation-mutations.mjs',
  )).href);
  const packaged = createDerivedEvaluator().evaluatePhotosynthesisRelationsV2;

  for (const [separator, type] of [['and', 'AND'], ['or', 'OR'], ['rather than', 'RATHER_THAN']]) {
    const input = `plants ${separator} use chlorophyll to harness solar energy`;
    const result = evaluatePhotosynthesisRelationsV2(input);
    const topology = result.coordinationTopology.find((group) => group.shapeValid === false);

    assert.equal(result.passed, false, separator);
    assert.deepEqual(topology?.rawMembers, ['plants', ''], separator);
    assert.equal(topology?.cardinality, 2, separator);
    assert.equal(topology?.type, type, separator);
    assert.deepEqual(packaged(input), result, `${separator}: source/package parity`);
  }
});

test('supported mediated chains retain malformed raw subject topology and valid controls', async (t) => {
  const { createDerivedEvaluator } = await import(pathToFileURL(join(
    __dirname, '..', 'scripts', 'run-photosynthesis-relation-mutations.mjs',
  )).href);
  const packaged = createDerivedEvaluator().evaluatePhotosynthesisRelationsV2;
  const failures = [];
  const packageMismatches = [];

  assert.equal(malformedMediatedCases.length, 980);
  for (const item of malformedMediatedCases) {
    const result = evaluatePhotosynthesisRelationsV2(item.text);
    const topology = result.coordinationTopology.find((group) => group.shapeValid === false);
    const validText = `${item.chain.validSubject} ${item.chain.surface} chlorophyll to ${item.target} ${item.object}`;
    const valid = evaluatePhotosynthesisRelationsV2(validText);
    const supportRecords = valid.relationRecords.filter((record) => record.relationType === 'CHLOROPHYLL_SUPPORT'
      && record.verbLemma === 'use');
    const targetRecords = valid.relationRecords.filter((record) => record.relationType === 'CORE_LIGHT_RELATION'
      && record.verbLemma === item.target);
    const expectedControl = item.chain.id === 'control' ? 'NOT_FAIL_TO' : null;
    const expectedModal = item.chain.id === 'modal' ? 'may' : null;
    const expectedMediatorForm = item.chain.surface.endsWith('used') ? 'PAST'
      : item.chain.surface.endsWith('uses') ? 'PRESENT_3SG' : 'BASE';
    const expectedRecordCount = item.chain.validSubject.includes(' and ') ? 2 : 1;
    const mediationSemanticsValid = supportRecords.length === expectedRecordCount
      && targetRecords.length === expectedRecordCount
      && [...supportRecords, ...targetRecords].every((record) => record.qualifies === item.chain.expectedPass
        && record.polarity === item.chain.expectedPolarity
        && record.processContext === 'EXPLICIT_SUBJECT'
        && (record.controlChain?.type || null) === expectedControl
        && record.modal === expectedModal)
      && supportRecords.every((record) => record.directObject?.role === 'CHLOROPHYLL'
        && record.instrumentSet?.lemma === 'chlorophyll'
        && record.verbForm === expectedMediatorForm
        && record.lightObject?.normalized === 'light-energy'
        && record.lightObject?.binding === 'DIRECT_OBJECT')
      && targetRecords.every((record) => record.directObject?.role === 'LIGHT_OBJECT'
        && record.directObject?.normalized === 'light-energy'
        && record.lightObject?.normalized === 'light-energy'
        && record.lightObject?.binding === 'DIRECT_OBJECT')
      && valid.positiveLightEnergy === item.chain.expectedPass
      && valid.positiveChlorophyllBinding === item.chain.expectedPass
      && valid.invalidChlorophyllClaims.length === 0;
    const issues = [
      ...(result.passed ? ['passed'] : []),
      ...(!result.hasMalformed ? ['not-malformed'] : []),
      ...(!topology ? ['missing-raw-topology'] : []),
      ...(topology && topology.cardinality !== item.rawMembers.length ? ['cardinality'] : []),
      ...(topology && JSON.stringify(topology.rawMembers) !== JSON.stringify(item.rawMembers) ? ['raw-members'] : []),
      ...(result.relationRecords.some((record) => record.qualifies
        || !record.rejectionReasons.includes('GRAMMAR_SHAPE_NOT_ACCEPTED')) ? ['relation-locality'] : []),
      ...(topology && topology.type !== item.shape.coordinator ? ['coordinator'] : []),
      ...(semanticCaseFingerprint(item.text) === semanticCaseFingerprint(validText) ? ['fingerprint-collision'] : []),
      ...(valid.passed !== item.chain.expectedPass || valid.hasMalformed
        || valid.polarity !== item.chain.expectedPolarity ? ['valid-control'] : []),
      ...(!mediationSemanticsValid ? ['mediation-semantics'] : []),
    ];
    if (issues.length) {
      failures.push({ id: item.id, issues, passed: result.passed, hasMalformed: result.hasMalformed,
        topology: topology && { cardinality: topology.cardinality, rawMembers: topology.rawMembers },
        validControl: { passed: valid.passed, hasMalformed: valid.hasMalformed, polarity: valid.polarity } });
    }
    try {
      assert.deepEqual(packaged(item.text), result, `${item.id}: source/package parity`);
      assert.deepEqual(packaged(validText), valid, `${item.id}: valid source/package parity`);
    } catch {
      packageMismatches.push(item.id);
    }
  }

  assert.equal(failures.length, 0,
    `mediated raw-structure failures: ${JSON.stringify({ count: failures.length, first: failures.slice(0, 8) })}`);
  assert.equal(packageMismatches.length, 0,
    `source/package mismatches: ${JSON.stringify({ count: packageMismatches.length, first: packageMismatches.slice(0, 8) })}`);
  t.diagnostic('standalone malformed mediated cases=980; supported valid-control cases=245; source/package parity=1960');
});

test('mediated raw-topology properties kill validation bypass, wrong subject end, and dropped attachment mutations', (t) => {
  const source = readFileSync(join(__dirname, 'photosynthesis-relation-evaluator.js'), 'utf8').replace(/\r\n/g, '\n');
  const loadMutant = (before, after, label) => {
    assert.equal(source.split(before).length, 2, `${label} mutation anchor must occur once`);
    const module = { exports: {} };
    new Function('require', 'module', 'exports', source.replace(before, after))(require, module, module.exports);
    return module.exports.evaluatePhotosynthesisRelationsV2;
  };
  const bypass = loadMutant(
    "addMalformedFrame('ACTIVE',predicate.lemma,subject);",
    "if(!tokens.some((token,index)=>token.form==='chlorophyll'&&tokens[index+1]?.form==='to'))addMalformedFrame('ACTIVE',predicate.lemma,subject);",
    'mediated-validation-bypass',
  );
  const wrongSubjectEnd = loadMutant(
    'if(!isTargetRelationFrameV2(tokens,predicateIndex))continue;',
    'if(subject.end!==predicateIndex||!isTargetRelationFrameV2(tokens,predicateIndex))continue;',
    'downstream-subject-end',
  );
  const droppedAttachment = loadMutant(
    'frame.rawStructuralAnalysis = analyzePreNormalizationCoordinationV2(frame);',
    "const rawFindings = analyzePreNormalizationCoordinationV2(frame);\n    if(rawFindings.length)diagnostics.push('RAW_FINDING_DROPPED');\n    frame.rawStructuralAnalysis = [];",
    'raw-finding-attachment',
  );
  const attributableKills = { bypass: 0, wrongSubjectEnd: 0, droppedAttachment: 0 };
  let droppedFindingsProduced = 0;
  const checkMutation = (evaluate, item, key, requireProduced = false) => {
    const result = evaluate(item.text);
    const topology = result.coordinationTopology.find((group) => group.shapeValid === false);
    if (requireProduced && result.diagnostics.includes('RAW_FINDING_DROPPED')) droppedFindingsProduced += 1;
    if (result.passed || !result.hasMalformed || !topology
      || topology.cardinality !== item.rawMembers.length
      || JSON.stringify(topology.rawMembers) !== JSON.stringify(item.rawMembers)) {
      attributableKills[key] += 1;
    }
  };

  for (const item of malformedMediatedCases) {
    checkMutation(bypass, item, 'bypass');
    checkMutation(wrongSubjectEnd, item, 'wrongSubjectEnd');
    checkMutation(droppedAttachment, item, 'droppedAttachment', true);
  }

  for (const [id, count] of Object.entries(attributableKills)) {
    assert.ok(count >= 256, `${id} attributable property kills=${count}`);
  }
  assert.equal(droppedFindingsProduced, malformedMediatedCases.length,
    'raw analyzer produced a finding for every case before the mutation discarded attachment');
  t.diagnostic(`attributable kills: bypass=${attributableKills.bypass}; wrong-subject-end=${attributableKills.wrongSubjectEnd}; dropped-attachment=${attributableKills.droppedAttachment}; dropped-findings-produced=${droppedFindingsProduced}`);
});

function assertMediatedComposition(frames, joins, label) {
  const singles = frames.map((frame) => evaluatePhotosynthesisRelationsV2(frame));
  let input = frames[0];
  for (let index = 1; index < frames.length; index += 1) input += joins[index - 1] + frames[index];
  const composed = evaluatePhotosynthesisRelationsV2(input);
  const malformed = singles.some((result) => result.hasMalformed);
  assert.equal(composed.hasMalformed, malformed, label + ': document malformed aggregate');
  assert.equal(composed.passed, !malformed && singles.some((result) => result.passed),
    label + ': document pass aggregate');

  const sortSignatures = (records) => records.map((record) => {
    const span = record.evidenceSpan;
    const endsSentence = span?.text.endsWith('.');
    const normalizedSpan = span && endsSentence
      ? { ...span, end: span.end - 1, text: span.text.slice(0, -1) }
      : span;
    return JSON.stringify({ ...record, evidenceSpan: normalizedSpan });
  }).sort();
  const expectedRecords = singles.flatMap((result) => result.relationRecords);
  assert.deepEqual(sortSignatures(composed.relationRecords), sortSignatures(expectedRecords),
    label + ': relation records retain each frame-local result and multiplicity');
  const expectedTopology = singles.flatMap((result) => result.coordinationTopology.map(topologySignature));
  assert.deepEqual(composed.coordinationTopology.map(topologySignature), expectedTopology,
    label + ': topology remains ordered and frame-local');
}

test('mediated malformed frames preserve sibling and document state across compositions', async (t) => {
  const { createDerivedEvaluator } = await import(pathToFileURL(join(
    __dirname, '..', 'scripts', 'run-photosynthesis-relation-mutations.mjs',
  )).href);
  const packaged = createDerivedEvaluator().evaluatePhotosynthesisRelationsV2;
  const validSimple = 'plants and algae absorb sunlight';
  const semicolonCases = [];
  for (const item of malformedMediatedCases) {
    semicolonCases.push({ frames: [validSimple, item.text], joins: ['; '], label: `simple-first/${item.id}` });
    semicolonCases.push({ frames: [item.text, validSimple], joins: ['; '], label: `simple-last/${item.id}` });
  }
  assert.equal(semicolonCases.length, 1960);

  for (const item of semicolonCases) {
    assertMediatedComposition(item.frames, item.joins, item.label);
    assertSourcePackageParity(item.frames, item.joins, item.label, packaged);
  }

  const mediatedByKey = new Map(malformedMediatedCases.map((item) => [
    `${item.shape.id}/${item.target}/light energy`, item,
  ]));
  let mediatedSiblingCases = 0;
  let threeFrameCases = 0;
  for (const shape of malformedMediatedShapes) {
    for (const target of mediatedTargets) {
      const malformed = mediatedByKey.get(`${shape.id}/${target}/light energy`);
      const validMediated = `plants and algae use chlorophyll to ${target} light energy`;
      const mediatedPairs = [
        { frames: [validMediated, malformed.text], joins: ['; '] },
        { frames: [malformed.text, validMediated], joins: ['; '] },
      ];
      for (const [index, item] of mediatedPairs.entries()) {
        const label = `mediated-sibling-${index}/${shape.id}/${target}`;
        assertMediatedComposition(item.frames, item.joins, label);
        assertSourcePackageParity(item.frames, item.joins, label, packaged);
        mediatedSiblingCases += 1;
      }

      const validSimple = 'plants and algae absorb sunlight';
      const orders = [
        [validSimple, validMediated, malformed.text],
        [validMediated, malformed.text, validSimple],
        [malformed.text, validMediated, validSimple],
      ];
      for (const [index, frames] of orders.entries()) {
        const joins = ['; ', '; '];
        const label = `three-frame-${index}/${shape.id}/${target}`;
        assertMediatedComposition(frames, joins, label);
        assertSourcePackageParity(frames, joins, label, packaged);
        threeFrameCases += 1;
      }
    }
  }

  const crossSentenceCases = [];
  const sentenceJoins = ['. ', '. And ', '. But '];
  for (const shape of malformedMediatedShapes) {
    for (const target of mediatedTargets) {
      const malformed = mediatedByKey.get(`${shape.id}/${target}/light energy`).text;
      for (const [index, join] of sentenceJoins.entries()) {
        const frames = index % 2 ? [validSimple, malformed] : [malformed, validSimple];
        crossSentenceCases.push({ frames, joins: [join], label: `cross-sentence-${index}/${shape.id}/${target}` });
      }
    }
  }
  for (const item of crossSentenceCases) {
    assertMediatedComposition(item.frames, item.joins, item.label);
    assertSourcePackageParity(item.frames, item.joins, item.label, packaged);
  }

  assert.equal(mediatedSiblingCases, 56);
  assert.equal(threeFrameCases, 84);
  assert.equal(crossSentenceCases.length, 84);
  t.diagnostic('composed malformed mediated cases=1960; mediated siblings=56; three-frame cases=84; cross-sentence cases=84; source/package parity checked');
});

/*
Architecture note — one raw explicit-proposition partition must own the full
frame lifecycle: discover each raw occurrence, validate its subject topology
before normalization, then resolve records and local support within that same
occurrence. Build the frozen fingerprint from those ordered frame projections
using only its existing 18 fields; occurrence IDs stay internal. Mediator form
comes from the same morphology classifier as ordinary predicates.
*/
test('five-root closure regressions reproduce the independent Sol blockers', async (t) => {
  const evaluate = evaluatePhotosynthesisRelationsV2;

  await t.test('R1 raw subject validation covers supported auxiliary paths', () => {
    const malformed = [
      ['modal', ', and plants and algae must absorb sunlight'],
      ['perfect', ', and plants and algae have absorbed sunlight'],
      ['progressive', ', and plants and algae are absorbing sunlight'],
      ['negative', ', and plants and algae do not absorb sunlight'],
      ['control', ', and plants and algae do not fail to absorb sunlight'],
      ['passive', 'sunlight is absorbed by , and plants and algae during photosynthesis'],
    ];
    const missed = malformed.filter(([, text]) => !evaluate(text).hasMalformed).map(([path]) => path);
    assert.deepEqual(missed, [], `raw validation bypasses: ${missed.join(', ')}`);
    assert.equal(evaluate('Plants and algae must absorb sunlight').passed, true);
  });

  await t.test('R2 same-sentence explicit propositions retain separate topology', () => {
    const valid = evaluate('Plants and algae use chlorophyll to absorb sunlight and plants and algae absorb sunlight');
    assert.equal(valid.passed, true);
    assert.equal(valid.topology.length, 2);
    assert.equal(valid.relationRecords.length, 6);

    const malformed = evaluate(', and green plants and algae use chlorophyll to harness solar energy and plants and algae absorb sunlight');
    assert.equal(malformed.hasMalformed, true);
    assert.ok(malformed.relationRecords.some((record) => record.qualifies
      && record.evidenceSpan?.text.includes('plants and algae absorb sunlight')),
    'valid sibling must keep its own frame state');
    assert.equal(malformed.coordinationTopology.length, 2);
  });

  await t.test('R3 every mediated frame receives one local support record', () => {
    const result = evaluate('Plants use chlorophyll to absorb sunlight; algae use chlorophyll to absorb sunlight');
    const supports = result.relationRecords.filter((record) => record.relationType === 'CHLOROPHYLL_SUPPORT');
    assert.equal(result.relationRecords.filter((record) => record.relationType === 'CORE_LIGHT_RELATION').length, 2);
    assert.equal(supports.length, 2);
    assert.deepEqual(supports.map((record) => record.subjectSet.lemma), ['plant', 'algae']);
  });

  await t.test('R4 fingerprint retains the proposition that owns mediation', () => {
    const first = 'Plants use chlorophyll to absorb sunlight; algae absorb sunlight';
    const second = 'Plants absorb sunlight; algae use chlorophyll to absorb sunlight';
    assert.notEqual(semanticCaseFingerprint(first), semanticCaseFingerprint(second));
  });

  await t.test('R5 mediator morphology distinguishes base from past', () => {
    const base = 'Plants use chlorophyll to absorb sunlight';
    const past = 'Plants used chlorophyll to absorb sunlight';
    const baseRecord = evaluate(base).relationRecords.find((record) => record.relationType === 'CHLOROPHYLL_SUPPORT');
    const pastRecord = evaluate(past).relationRecords.find((record) => record.relationType === 'CHLOROPHYLL_SUPPORT');
    assert.equal(baseRecord.verbForm, 'BASE');
    assert.equal(pastRecord.verbForm, 'PAST');
    assert.notEqual(semanticCaseFingerprint(base), semanticCaseFingerprint(past));
  });
});

test('five-root closure matrices cover raw paths, frame boundaries, and mediator ownership', async (t) => {
  const { createDerivedEvaluator } = await import('../scripts/run-photosynthesis-relation-mutations.mjs');
  const packaged = createDerivedEvaluator();
  const malformedSubjects = [
    ['initial-empty', ', and plants and algae'],
    ['middle-empty', 'plants, , and algae'],
    ['final-empty', 'plants and algae and'],
    ['determiner-only', 'plants and the'],
  ];
  const activePaths = [
    ['finite', 'absorb sunlight', true],
    ['past', 'absorbed sunlight', true],
    ['modal-must', 'must absorb sunlight', true],
    ['modal-may', 'may absorb sunlight', false],
    ['negation', 'do not absorb sunlight', false],
    ['perfect', 'have absorbed sunlight', true],
    ['progressive', 'are absorbing sunlight', true],
    ['control-affirm', 'do not fail to absorb sunlight', true],
    ['control-neg', 'fail to absorb sunlight', false],
    ['control-uncertain', 'appear not to absorb sunlight', false],
    ['mediated', 'use chlorophyll to absorb sunlight', true],
    ['mediated-past', 'used chlorophyll to absorb sunlight', true],
    ['mediated-must', 'must use chlorophyll to absorb sunlight', true],
    ['mediated-may', 'may use chlorophyll to absorb sunlight', false],
    ['mediated-neg', 'do not use chlorophyll to absorb sunlight', false],
    ['mediated-control', 'do not fail to use chlorophyll to absorb sunlight', true],
    ['mediated-control-neg', 'fail to use chlorophyll to absorb sunlight', false],
    ['mediated-control-uncertain', 'appear not to use chlorophyll to absorb sunlight', false],
    ['coordinated', 'capture and store sunlight', true],
    ['pronoun', 'capture sunlight and store it', true],
    ['mediated-pronoun', 'use chlorophyll to capture sunlight and store it', true],
  ];
  const validSubjects = ['Plants and algae', 'Plants, algae, and green plants'];
  let validControls = 0;
  for (const [path, tail, expectedPass] of activePaths) {
    for (const subject of validSubjects) {
      const text = `${subject} ${tail}.`;
      const result = evaluatePhotosynthesisRelationsV2(text);
      assert.equal(result.hasMalformed, false, `${path}/valid/${subject}`);
      assert.equal(result.passed, expectedPass, `${path}/valid/${subject}`);
      assert.deepEqual(packaged.evaluatePhotosynthesisRelationsV2(text), result, `${path}/valid/package parity`);
      validControls += 1;
    }
  }
  let rawCases = 0;
  for (const [shape, subject] of malformedSubjects) {
    for (const [path, tail] of activePaths) {
      const text = `${subject} ${tail}.`;
      const result = evaluatePhotosynthesisRelationsV2(text);
      assert.equal(result.hasMalformed, true, `${shape}/${path}: ${text}`);
      assert.equal(result.passed, false, `${shape}/${path}: ${text}`);
      assert.deepEqual(packaged.evaluatePhotosynthesisRelationsV2(text), result, `${shape}/${path}/package parity`);
      rawCases += 1;
    }
    const passive = `Sunlight is absorbed by ${subject} during photosynthesis.`;
    const result = evaluatePhotosynthesisRelationsV2(passive);
    assert.equal(result.hasMalformed, true, `${shape}/passive`);
    assert.deepEqual(packaged.evaluatePhotosynthesisRelationsV2(passive), result, `${shape}/passive/package parity`);
    rawCases += 1;
  }
  for (const subject of validSubjects) {
    const result = evaluatePhotosynthesisRelationsV2(`Sunlight is absorbed by ${subject} during photosynthesis.`);
    assert.equal(result.passed, true, `passive/valid/${subject}`);
    assert.equal(result.hasMalformed, false, `passive/valid/${subject}`);
    assert.deepEqual(packaged.evaluatePhotosynthesisRelationsV2(`Sunlight is absorbed by ${subject} during photosynthesis.`), result,
      `passive/valid/package/${subject}`);
    validControls += 1;
  }

  const joins = [' and ', ', and ', '; ', ': ', '. ', '. And ', '. But ', ' but ', ', but '];
  let compositionCases = 0;
  for (const join of joins) {
    const validText = `Plants use chlorophyll to absorb sunlight${join}Algae absorb sunlight`;
    const valid = evaluatePhotosynthesisRelationsV2(validText);
    assert.equal(valid.topology.length, 2, `valid frame split at ${JSON.stringify(join)}`);
    assert.equal(valid.passed, true, `valid frame split at ${JSON.stringify(join)}`);
    assert.deepEqual(packaged.evaluatePhotosynthesisRelationsV2(validText), valid, `valid package split at ${JSON.stringify(join)}`);
    const mixed = evaluatePhotosynthesisRelationsV2(
      `, and green plants and algae use chlorophyll to harness solar energy${join}plants absorb sunlight`,
    );
    assert.equal(mixed.topology.length, 2, `malformed frame split at ${JSON.stringify(join)}`);
    assert.equal(mixed.hasMalformed, true, `malformed first frame at ${JSON.stringify(join)}`);
    assert.ok(mixed.relationRecords.some((record) => record.qualifies
      && record.evidenceSpan?.text.includes('plants absorb sunlight')),
    `valid sibling keeps its own state at ${JSON.stringify(join)}`);
    const mixedText = `, and green plants and algae use chlorophyll to harness solar energy${join}plants absorb sunlight`;
    assert.deepEqual(packaged.evaluatePhotosynthesisRelationsV2(mixedText), mixed, `mixed package split at ${JSON.stringify(join)}`);
    compositionCases += 2;
  }

  const mediatedFrames = [
    'plants use chlorophyll to absorb sunlight',
    'algae use chlorophyll to convert light energy',
    'green plants use chlorophyll to capture solar energy',
  ];
  for (const join of ['; ', ' and ', '. ']) {
    const text = mediatedFrames.join(join);
    const result = evaluatePhotosynthesisRelationsV2(text);
    const supports = result.relationRecords.filter((record) => record.relationType === 'CHLOROPHYLL_SUPPORT');
    assert.equal(supports.length, mediatedFrames.length, `support count at ${JSON.stringify(join)}`);
    assert.deepEqual(supports.map((record) => record.evidenceSpan.text.replace(/[.!?;:]+$/, '').trim()), mediatedFrames,
      `support frame ownership at ${JSON.stringify(join)}`);
    assert.deepEqual(packaged.evaluatePhotosynthesisRelationsV2(text), result, `support package parity at ${JSON.stringify(join)}`);
  }

  const morphology = [['Plants', 'use', 'BASE'], ['Photosynthesis', 'uses', 'PRESENT_3SG'], ['Plants', 'used', 'PAST']];
  const targetObjects = { capture: 'light energy', absorb: 'sunlight', harness: 'solar energy', use: 'sunlight', convert: 'light energy', transform: 'sunlight', store: 'light energy' };
  let morphologyCases = 0;
  for (const target of mediatedTargets) {
    let baseFingerprint;
    let pastFingerprint;
    for (const [subject, surface, form] of morphology) {
      const answer = `${subject} ${surface} chlorophyll to ${target} ${targetObjects[target]}`;
      const result = evaluatePhotosynthesisRelationsV2(answer);
      const support = result.relationRecords.find((record) => record.relationType === 'CHLOROPHYLL_SUPPORT');
      assert.equal(support?.verbForm, form, `${target}/${surface}`);
      assert.deepEqual(packaged.evaluatePhotosynthesisRelationsV2(answer), result,
        `morphology package parity ${target}/${surface}`);
      if (form === 'BASE') baseFingerprint = semanticCaseFingerprint(answer);
      if (form === 'PAST') pastFingerprint = semanticCaseFingerprint(answer);
      morphologyCases += 1;
    }
    assert.notEqual(baseFingerprint, pastFingerprint, `${target} BASE/PAST fingerprint distinction`);
  }
  assert.equal(rawCases, 88);
  assert.equal(validControls, 44);
  assert.equal(compositionCases, 18);
  t.diagnostic(`raw topology paths=${rawCases}; valid controls=${validControls}; frame-boundary cases=${compositionCases}; supported predicate paths=${activePaths.length}; mediator cases=${morphologyCases}; multi-frame support owners=${mediatedFrames.length} x 3`);
});

test('mediated support cardinality and ownership hold for one, two, and three frames', async (t) => {
  const { createDerivedEvaluator } = await import('../scripts/run-photosynthesis-relation-mutations.mjs');
  const packaged = createDerivedEvaluator();
  const objects = { capture: 'light energy', absorb: 'sunlight', harness: 'solar energy', use: 'sunlight', convert: 'light energy', transform: 'sunlight', store: 'light energy' };
  const subjects = ['Plants', 'Algae', 'Green plants'];
  const boundaries = ['; ', '. ', ' and ', '. But ', ', and '];
  const scenarios = [
    { id: 'same-subject-target', subject: (index) => subjects[0], target: () => 'absorb' },
    { id: 'different-subject-same-target', subject: (index) => subjects[index], target: () => 'absorb' },
    { id: 'same-subject-different-target', subject: () => subjects[0], target: (index) => mediatedTargets[index] },
    { id: 'different-subject-target', subject: (index) => subjects[index], target: (index) => mediatedTargets[index] },
  ];
  let supportCases = 0;
  for (let count = 1; count <= 3; count += 1) {
    for (const scenario of scenarios) {
      const frames = Array.from({ length: count }, (_, index) => {
        const subject = scenario.subject(index);
        const target = scenario.target(index);
        return `${subject} use chlorophyll to ${target} ${objects[target]}`;
      });
      for (const boundary of (count === 1 ? [''] : boundaries)) {
        const text = frames.join(boundary);
        const result = evaluatePhotosynthesisRelationsV2(text);
        const supports = result.relationRecords.filter((record) => record.relationType === 'CHLOROPHYLL_SUPPORT');
        const targets = result.relationRecords.filter((record) => record.relationType === 'CORE_LIGHT_RELATION');
        assert.equal(result.passed, true, `${count}/${scenario.id}/${JSON.stringify(boundary)}`);
        assert.equal(targets.length, count, `${count}/${scenario.id} target count`);
        assert.equal(supports.length, count, `${count}/${scenario.id} support count`);
        assert.deepEqual(supports.map((record) => record.evidenceSpan.text.replace(/[.!?;:]+$/, '').trim()),
          frames.map((frame) => frame.toLowerCase()), `${count}/${scenario.id} support owner order`);
        assert.deepEqual(packaged.evaluatePhotosynthesisRelationsV2(text), result,
          `${count}/${scenario.id}/${JSON.stringify(boundary)} package parity`);
        supportCases += 1;
      }
    }
  }
  for (const target of mediatedTargets) {
    for (let count = 1; count <= 3; count += 1) {
      const frames = subjects.slice(0, count)
        .map((subject) => `${subject} use chlorophyll to ${target} ${objects[target]}`);
      for (const boundary of (count === 1 ? [''] : boundaries)) {
        const text = frames.join(boundary);
        const result = evaluatePhotosynthesisRelationsV2(text);
        const supports = result.relationRecords.filter((record) => record.relationType === 'CHLOROPHYLL_SUPPORT');
        assert.equal(supports.length, count, `${target}/${count}/${JSON.stringify(boundary)} support count`);
        assert.deepEqual(supports.map((record) => record.evidenceSpan.text.replace(/[.!?;:]+$/, '').trim()),
          frames.map((frame) => frame.toLowerCase()), `${target}/${count} support owner order`);
        assert.deepEqual(packaged.evaluatePhotosynthesisRelationsV2(text), result,
          `${target}/${count}/${JSON.stringify(boundary)} package parity`);
        supportCases += 1;
      }
    }
  }
  assert.equal(supportCases, 121);
  t.diagnostic(`mediated support cases=${supportCases}; multiplicities=1,2,3; target families=${mediatedTargets.length}; boundary types=${boundaries.length}`);
});

test('fingerprint ownership differentials cover every supported target and semantic frame position', async () => {
  const { createDerivedEvaluator } = await import('../scripts/run-photosynthesis-relation-mutations.mjs');
  const packaged = createDerivedEvaluator();
  const boundaries = ['; ', '. ', ': ', ' and ', '. But '];
  let ownershipCases = 0;
  for (const target of mediatedTargets) {
    for (const boundary of boundaries) {
      const first = `Plants use chlorophyll to ${target} sunlight${boundary}algae ${target} sunlight`;
      const second = `Plants ${target} sunlight${boundary}algae use chlorophyll to ${target} sunlight`;
      assert.equal(evaluatePhotosynthesisRelationsV2(first).passed, true, `${target}/${JSON.stringify(boundary)}/first`);
      assert.equal(evaluatePhotosynthesisRelationsV2(second).passed, true, `${target}/${JSON.stringify(boundary)}/second`);
      assert.notEqual(semanticCaseFingerprint(first), semanticCaseFingerprint(second),
        `${target}/${JSON.stringify(boundary)}`);
      assert.equal(packaged.semanticCaseFingerprint(first), semanticCaseFingerprint(first),
        `${target}/${JSON.stringify(boundary)} first package fingerprint`);
      assert.equal(packaged.semanticCaseFingerprint(second), semanticCaseFingerprint(second),
        `${target}/${JSON.stringify(boundary)} second package fingerprint`);
      assert.equal(semanticCaseFingerprint(first), semanticCaseFingerprint(`  ${first.toUpperCase().replace(/\s+/g, '   ')}.  `),
        `${target}/${JSON.stringify(boundary)} case/space/terminal-punctuation invariant`);
      ownershipCases += 1;
    }
  }
  const movedSemantics = [
    [
      'Plants may absorb sunlight; algae absorb sunlight',
      'Plants absorb sunlight; algae may absorb sunlight',
    ],
    [
      'Plants do not fail to absorb sunlight; algae absorb sunlight',
      'Plants absorb sunlight; algae do not fail to absorb sunlight',
    ],
    [
      'Plants use chlorophyll to absorb sunlight; algae used chlorophyll to capture sunlight',
      'Plants used chlorophyll to capture sunlight; algae use chlorophyll to absorb sunlight',
    ],
    [
      ', and plants and algae absorb sunlight; photosynthesis absorbs sunlight',
      'Plants and algae absorb sunlight; , and photosynthesis absorbs sunlight',
    ],
    [
      'Plants capture light energy; algae absorb light energy',
      'Plants capture light energy. Algae absorb light energy',
    ],
  ];
  for (const [left, right] of movedSemantics) {
    assert.notEqual(semanticCaseFingerprint(left), semanticCaseFingerprint(right), `${left} <> ${right}`);
    assert.equal(packaged.semanticCaseFingerprint(left), semanticCaseFingerprint(left), `${left} package fingerprint`);
    assert.equal(packaged.semanticCaseFingerprint(right), semanticCaseFingerprint(right), `${right} package fingerprint`);
    ownershipCases += 1;
  }
  assert.equal(ownershipCases, 40);
});

test('frame partition matrix crosses predicate classes, nine boundaries, and validity positions', async (t) => {
  const { createDerivedEvaluator } = await import('../scripts/run-photosynthesis-relation-mutations.mjs');
  const packaged = createDerivedEvaluator();
  const frameTypes = {
    simple: 'absorb sunlight',
    mediated: 'use chlorophyll to absorb sunlight',
    auxiliary: 'must absorb sunlight',
    control: 'do not fail to absorb sunlight',
    mediatedControl: 'do not fail to use chlorophyll to absorb sunlight',
    mediatedModal: 'may use chlorophyll to absorb sunlight',
  };
  const boundaries = [' and ', ', and ', '; ', ': ', '. ', '. And ', '. But ', ' but ', ', but '];
  const pairings = Object.keys(frameTypes).flatMap((left) => Object.keys(frameTypes).map((right) => [left, right]));
  const malformed = 'plants, , and algae';
  let compositionCases = 0;
  const keys = new Set();
  const rendered = (type, subject) => `${subject} ${frameTypes[type]}`;
  for (const [leftType, rightType] of pairings) {
    for (const boundary of boundaries) {
      const left = rendered(leftType, 'Plants');
      const right = rendered(rightType, 'Algae');
      const inputs = [
        ['valid-valid', left, right],
        ['malformed-valid', rendered(leftType, malformed), right],
        ['valid-malformed', left, rendered(rightType, malformed)],
      ];
      for (const [state, first, second] of inputs) {
        const result = evaluatePhotosynthesisRelationsV2(first + boundary + second);
        assert.deepEqual(packaged.evaluatePhotosynthesisRelationsV2(first + boundary + second), result,
          `${leftType}+${rightType}/${state}/${JSON.stringify(boundary)} package parity`);
        assert.equal(result.topology.length, 2, `${leftType}+${rightType}/${state}/${JSON.stringify(boundary)}`);
        const expectedMalformed = state !== 'valid-valid';
        assert.equal(result.hasMalformed, expectedMalformed, `${leftType}+${rightType}/${state}/${JSON.stringify(boundary)}`);
        const expectedSupports = state === 'valid-valid'
          ? Number(leftType.toLowerCase().includes('mediated')) + Number(rightType.toLowerCase().includes('mediated'))
          : Number((state === 'malformed-valid' ? rightType : leftType).toLowerCase().includes('mediated'));
        assert.equal(result.relationRecords.filter((record) => record.relationType === 'CHLOROPHYLL_SUPPORT').length,
          expectedSupports, `${leftType}+${rightType}/${state}/${JSON.stringify(boundary)} support count`);
        const validSubject = state === 'malformed-valid' ? 'algae' : 'plants';
        const siblingRecord = result.relationRecords.find((record) => record.evidenceSpan?.text.includes(validSubject)
          && record.relationType === 'CORE_LIGHT_RELATION');
        assert.ok(siblingRecord, `${leftType}+${rightType}/${state}/${JSON.stringify(boundary)} valid sibling record`);
        assert.equal(siblingRecord.rejectionReasons.includes('GRAMMAR_SHAPE_NOT_ACCEPTED'), false,
          `${leftType}+${rightType}/${state}/${JSON.stringify(boundary)} sibling grammar isolation`);
        if (expectedMalformed) assert.equal(result.passed, false, `${leftType}+${rightType}/${state}`);
        keys.add(`${leftType}+${rightType}|${boundary}|${state}`);
        compositionCases += 1;
      }
    }
  }
  assert.equal(compositionCases, 972);
  assert.equal(keys.size, compositionCases);
  t.diagnostic(`cross-root compositions=${compositionCases}; unique composition keys=${keys.size}; predicate classes=${Object.keys(frameTypes).length}; boundaries=${boundaries.length}; validity positions=valid-valid/malformed-valid/valid-malformed`);
});
test('P1 five-root fresh self-closure preserves raw, frame, support, owner, and morphology boundaries', async (t) => {
  const { createDerivedEvaluator } = await import('../scripts/run-photosynthesis-relation-mutations.mjs');
  const packaged = createDerivedEvaluator().evaluatePhotosynthesisRelationsV2;
  const cases = [
    { id: 'raw-control-malformed', text: ', and chlorophyll and some bacteria do not fail to use chlorophyll to transform solar light.' },
    { id: 'raw-control-valid', text: 'Chlorophyll and some bacteria do not fail to use chlorophyll to transform solar light.' },
    { id: 'same-sentence-and-partition', text: 'Plants use chlorophyll to transform solar light and algae absorb sunlight.' },
    { id: 'two-local-mediated-supports', text: 'Plants use chlorophyll to harness solar light, and algae use chlorophyll to store the light energy.' },
    { id: 'fingerprint-owner-a', text: 'Plants use chlorophyll to transform solar light; algae absorb sunlight.' },
    { id: 'fingerprint-owner-b', text: 'Plants transform solar light; algae use chlorophyll to absorb sunlight.' },
    { id: 'mediator-base', text: 'Plants use chlorophyll to harness the solar light during photosynthesis.' },
    { id: 'mediator-present-3sg', text: 'Photosynthesis uses chlorophyll to absorb the solar light during photosynthesis.' },
    { id: 'mediator-past', text: 'Photosynthesis used chlorophyll to capture the light energy during photosynthesis.' },
    { id: 'cross-root-combination', text: ', and plants and algae do not fail to use chlorophyll to transform solar light, but chlorophyll captures sunlight.' },
  ];
  const results = new Map();
  for (const item of cases) {
    const result = evaluatePhotosynthesisRelationsV2(item.text);
    assert.deepEqual(packaged(item.text), result, item.id + ': source/package parity');
    results.set(item.id, result);
  }
  const malformed = results.get('raw-control-malformed');
  assert.equal(malformed.passed, false);
  assert.equal(malformed.hasMalformed, true);
  assert.deepEqual(malformed.coordinationTopology.find(group => group.shapeValid === false)?.rawMembers,
    ['', 'chlorophyll', 'some bacteria']);
  const validControl = results.get('raw-control-valid');
  assert.equal(validControl.passed, true);
  assert.equal(validControl.hasMalformed, false);
  assert.notEqual(semanticCaseFingerprint(malformed), semanticCaseFingerprint(validControl));

  const partition = results.get('same-sentence-and-partition');
  assert.equal(partition.passed, true);
  assert.equal(partition.coordinationTopology.length, 2);
  assert.equal(partition.relationRecords.filter(record => record.relationType === 'CHLOROPHYLL_SUPPORT' && record.qualifies).length, 1);
  assert.equal(partition.relationRecords.filter(record => record.relationType === 'CORE_LIGHT_RELATION' && record.qualifies).length, 2);

  const multiple = results.get('two-local-mediated-supports');
  const supports = multiple.relationRecords.filter(record => record.relationType === 'CHLOROPHYLL_SUPPORT' && record.qualifies);
  const targets = multiple.relationRecords.filter(record => record.relationType === 'CORE_LIGHT_RELATION' && record.qualifies);
  assert.equal(supports.length, 2);
  assert.equal(targets.length, 2);
  assert.deepEqual(supports.map(record => record.subjectSet.surface).sort(), ['algae', 'plants']);
  assert.deepEqual(targets.filter(record => record.verbLemma === 'harness').map(record => record.subjectSet.surface), ['plants']);
  assert.deepEqual(targets.filter(record => record.verbLemma === 'store').map(record => record.subjectSet.surface), ['algae']);
  assert.notEqual(semanticCaseFingerprint(results.get('fingerprint-owner-a')),
    semanticCaseFingerprint(results.get('fingerprint-owner-b')));

  for (const [id, expectedForm] of [['mediator-base', 'BASE'], ['mediator-present-3sg', 'PRESENT_3SG'], ['mediator-past', 'PAST']]) {
    const result = results.get(id);
    assert.equal(result.passed, true, id);
    assert.equal(result.relationRecords.find(record => record.relationType === 'CHLOROPHYLL_SUPPORT')?.verbForm, expectedForm, id);
  }
  const crossRoot = results.get('cross-root-combination');
  assert.equal(crossRoot.passed, false);
  assert.equal(crossRoot.hasMalformed, true);
  assert.equal(crossRoot.coordinationTopology.some(group => group.shapeValid === false), true);
  assert.equal(crossRoot.relationRecords.some(record => record.relationType === 'CORE_LIGHT_RELATION'
    && record.verbLemma === 'capture' && record.qualifies), true);
  t.diagnostic('fresh self-closure cases=10; roots=5/5; cross-root=PASS; source/package mismatches=0');
});

})();

// Exact P1 post-five-root boundary and passive-agent closure regressions.
(function boundaryPassiveClosureRegressionSuite() {
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  evaluatePhotosynthesisRelationsV2,
  semanticCaseFingerprint,
} = require('./photosynthesis-relation-evaluator');

async function loadPackageEvaluator() {
  const { createDerivedEvaluator } = await import(pathToFileURL(join(
    __dirname, '..', 'scripts', 'run-photosynthesis-relation-mutations.mjs',
  )).href);
  return createDerivedEvaluator();
}

function evaluateBoth(input, packaged) {
  const source = evaluatePhotosynthesisRelationsV2(input);
  const packageResult = packaged.evaluatePhotosynthesisRelationsV2(input);
  assert.deepEqual(packageResult, source, `source/package trace: ${input}`);
  return { source, packageResult };
}

function assertPass(result, input) {
  assert.equal(result.passed, true, input);
  assert.equal(result.hasMalformed, false, input);
}

test('post-five-root boundary and passive-agent closure regressions', async (t) => {
  const packaged = await loadPackageEvaluator();

  await t.test('repeated BUT boundaries retain three explicit frame occurrences', () => {
    const supportOnAlgae = 'Green plants store solar light but algae use chlorophyll to transform sunlight but photosynthetic bacteria transform sunlight';
    const supportOnBacteria = 'Green plants store solar light but algae transform sunlight but photosynthetic bacteria use chlorophyll to transform sunlight';
    const a = evaluateBoth(supportOnAlgae, packaged).source;
    const b = evaluateBoth(supportOnBacteria, packaged).source;

    assert.equal(a.passed, true);
    assert.equal(b.passed, true);
    assert.deepEqual(a.topology, [[0, 0], [0, 1], [0, 2]]);
    assert.deepEqual(b.topology, [[0, 0], [0, 1], [0, 2]]);
  });

  await t.test('moving mediation between repeated-BUT frames changes the frozen fingerprint', () => {
    const supportOnAlgae = 'Green plants store solar light but algae use chlorophyll to transform sunlight but photosynthetic bacteria transform sunlight';
    const supportOnBacteria = 'Green plants store solar light but algae transform sunlight but photosynthetic bacteria use chlorophyll to transform sunlight';
    const a = evaluateBoth(supportOnAlgae, packaged).source;
    const b = evaluateBoth(supportOnBacteria, packaged).source;

    assert.deepEqual(a.relationRecords.filter((record) => record.relationType === 'CORE_LIGHT_RELATION')
      .map((record) => record.subjectSet.lemma), ['green plants', 'algae', 'photosynthetic bacteria']);
    assert.deepEqual(b.relationRecords.filter((record) => record.relationType === 'CORE_LIGHT_RELATION')
      .map((record) => record.subjectSet.lemma), ['green plants', 'algae', 'photosynthetic bacteria']);
    assert.match(a.relationRecords.find((record) => record.relationType === 'CHLOROPHYLL_SUPPORT').evidenceSpan.text, /algae/);
    assert.match(b.relationRecords.find((record) => record.relationType === 'CHLOROPHYLL_SUPPORT').evidenceSpan.text, /photosynthetic bacteria/);
    assert.notEqual(semanticCaseFingerprint(a), semanticCaseFingerprint(b));
    assert.notEqual(packaged.semanticCaseFingerprint(supportOnAlgae), packaged.semanticCaseFingerprint(supportOnBacteria));
  });

  await t.test('passive-agent AND stays inside the agent span before an explicit sibling', () => {
    const input = 'Solar light is stored by green plants and algae during photosynthesis and photosynthetic bacteria transform sunlight';
    const { source } = evaluateBoth(input, packaged);

    assertPass(source, input);
    assert.deepEqual(source.topology, [[0, 0], [0, 1]]);
    assert.deepEqual(source.relationRecords.filter((record) => record.relationType === 'CORE_LIGHT_RELATION')
      .map((record) => [record.subjectSet.lemma, record.voice, record.qualifies]), [
        ['green plants', 'PASSIVE', true],
        ['algae', 'PASSIVE', true],
        ['photosynthetic bacteria', 'ACTIVE', true],
      ]);
    assert.deepEqual(source.coordinationTopology[0].orderedMembers, [
      ['green plants', 'BIOLOGICAL_AGENT'], ['algae', 'BIOLOGICAL_AGENT'],
    ]);
  });

  await t.test('comma before BUT is a clause delimiter, not an empty passive-agent member', () => {
    const withComma = 'Solar light is stored by green plants, but algae transform sunlight';
    const withoutComma = 'Solar light is stored by green plants but algae transform sunlight';
    const a = evaluateBoth(withComma, packaged).source;
    const b = evaluateBoth(withoutComma, packaged).source;

    assertPass(a, withComma);
    assertPass(b, withoutComma);
    assert.deepEqual(a.topology, [[0, 0], [0, 1]]);
    assert.equal(a.coordinationTopology[0].cardinality, 1);
    assert.deepEqual(a.coordinationTopology[0].orderedMembers, [['green plants', 'BIOLOGICAL_AGENT']]);
    assert.equal(semanticCaseFingerprint(a), semanticCaseFingerprint(b));
  });

  await t.test('passive agent ends before every supported local context adjunct', () => {
    for (const preposition of ['in', 'for']) {
      const input = `Solar light is stored by green plants ${preposition} photosynthesis`;
      const { source } = evaluateBoth(input, packaged);

      assertPass(source, input);
      assert.deepEqual(source.topology, [[0, 0]]);
      assert.equal(source.relationRecords.length, 1);
      assert.equal(source.relationRecords[0].subjectSet.lemma, 'green plants');
      assert.equal(source.relationRecords[0].subjectSet.valid, true);
      assert.equal(source.relationRecords[0].processContext, 'LOCAL_ADJUNCT');
      assert.equal(source.relationRecords[0].qualifies, true);
    }
  });
});

test('exact owner-recovered ASTRA-BOUNDED-FINAL-003 sibling locality remains intact', async (t) => {
  const packaged = await loadPackageEvaluator();
  const cases = [
    {
      input: 'Plants and algae absorb sunlight; plants, , and algae absorb sunlight.',
      validIndex: 0,
      malformedIndex: 1,
      topology: [[0, 0], [0, 1]],
    },
    {
      input: 'Plants, , and algae absorb sunlight. And plants and algae absorb sunlight.',
      validIndex: 1,
      malformedIndex: 0,
      topology: [[0, 0], [1, 0]],
    },
  ];

  for (const item of cases) {
    await t.test(item.input, () => {
      const { source } = evaluateBoth(item.input, packaged);
      assert.equal(source.passed, false);
      assert.equal(source.hasMalformed, true);
      assert.deepEqual(source.topology, item.topology);
      const groups = source.coordinationTopology;
      assert.equal(groups.length, 2);
      assert.deepEqual(groups[item.validIndex].orderedMembers, [
        ['plant', 'BIOLOGICAL_AGENT'], ['algae', 'BIOLOGICAL_AGENT'],
      ]);
      assert.notEqual(groups[item.validIndex].shapeValid, false);
      assert.equal(groups[item.malformedIndex].shapeValid, false);
      assert.deepEqual(groups[item.malformedIndex].rawMembers, ['plants', '', 'algae']);
      const validFrameText = item.input.includes(';')
        ? 'plants and algae absorb sunlight'
        : 'plants and algae absorb sunlight';
      assert.equal(source.relationRecords.filter((record) => record.qualifies
        && record.evidenceSpan.text.toLowerCase().includes(validFrameText)).length, 2);
      const packageResult = packaged.evaluatePhotosynthesisRelationsV2(item.input);
      assert.deepEqual(packageResult, source);
    });
  }
});

test('two-root boundary ownership and malformed-sibling closure', async () => {
  const packaged = await loadPackageEvaluator();
  const coreRecords = (result) => result.relationRecords
    .filter((record) => record.relationType === 'CORE_LIGHT_RELATION');

  const passiveTarget = 'Light is stored by plants and algae, and plants capture sunlight';
  const passiveControl = 'Light is stored by plants and algae; plants capture sunlight.';
  const ownershipCollision = 'Light is stored by plants, and algae and plants capture sunlight.';
  const target = evaluateBoth(passiveTarget, packaged).source;
  const control = evaluateBoth(passiveControl, packaged).source;
  const collision = evaluateBoth(ownershipCollision, packaged).source;
  assertPass(target, passiveTarget);
  assert.deepEqual(target.topology, [[0, 0], [0, 1]]);
  assert.deepEqual(coreRecords(target).map((record) => [record.voice, record.subjectSet.lemma, record.qualifies]), [
    ['PASSIVE', 'plant', true], ['PASSIVE', 'algae', true], ['ACTIVE', 'plant', true],
  ]);
  assert.deepEqual(target.coordinationTopology[0].orderedMembers, [
    ['plant', 'BIOLOGICAL_AGENT'], ['algae', 'BIOLOGICAL_AGENT'],
  ]);
  assert.deepEqual(target.coordinationTopology[1].orderedMembers, [['plant', 'BIOLOGICAL_AGENT']]);
  assert.equal(semanticCaseFingerprint(target), semanticCaseFingerprint(control));
  assert.notEqual(semanticCaseFingerprint(target), semanticCaseFingerprint(collision));

  const malformed = 'Plants absorb sunlight but plants absorbs sunlight';
  const malformedResult = evaluateBoth(malformed, packaged).source;
  assert.equal(malformedResult.passed, false);
  assert.equal(malformedResult.hasMalformed, true);
  assert.deepEqual(malformedResult.topology, [[0, 0], [0, 1]]);
  assert.deepEqual(coreRecords(malformedResult).map((record) => [record.subjectSet.lemma, record.qualifies, record.evidenceSpan.text]), [
    ['plant', true, 'plants absorb sunlight'],
  ]);

  const formatAgents = (agents, style) => agents.length === 1 ? agents[0]
    : style === 'oxford' && agents.length > 2
      ? `${agents.slice(0, -1).join(', ')}, and ${agents.at(-1)}`
      : style === 'oxford' ? `${agents[0]}, and ${agents[1]}` : agents.join(' and ');
  const agentSets = [
    ['plants'], ['algae'], ['green plants'], ['plants', 'algae'],
    ['green plants', 'algae'], ['algae', 'green plants', 'plants'],
    ['plants', 'algae', 'photosynthetic bacteria'], ['green plants', 'photosynthetic bacteria', 'algae'],
  ];
  const contexts = ['', 'during photosynthesis', 'in photosynthesis', 'for photosynthesis'];
  const siblingFrames = [
    ['active', 'Algae capture sunlight', true],
    ['modal', 'Algae may absorb sunlight', false],
    ['mediated', 'Algae use chlorophyll to absorb sunlight', true],
    ['active-alt', 'Green plants transform light energy', true],
  ];
  const clauseJoins = [
    ['and', ' and '], ['comma-and', ', and '], ['semicolon', '; '],
  ];
  const passiveAgentCases = [];
  for (const agents of agentSets) {
    for (const style of (agents.length === 1 ? ['single'] : agents.length === 2 ? ['and'] : ['and', 'oxford'])) {
      for (const context of contexts) {
        for (const [siblingKind, sibling, siblingQualifies] of siblingFrames) {
          for (const [joinId, join] of (style === 'oxford' ? [clauseJoins[2]] : clauseJoins.slice(0, 2))) {
            for (const hasThird of [false, true]) {
              const agentText = formatAgents(agents, style);
              const input = `Light energy is stored by ${agentText}${context ? ` ${context}` : ''}${join}${sibling}`
                + (hasThird ? ' and Plants absorb sunlight' : '');
              passiveAgentCases.push({
                input,
                key: JSON.stringify(['passive', agents, style, context, siblingKind, joinId, hasThird]),
                agents,
                siblingKind,
                siblingQualifies,
                hasThird,
              });
            }
          }
        }
      }
    }
  }

  const malformedTails = [
    ['agreement', 'plants absorbs sunlight'],
    ['auxiliary', 'plants does not absorbs sunlight'],
    ['leading-empty', ', and plants and algae absorb sunlight'],
    ['modal', 'plants may absorbed sunlight'],
    ['perfect', 'plants have absorb sunlight'],
    ['progressive', 'plants are absorb sunlight'],
    ['control', 'plants does not fail to absorbs sunlight'],
    ['mediated', 'plants uses chlorophyll to absorbs sunlight'],
  ];
  const validHeads = [
    ['Plants absorb sunlight', 'plant'],
    ['Algae capture light energy', 'algae'],
    ['Green plants convert solar energy', 'green plants'],
    ['Photosynthetic bacteria harness sunlight', 'photosynthetic bacteria'],
    ['Photosynthesis stores light energy', 'photosynthesis'],
    ['A plant absorbs sunlight', 'plant'],
    ['Plants must transform sunlight', 'plant'],
    ['Plants use chlorophyll to absorb sunlight', 'plant'],
  ];
  const siblingJoins = [
    ['and', ' and '], ['comma-and', ', and '], ['but', ' but '], ['comma-but', ', but '],
    ['semicolon', '; '], ['period', '. '],
  ];
  const malformedSiblingCases = [];
  for (const [headIndex, [head]] of validHeads.entries()) {
    for (const [malformedKind, malformedTail] of malformedTails) {
      for (const [joinId, join] of siblingJoins) {
        const input = `${head}${join}${malformedTail}`;
        malformedSiblingCases.push({
          input,
          key: JSON.stringify(['malformed-sibling', headIndex, malformedKind, joinId]),
          head,
          malformedKind,
        });
      }
    }
  }

  const malformedCrossRootTails = malformedTails.filter(([kind]) => kind !== 'leading-empty');
  const crossRootJoins = [
    ['and', ' and '], ['comma-and', ', and '], ['but', ' but '], ['comma-but', ', but '],
    ['semicolon', '; '], ['period', '. '],
  ];
  const crossRootCases = [];
  for (const agents of agentSets) {
    for (const style of (agents.length === 1 ? ['single'] : agents.length === 2 ? ['and'] : ['and', 'oxford'])) {
      for (const context of contexts) {
        for (const [malformedKind, malformedTail] of malformedCrossRootTails) {
          const passiveJoins = style === 'oxford'
            ? crossRootJoins.slice(2) : crossRootJoins.slice(0, 4);
          for (const [firstJoinId, firstJoin] of passiveJoins) {
            for (const [lastJoinId, lastJoin] of crossRootJoins.slice(0, 4)) {
              for (const mediatedThird of [false, true]) {
                const passive = `Solar light is stored by ${formatAgents(agents, style)}`
                  + (context ? ` ${context}` : '');
                const third = mediatedThird
                  ? 'Green plants use chlorophyll to absorb sunlight'
                  : 'Green plants absorb sunlight';
                crossRootCases.push({
                  input: `${passive}${firstJoin}${malformedTail}${lastJoin}${third}`,
                  key: JSON.stringify(['cross-root', agents, style, context, malformedKind, firstJoinId, lastJoinId, mediatedThird]),
                  agents,
                  third,
                  malformedKind,
                  mediatedThird,
                });
              }
            }
          }
        }
      }
    }
  }

  let randomState = 0;
  const random = (seed) => () => {
    randomState = seed >>> 0;
    return () => {
      randomState ^= randomState << 13;
      randomState ^= randomState >>> 17;
      randomState ^= randomState << 5;
      return (randomState >>> 0) / 0x1_0000_0000;
    };
  };
  const shuffle = (values, seed) => {
    const next = random(seed)();
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = Math.floor(next() * (index + 1));
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  };
  const holdoutSeeds = [0xA2C59D71, 0x3F86E4B2];
  const selected = [];
  const selectedKeys = new Set();
  const perSeed = [];
  for (const [seedIndex, seed] of holdoutSeeds.entries()) {
    const seedCount = selected.length;
    for (const [pool, count, family] of [
      [passiveAgentCases, 200, 'passive-role'],
      [malformedSiblingCases, 100, 'malformed-sibling'],
      [crossRootCases, 300, 'cross-root'],
    ]) {
      let added = 0;
      for (const item of shuffle(pool, seed ^ (seedIndex + 1) * 0x9E3779B9)) {
        if (selectedKeys.has(item.key)) continue;
        selectedKeys.add(item.key);
        selected.push({ ...item, family, seed });
        if (++added === count) break;
      }
      assert.equal(added, count, `${family} holdout sample for 0x${seed.toString(16)}`);
    }
    perSeed.push({ seed: `0x${seed.toString(16).toUpperCase()}`, cases: selected.length - seedCount });
  }
  assert.ok(selected.length >= 800, `holdout cases ${selected.length} < 800`);
  assert.equal(selectedKeys.size, selected.length, 'holdout structural keys are unique');

  for (const item of selected) {
    const { source } = evaluateBoth(item.input, packaged);
    if (item.family === 'passive-role') {
      assert.equal(source.hasMalformed, false, item.input);
      assert.equal(source.topology.length, item.hasThird ? 3 : 2, item.input);
      const cores = coreRecords(source);
      const passive = cores.filter((record) => record.voice === 'PASSIVE');
      assert.deepEqual(passive.map((record) => record.subjectSet.lemma), item.agents.map((agent) => agent === 'plants' ? 'plant' : agent), item.input);
      assert.ok(passive.every((record) => record.qualifies), item.input);
      const active = cores.filter((record) => record.voice === 'ACTIVE');
      assert.equal(active[0].subjectSet.lemma, item.siblingKind === 'active-alt' ? 'green plants' : 'algae', item.input);
      assert.equal(active[0].qualifies, item.siblingQualifies, item.input);
      assert.equal(active.at(-1).subjectSet.lemma, item.hasThird ? 'plant' : active[0].subjectSet.lemma, item.input);
    } else if (item.family === 'malformed-sibling') {
      assert.equal(source.passed, false, item.input);
      assert.equal(source.hasMalformed, true, item.input);
      assert.equal(source.topology.length, 2, item.input);
      const first = coreRecords(source).find((record) => record.evidenceSpan.text.toLowerCase()
        .replace(/[.!?;:]+$/, '').trim() === item.head.toLowerCase());
      assert.ok(first?.qualifies, item.input);
    } else {
      assert.equal(source.passed, false, item.input);
      assert.equal(source.hasMalformed, true, item.input);
      assert.equal(source.topology.length, 3, item.input);
      const passive = coreRecords(source).filter((record) => record.voice === 'PASSIVE');
      assert.deepEqual(passive.map((record) => record.subjectSet.lemma), item.agents.map((agent) => agent === 'plants' ? 'plant' : agent), item.input);
      assert.ok(passive.every((record) => record.qualifies), item.input);
      assert.ok(coreRecords(source).some((record) => record.voice === 'ACTIVE'
        && record.subjectSet.lemma === 'green plants' && record.qualifies), item.input);
      if (item.mediatedThird) {
        assert.ok(source.relationRecords.some((record) => record.relationType === 'CHLOROPHYLL_SUPPORT'
          && record.evidenceSpan.text.toLowerCase().includes(item.third.toLowerCase())), item.input);
      }
    }
  }

  for (const passive of [
    'Light are absorbed by plants',
    'Light may absorbed by plants',
    'Light have absorbed by plants',
    'Light are absorb by plants',
  ]) {
    const input = `Plants absorb sunlight but ${passive}`;
    const { source } = evaluateBoth(input, packaged);
    assert.equal(source.topology.length, 2, input);
    assert.ok(coreRecords(source).some((record) => record.evidenceSpan.text === 'plants absorb sunlight'
      && record.qualifies), input);
    assert.ok(source.hasMalformed || coreRecords(source).some((record) => record.voice === 'PASSIVE'
      && !record.qualifies), input);
  }

  console.log(`TWO_ROOT_HOLDOUT ${JSON.stringify({
    seeds: perSeed,
    executed: selected.length,
    uniqueStructuralKeys: selectedKeys.size,
    familyCounts: Object.fromEntries(['passive-role', 'malformed-sibling', 'cross-root']
      .map((family) => [family, selected.filter((item) => item.family === family).length])),
    sourcePackageMismatches: 0,
  })}`);
});

})();

// Three-root frame lifecycle properties and implementation-side holdout.
{
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const e = require('./photosynthesis-relation-evaluator');
const SOURCE = readFileSync(join(__dirname, 'photosynthesis-relation-evaluator.js'), 'utf8');
const projection = (r) => r[Object.getOwnPropertySymbols(r).find((s) => s.description === 'V2_FRAME_PROJECTIONS')];
const compile = (source) => { const m = { exports: {} }; new Function('require', 'module', 'exports', source)(require, m, m.exports); return m.exports; };
const replace = (needle, next) => { assert.equal(SOURCE.split(needle).length, 2); return compile(SOURCE.replace(needle, next)); };
const lemma = (s) => e.normalizeExactFormLemmaV2(s);
const boundaries = [' and ', ', and ', ' but ', ', but ', '; ', '. '];
const seeds = [0x74E1C293, 0xC68A5F12];
const agents = ['plants', 'green plants', 'algae', 'photosynthetic bacteria', 'some bacteria'];
const verbs = ['capture', 'absorb', 'harness', 'convert', 'transform', 'store'];
const lights = ['light', 'sunlight', 'light energy', 'solar energy'];
const contexts = ['', ' during photosynthesis', ' in photosynthesis', ' for photosynthesis'];
function passive(members, style, verb, light, context = '', aux = 'is') {
  const role = members.length === 1 ? members[0] : members.length === 2 ? members.join(' and ')
    : members.slice(0, -1).join(', ') + (style === 'oxford' ? ', and ' : ' and ') + members.at(-1);
  return { text: `${light} ${aux} ${verb}${verb.endsWith('e') ? 'd' : 'ed'} by ${role}${context}`, members, voice: 'PASSIVE', verb,
    malformed: !['is', 'was', 'is being', 'was being', 'has been', 'had been', 'must be', 'may be'].includes(aux),
    qualifies: aux !== 'may be' && ['is', 'was', 'is being', 'was being', 'has been', 'had been', 'must be'].includes(aux), context: !!context, support: false };
}
function active(subject, verb, light, kind = 'plain', context = '') {
  const prefix = { plain: '', mediated: 'use chlorophyll to ', modal: 'must ', uncertain: 'may ', control: 'do not fail to ' }[kind];
  return { text: `${subject} ${prefix}${verb} ${light}${context}`, members: [subject], voice: 'ACTIVE', verb,
    malformed: false, qualifies: kind !== 'uncertain', context: !!context, support: kind === 'mediated' };
}
function malformed(subject, verb, light, style, kind = 'active') {
  const role = [`${subject}, , and animals`, `${subject} and , algae`, `${subject}, algae, and , photosynthetic bacteria`][style];
  const text = kind === 'passive' ? `${light} is ${verb}${verb.endsWith('e') ? 'd' : 'ed'} by ${role}`
    : `${role} ${kind === 'mediated' ? 'use chlorophyll to ' : ''}${verb} ${light}`;
  return { text, members: null, voice: kind === 'passive' ? 'PASSIVE' : 'ACTIVE', verb, malformed: true, qualifies: false, support: false };
}
function compose(blocks, separators) {
  return { blocks, separators, text: blocks.map((b, i) => (i ? separators[i - 1] : '') + b.text).join('') };
}
function oracle(item, evaluator = e) {
  const r = evaluator.evaluatePhotosynthesisRelationsV2(item.text);
  const frames = projection(r);
  assert.equal(frames.length, item.blocks.length, item.text);
  assert.equal(r.hasMalformed, item.blocks.some((b) => b.malformed), item.text);
  assert.equal(r.passed, !item.blocks.some((b) => b.malformed) && item.blocks.some((b) => b.qualifies), item.text);
  item.blocks.forEach((block, i) => {
    const f = frames[i];
    assert.equal(f.frameId, i, item.text);
    assert.equal(f.malformed, block.malformed, item.text);
    assert.ok(f.records.every((record) => record.evidenceSpan.text === f.text), item.text);
    const core = f.records.filter((record) => record.relationType === 'CORE_LIGHT_RELATION');
    if (!block.malformed) {
      assert.deepEqual(core.map((record) => record.subjectSet.lemma), block.members.map(lemma), item.text);
      assert.deepEqual(core.map((record) => record.voice), block.members.map(() => block.voice), item.text);
      assert.deepEqual(core.map((record) => record.qualifies), block.members.map(() => block.qualifies), item.text);
      assert.equal(f.coordinationTopology[0].cardinality, block.members.length, item.text);
      assert.equal(f.records.filter((record) => record.relationType === 'CHLOROPHYLL_SUPPORT').length, block.support ? 1 : 0, item.text);
      if (block.voice === 'PASSIVE') assert.ok(core.every((record) => record.lightObject.binding === 'PASSIVE_SUBJECT'
        && record.processContext === (block.context ? 'LOCAL_ADJUNCT' : null)), item.text);
    } else assert.ok(f.records.every((record) => !record.qualifies), item.text);
  });
  return r;
}
async function packaged() { return (await import(pathToFileURL(join(__dirname, '../scripts/run-photosynthesis-relation-mutations.mjs')).href)).createDerivedEvaluator(); }
const exact = [
  compose([passive(['plants', 'algae', 'photosynthetic bacteria'], 'oxford', 'store', 'light'), active('plants', 'capture', 'sunlight')], [', and ']),
  compose([active('plants', 'absorb', 'sunlight'), passive(['plants'], '', 'store', 'light', '', 'are')], [' but ']),
  compose([active('plants', 'absorb', 'sunlight'), malformed('plants', 'absorb', 'sunlight', 0)], [' but ']),
];
test('three roots: exact cases retain frame ownership and valid qualification in source/package', async () => {
  const p = await packaged();
  for (const item of exact) {
    const r = oracle(item); const pr = oracle(item, p);
    assert.deepEqual(pr, r); assert.deepEqual(projection(pr), projection(r));
    assert.equal(p.semanticCaseFingerprint(pr), e.semanticCaseFingerprint(r));
  }
});
test('passive maximal/Oxford role properties cross supported sibling forms and boundaries', () => {
  let count = 0;
  for (const members of [agents.slice(0, 1), agents.slice(0, 2), agents.slice(0, 3)])
    for (const style of ['oxford', 'serial']) for (const boundary of boundaries)
      for (const kind of ['plain', 'mediated', 'modal', 'control']) {
        oracle(compose([passive(members, style, 'store', 'light'), active('plants', 'capture', 'sunlight', kind)], [boundary])); count++;
      }
  console.log(`ROLE_SPAN_PROPERTIES ${count}`);
});
test('passive auxiliary malformation remains local in first/middle/last frames', () => {
  let count = 0;
  for (const aux of ['are', 'were', 'have been', 'has be', 'is been', 'has being', 'must been', 'must is', 'is be'])
    for (const boundary of boundaries) for (let position = 0; position < 3; position++) {
      const blocks = [active('plants', 'absorb', 'sunlight'), active('algae', 'harness', 'light'), active('green plants', 'capture', 'solar energy', 'mediated')];
      blocks[position] = passive(['plants'], '', 'store', 'light', '', aux);
      oracle(compose(blocks, [boundary, boundary])); count++;
    }
  console.log(`MALFORMED_PASSIVE_PROPERTIES ${count}`);
});
test('malformed coordination prefixes remain local across conjunctions and hard boundaries', () => {
  let count = 0;
  for (const style of [0, 1, 2]) for (const kind of ['active', 'passive', 'mediated'])
    for (const boundary of boundaries) for (let position = 0; position < 3; position++) {
    const blocks = [passive(agents.slice(0, 3), 'oxford', 'store', 'light'), active('algae', 'harness', 'sunlight', 'mediated'), active('green plants', 'capture', 'solar energy')];
    blocks[position] = malformed('plants', 'absorb', 'sunlight', style, kind);
    oracle(compose(blocks, [boundary, boundary])); count++;
  }
  console.log(`MALFORMED_SIBLING_PROPERTIES ${count}`);
});
test('Oxford ownership differential and normalization-equivalent forms preserve fingerprints', () => {
  const a = exact[0].text;
  const b = 'Light is stored by plants and algae, and photosynthetic bacteria and plants capture sunlight';
  assert.notEqual(e.semanticCaseFingerprint(a), e.semanticCaseFingerprint(b));
  assert.equal(e.semanticCaseFingerprint(a), e.semanticCaseFingerprint(a.toUpperCase().replaceAll(' ', '  ')));
  assert.notEqual(e.semanticCaseFingerprint('Light is stored by plants and algae, and plants capture sunlight'),
    e.semanticCaseFingerprint('Light is stored by plants, and algae and plants capture sunlight'));
});
test('NEW-A/NEW-B/NEW-C mutations execute and lose their intended semantic property', () => {
  const mutants = [
    replace("return candidate.commaDelimited && passive\n        && isStructurallyOwnedRoleSpanV2(passive.agent)\n        && (passive.agent.members.at(-1)?.surface\n          || tokens[passive.by + passive.agent.end]?.form === 'and');", 'return candidate.commaDelimited && passive;'),
    replace('|| !isSupportedPassiveAuxiliaryChain(passive.auxiliaryChain)', '|| false'),
    replace("const malformedEmptyAnd = subject.shapeValid === false && subject.coordinator === 'AND'\n      && isStructurallyOwnedRoleSpanV2(subject);", "const malformedEmptyAnd = subject.shapeValid === false && subject.coordinator === 'AND'\n      && subject.members.some((member) => member.valid) && subject.members.every((member) => member.valid || member.surface === '');"),
  ];
  mutants.forEach((m, i) => {
    oracle(exact[i]);
    assert.doesNotThrow(() => m.evaluatePhotosynthesisRelationsV2(exact[i].text));
    assert.throws(() => oracle(exact[i], m), { code: 'ERR_ASSERTION' });
  });
});
function random(seed) { let x = seed; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 0x100000000; }; }
test('fresh deterministic holdout stresses all three mechanisms with source/package parity', async () => {
  const p = await packaged();
  const cases = []; const inputs = new Set(); const keys = new Set(); const fingerprints = new Set();
  const familyCounts = [0, 0, 0, 0, 0, 0];
  for (const seed of seeds) {
    const rng = random(seed), pick = (a) => a[Math.floor(rng() * a.length)];
    for (let attempts = 0, accepted = 0; accepted < 900 && attempts < 50000; attempts++) {
      const family = attempts % 6;
      const role = [...agents].sort(() => rng() - 0.5).slice(0, pick([1, 2, 3, 3, 3]));
      const first = passive(role, pick(['oxford', 'serial']), pick(verbs), pick(lights), pick(contexts));
      const good = active(pick(agents), pick(verbs), pick(lights), pick(['plain', 'mediated', 'modal', 'uncertain', 'control']), pick(contexts));
      const badAux = passive([pick(agents)], '', pick(verbs), pick(lights), pick(contexts), pick(['are', 'were', 'have been', 'has be', 'is been', 'must been', 'must is']));
      const badRole = malformed(pick(agents), pick(verbs), pick(lights), pick([0, 1, 2]), pick(['active', 'passive', 'mediated']));
      const blocks = [[first, good], [good, badAux], [good, badRole], [first, badAux, good], [first, good, badRole], [first, badAux, badRole]][family];
      if (rng() < 0.5) blocks.reverse();
      const item = compose(blocks, blocks.slice(1).map(() => pick(boundaries)));
      // Structural key from construction semantics, excluding surface punctuation
      // and normalized light synonyms. This is independent of parser output.
      const key = JSON.stringify({ blocks: blocks.map(({ text, context, ...b }) => ({ ...b, members: b.members?.map(lemma), context: !!context })), boundaries: item.separators.map((s) => s.includes('.') ? 'sentence' : s.includes(';') ? 'hard' : s.includes('but') ? 'but' : 'and') });
      if (inputs.has(item.text) || keys.has(key)) continue;
      inputs.add(item.text); keys.add(key); cases.push(item); accepted++; familyCounts[family]++;
    }
  }
  assert.equal(cases.length, 1800); assert.ok(keys.size >= 1200);
  const failures = [];
  for (const item of cases) {
    try {
      const r = oracle(item); const pr = oracle(item, p);
      assert.deepEqual(pr, r); assert.deepEqual(projection(pr), projection(r));
      assert.equal(p.semanticCaseFingerprint(pr), e.semanticCaseFingerprint(r));
      fingerprints.add(e.semanticCaseFingerprint(r));
    } catch (error) { failures.push({ input: item.text, message: error.message }); }
  }
  console.log(`THREE_ROOT_HOLDOUT ${JSON.stringify({ seeds: seeds.map((s) => '0x' + s.toString(16).toUpperCase()), cases: cases.length, uniqueKeys: keys.size, uniqueFingerprints: fingerprints.size, familyCounts, failed: failures.length, examples: failures.slice(0, 8) })}`);
  assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 8)));
});

}

// Structural discovery preserves coordinated members before semantic validation.
{
const e = require('./photosynthesis-relation-evaluator');
const source = readFileSync(join(__dirname, 'photosynthesis-relation-evaluator.js'), 'utf8');
const projection = (r) => r[Object.getOwnPropertySymbols(r).find((s) => s.description === 'V2_FRAME_PROJECTIONS')];
const nouns = ['plants', 'green plants', 'algae', 'photosynthetic bacteria', 'some bacteria'];
const verbs = ['capture', 'absorb', 'harness', 'convert', 'transform', 'store'];
const separators = [' and ', ', and ', ' but ', ', but ', '; ', '. '];
const seeds = [0x19A7D4C3, 0xE63B9025];
const lemma = (s) => e.normalizeExactFormLemmaV2(s);
const participle = (v) => v + (v.endsWith('e') ? 'd' : 'ed');
function role(members, kind) {
  if (kind === 'gap') return { text: `${members[0]}, , and ${members[1]}`, members: [members[0], '', members[1]], malformed: true };
  if (kind === 'duplicate') return { text: `${members[0]} and and ${members[1]}`, members: [members[0], '', members[1]], malformed: true };
  if (kind === 'comma-duplicate') return { text: `${members[0]}, and and ${members[1]}`, members: [members[0], '', members[1]], malformed: true };
  if (kind === 'oxford-gap') return { text: `${members[0]}, ${members[1]}, , and ${members[2]}`, members: [members[0], members[1], '', members[2]], malformed: true };
  if (kind === 'after-and-gap') return { text: `${members[0]}, ${members[1]}, and , ${members[2]}`, members: [members[0], members[1], '', members[2]], malformed: true };
  if (kind === 'final-gap') return { text: `${members[0]}, ${members[1]}, and`, members: [members[0], members[1], ''], malformed: true };
  const text = members.length === 1 ? members[0] : members.length === 2 ? members.join(' and ')
    : members.slice(0, -1).join(', ') + (kind === 'serial' ? ' and ' : ', and ') + members.at(-1);
  return { text, members, malformed: false };
}
function block(members, kind, voice = 'ACTIVE', verb = 'absorb', mode = 'plain', light = 'sunlight', context = '') {
  const r = role(members, kind);
  const auxiliary = voice === 'PASSIVE' ? { plain: 'is', modal: 'must be', uncertain: 'may be', perfect: 'has been', progressive: 'is being' }[mode]
    : { plain: '', modal: 'must', uncertain: 'may', perfect: 'have', progressive: 'are' }[mode];
  const surface = voice === 'PASSIVE' || mode === 'perfect' ? participle(verb) : mode === 'progressive' ? verb.replace(/e$/, '') + 'ing' : verb;
  const prefix = voice === 'PASSIVE' ? `${light} ${auxiliary} ${surface} by ` : '';
  const predicate = voice === 'PASSIVE' ? '' : ` ${mode === 'mediated' ? 'use chlorophyll to ' : auxiliary ? auxiliary + ' ' : ''}${surface} ${light}`;
  return { text: prefix + r.text + predicate + context, members: r.members, malformed: r.malformed, voice, verb,
    morphology: voice === 'PASSIVE' ? 'PAST_PARTICIPLE' : mode === 'perfect' ? 'PAST' : mode === 'progressive' ? 'PRESENT_PARTICIPLE' : 'BASE',
    auxiliary: auxiliary ? auxiliary.split(' ') : [], mode, context, qualifies: !r.malformed && mode !== 'uncertain', supports: mode === 'mediated' && !r.malformed };
}
function compose(blocks, boundaries) { return { blocks, boundaries, text: blocks.map((b, i) => (i ? boundaries[i - 1] : '') + b.text).join('') }; }
function check(item, api = e) {
  const r = api.evaluatePhotosynthesisRelationsV2(item.text), frames = projection(r);
  assert.equal(frames.length, item.blocks.length, `frame count: ${item.text}`);
  assert.equal(r.hasMalformed, item.blocks.some((b) => b.malformed), `malformed: ${item.text}`);
  assert.equal(r.passed, !item.blocks.some((b) => b.malformed) && item.blocks.some((b) => b.qualifies), `decision: ${item.text}`);
  let sentence = 0, clause = 0;
  item.blocks.forEach((b, i) => {
    if (i && item.boundaries[i - 1] === '. ') { sentence++; clause = 0; }
    else if (i) clause++;
    const f = frames[i];
    assert.equal(f.frameId, i, `frame identity: ${item.text}`);
    assert.deepEqual(f.topology, [[sentence, clause]], `frame topology: ${item.text}`);
    assert.equal(f.malformed, b.malformed, `neighbor locality: ${item.text}`);
    assert.deepEqual(f.coordinationTopology[0].orderedMembers.map(([s]) => s), b.members.map(lemma), `role membership: ${item.text}`);
    assert.equal(f.coordinationTopology[0].cardinality, b.members.length, `role cardinality: ${item.text}`);
    const records = f.records.filter((x) => x.relationType === 'CORE_LIGHT_RELATION');
    assert.ok(f.records.every((x) => x.evidenceSpan.text === f.text), `relation ownership: ${item.text}`);
    if (b.malformed) assert.ok(f.records.every((x) => !x.qualifies), `malformed qualification: ${item.text}`);
    else {
      assert.deepEqual(records.map((x) => x.subjectSet.lemma), b.members.map(lemma), `subjects/agents: ${item.text}`);
      assert.ok(records.every((x) => x.voice === b.voice && x.verbLemma === b.verb && x.verbForm === b.morphology && x.qualifies === b.qualifies), `morphology/qualification: ${item.text}`);
      assert.deepEqual(records.map((x) => x.auxiliaryChain?.chain || []), b.members.map(() => b.auxiliary), `auxiliary ownership: ${item.text}`);
      assert.equal(f.records.filter((x) => x.relationType === 'CHLOROPHYLL_SUPPORT').length, b.supports ? b.members.length : 0, `support ownership: ${item.text}`);
      if (b.voice === 'PASSIVE') assert.ok(records.every((x) => x.lightObject.binding === 'PASSIVE_SUBJECT' && x.processContext === (b.context ? 'LOCAL_ADJUNCT' : null)), `passive context: ${item.text}`);
    }
  });
  return r;
}
async function packaged() { return (await import(require('node:url').pathToFileURL(join(__dirname, '../scripts/run-photosynthesis-relation-mutations.mjs')).href)).createDerivedEvaluator(); }
const exact = [
  compose([block(['plants'], 'oxford', 'ACTIVE', 'capture', 'plain', 'light'), block(['plants', 'algae', 'photosynthetic bacteria'], 'oxford', 'PASSIVE', 'store', 'modal', 'light'), block(['plants'], 'oxford', 'ACTIVE', 'capture', 'plain', 'light')], [' and ', ' and ']),
  compose([block(['plants'], 'oxford'), block(['plants', 'algae'], 'duplicate')], [' but ']),
  compose([block(['green plants', 'algae', 'photosynthetic bacteria'], 'oxford-gap')], []),
];
test('current structural roots retain frame discovery, modal Oxford ownership, and malformed identity', async () => {
  const p = await packaged();
  for (const item of exact) { const r = check(item); const pr = check(item, p); assert.deepEqual(pr, r); assert.deepEqual(projection(pr), projection(r)); assert.equal(p.semanticCaseFingerprint(pr), e.semanticCaseFingerprint(r)); }
});
test('three-frame passive ownership and empty-member locality properties', () => {
  let count = 0;
  for (const kind of ['oxford', 'serial', 'gap', 'duplicate', 'comma-duplicate', 'oxford-gap', 'after-and-gap', 'final-gap'])
    for (const mode of ['plain', 'modal', 'uncertain', 'perfect', 'progressive']) for (const boundary of separators) for (let position = 0; position < 3; position++) {
      const blocks = [block(['green plants'], 'oxford', 'ACTIVE', 'capture'), block(['algae'], 'oxford', 'ACTIVE', 'harness', 'mediated'), block(['photosynthetic bacteria'], 'oxford', 'ACTIVE', 'transform', 'modal')];
      blocks[position] = block(['plants', 'algae', 'photosynthetic bacteria'], kind, 'PASSIVE', 'store', mode, 'light');
      check(compose(blocks, [boundary, boundary])); count++;
    }
  console.log(`STRUCTURAL_PASSIVE_PROPERTIES ${count}`);
});
test('multiword coordinated subjects preserve empty/duplicate members and valid-malformed fingerprints', async () => {
  const p = await packaged();
  let count = 0;
  for (let rotation = 0; rotation < nouns.length; rotation++) {
    const members = [...nouns.slice(rotation), ...nouns.slice(0, rotation)].slice(0, 3);
    for (const voice of ['ACTIVE', 'PASSIVE']) for (const kind of ['oxford', 'serial', 'gap', 'duplicate', 'comma-duplicate', 'oxford-gap', 'after-and-gap', 'final-gap']) {
      const b = block(members, kind, voice, 'absorb'); const r = check(compose([b], []));
      const pr = check(compose([b], []), p);
      assert.deepEqual(pr, r); assert.deepEqual(projection(pr), projection(r));
      assert.equal(p.semanticCaseFingerprint(pr), e.semanticCaseFingerprint(r));
      const cosmetic = b.text.toUpperCase().replaceAll(' ', '  ');
      assert.equal(p.semanticCaseFingerprint(cosmetic), e.semanticCaseFingerprint(r), b.text);
      if (b.malformed) {
        const control = block(b.members.filter(Boolean), 'oxford', voice, 'absorb'); check(compose([control], []));
        assert.deepEqual(p.evaluatePhotosynthesisRelationsV2(control.text), e.evaluatePhotosynthesisRelationsV2(control.text));
        assert.notEqual(e.semanticCaseFingerprint(r), e.semanticCaseFingerprint(control.text), b.text);
        assert.equal(e.semanticCaseFingerprint(b.text), e.semanticCaseFingerprint(b.text.toUpperCase().replaceAll(' ', '  ')), b.text);
      }
      count++;
    }
  }
  for (const voice of ['ACTIVE', 'PASSIVE']) for (const members of [nouns.slice(0, 1), nouns.slice(0, 2), nouns.slice(1, 3), nouns.slice(2, 4)]) { check(compose([block(members, 'oxford', voice)], [])); count++; }
  console.log(`STRUCTURAL_MULTIWORD_PROPERTIES ${count}`);
});
test('malformed sibling discovery and three-frame neighbor locality properties', () => {
  let count = 0;
  for (const kind of ['duplicate', 'comma-duplicate', 'gap', 'oxford-gap', 'after-and-gap', 'final-gap'])
    for (const voice of ['ACTIVE', 'PASSIVE']) for (const mode of voice === 'PASSIVE' ? ['plain', 'modal'] : ['plain', 'mediated'])
      for (const boundary of separators) for (let position = 0; position < 3; position++) {
        const blocks = [block(['green plants'], 'oxford'), block(['plants', 'algae', 'photosynthetic bacteria'], 'oxford', 'PASSIVE', 'store', 'modal', 'light'), block(['some bacteria'], 'oxford', 'ACTIVE', 'harness', 'mediated')];
        blocks[position] = block(['green plants', 'algae', 'photosynthetic bacteria'], kind, voice, 'absorb', mode);
        check(compose(blocks, [boundary, boundary])); count++;
      }
  console.log(`STRUCTURAL_SIBLING_PROPERTIES ${count}`);
});
test('NEW-D–G mutations execute and fail their structural semantic threat models', () => {
  const replace = (needle, replacement) => { assert.equal(source.split(needle).length, 2); const m = { exports: {} }; new Function('require', 'module', 'exports', source.replace(needle, replacement))(require, m, m.exports); return m.exports; };
  const mutants = [
    replace('if (findPassiveHeadV2(tokens)) return true;', 'if (bindLocalPassiveAgent(tokens)) return true;'),
    replace('const memberSources=raw.split(/\\s+(?:and|or|rather\\s+than)(?=\\s|$)|,\\s*/);', 'const memberSources=raw.split(/\\s+(?:and|or|rather\\s+than)(?=\\s|$)|,\\s*/).filter((member) => member.trim());'),
    replace("const malformedEmptyAnd = subject.shapeValid === false && subject.coordinator === 'AND'\n      && isStructurallyOwnedRoleSpanV2(subject);", 'const malformedEmptyAnd = false;'),
    replace('if (rolePrefix.end === index + 1 && rolePrefix.members.at(-1)?.valid) continue;', 'if (false) continue;'),
  ];
  const cases = [exact[0], compose([block(['green plants', 'algae'], 'gap', 'PASSIVE', 'store', 'plain', 'light'), block(['plants'], 'oxford')], [' but ']), exact[1], exact[2]];
  mutants.forEach((m, i) => { check(cases[i]); assert.doesNotThrow(() => m.evaluatePhotosynthesisRelationsV2(cases[i].text)); assert.throws(() => check(cases[i], m), { code: 'ERR_ASSERTION' }); });
  console.log('STRUCTURAL_MUTATIONS 4/4 MEANINGFUL; zero crashes');
});
function random(seed) { let x = seed; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 0x100000000; }; }
test('fresh structural closure holdout and false-positive defense have exact source/package parity', async () => {
  const p = await packaged(), keys = new Set(), inputs = new Set(), fingerprints = new Set(), fingerprintInputs = new Map(), equivalences = [], cases = [], families = [0, 0, 0, 0, 0, 0];
  for (const seed of seeds) {
    const rng = random(seed), pick = (a) => a[Math.floor(rng() * a.length)];
    for (let attempts = 0, accepted = 0; accepted < 1500 && attempts < 60000; attempts++) {
      const family = attempts % 6;
      const shuffled = [...nouns]; for (let i = shuffled.length - 1; i; i--) { const j = Math.floor(rng() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
      const members = shuffled.slice(0, 3), light = pick(['light', 'sunlight', 'solar energy']), context = pick(['', ' in photosynthesis', ' during photosynthesis', ' for photosynthesis']);
      const goodActive = block(members.slice(0, pick([1, 2, 3])), pick(['oxford', 'serial']), 'ACTIVE', pick(verbs), pick(['plain', 'modal', 'mediated']), light, context);
      const goodPassive = block(members.slice(0, pick([1, 2, 3, 3, 3])), pick(['oxford', 'serial']), 'PASSIVE', pick(verbs), pick(['plain', 'modal', 'uncertain', 'perfect', 'progressive']), light, context);
      const bad = block(members, pick(['gap', 'duplicate', 'comma-duplicate', 'oxford-gap', 'after-and-gap', 'final-gap']), family % 2 ? 'PASSIVE' : 'ACTIVE', pick(verbs), family % 2 ? pick(['plain', 'modal']) : pick(['plain', 'mediated']), light, context);
      const third = block([pick(nouns)], 'oxford', 'ACTIVE', pick(verbs), pick(['plain', 'modal', 'mediated']), light);
      const blocks = [[goodActive, goodPassive, third], [goodActive, bad], [bad, goodPassive], [goodActive, bad, third], [bad, goodPassive, third], [goodPassive, third, bad]][family];
      const item = compose(blocks, blocks.slice(1).map(() => pick(separators)));
      // Construction semantics form the independent key; surface light synonyms,
      // whitespace and equivalent comma-before-conjunction forms are excluded.
      const key = JSON.stringify({ blocks: blocks.map(({ text, ...b }) => ({ ...b, members: b.members.map(lemma), context: !!b.context })), topology: item.boundaries.map((b) => b === '. ' ? 'sentence' : 'clause') });
      if (keys.has(key) || inputs.has(item.text)) continue;
      keys.add(key); inputs.add(item.text); cases.push({ ...item, key }); families[family]++; accepted++;
    }
  }
  assert.equal(cases.length, 3000); assert.ok(keys.size >= 2200);
  const failures = [];
  for (const item of cases) {
    try {
      const r = check(item), pr = check(item, p); assert.deepEqual(pr, r); assert.deepEqual(projection(pr), projection(r));
      const fp = e.semanticCaseFingerprint(r); assert.equal(p.semanticCaseFingerprint(pr), fp); fingerprints.add(fp);
      if (fingerprintInputs.has(fp)) {
        const previous = fingerprintInputs.get(fp);
        assert.equal(item.key, previous.key, `distinct constructed semantic ownership collides: ${previous.text} / ${item.text}`);
        equivalences.push([previous.text, item.text]);
      } else fingerprintInputs.set(fp, item);
    }
    catch (error) { failures.push({ input: item.text, message: error.message }); }
  }
  console.log(`STRUCTURAL_HOLDOUT ${JSON.stringify({ seeds: seeds.map((s) => '0x' + s.toString(16).toUpperCase()), cases: cases.length, uniqueKeys: keys.size, uniqueFingerprints: fingerprints.size, families, failures: failures.length, examples: failures.slice(0, 10), equivalences })}`);
  assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 10)));
});
}

{
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
  {
    input: 'Light is stored by animals and and rocks, and plants and algae absorb sunlight',
    passiveMembers: ['animals', '', 'rocks'],
    activeMembers: ['plants', 'algae'],
    activeMalformed: false,
    activeHasOwnedCore: true,
  },
  {
    input: 'Light is stored by animals and and rocks, and green plants and photosynthetic bacteria use chlorophyll to capture sunlight',
    passiveMembers: ['animals', '', 'rocks'],
    activeMembers: ['green plants', 'photosynthetic bacteria'],
    activeMalformed: false,
    activeHasOwnedCore: true,
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
  assert.ok(frames[0].records.every((record) => record.voice === 'PASSIVE' && !record.qualifies), item.input);
  assert.deepEqual(frames[0].coordinationTopology[0].rawMembers, item.passiveMembers, item.input);
  assert.equal(frames[0].coordinationTopology[0].cardinality, item.passiveMembers.length, item.input);
  assert.ok(frames[0].records.filter((record) => record.relationType === 'CORE_LIGHT_RELATION')
    .every((record) => !record.qualifies), item.input);
  assert.equal(frames[0].records.some((record) => record.relationType === 'CHLOROPHYLL_SUPPORT' && record.qualifies), false, item.input);
  assert.deepEqual(normalizedTopologyMembers(frames[1]), item.activeMembers.map((surface) => evaluator.normalizeExactFormLemmaV2(surface)), item.input);
  assert.equal(frames[1].coordinationTopology[0].cardinality, item.activeMembers.length, item.input);
  assert.ok(frames[1].records.every((record) => record.voice === 'ACTIVE'), item.input);
  if (item.activeHasOwnedCore || item.activeHasOwnedCoreAndSupport) {
    const activeRecords = frames[1].records;
    const coreSubjects = activeRecords.filter((record) => record.relationType === 'CORE_LIGHT_RELATION' && record.qualifies)
      .map((record) => record.subjectSet.surface).sort();
    assert.deepEqual(coreSubjects, item.activeMembers.slice().sort(), item.input);
    const supportSubjects = activeRecords.filter((record) => record.relationType === 'CHLOROPHYLL_SUPPORT' && record.qualifies)
      .map((record) => record.subjectSet.surface).sort();
    assert.deepEqual(supportSubjects, item.activeHasOwnedCoreAndSupport ? item.activeMembers.slice().sort() : [], item.input);
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
  assert.equal(frames[1].coordinationTopology[0].cardinality, item.sibling.members.length, item.input);
  assert.equal(frames[0].records.length > 0, true, item.input);
  if (item.passiveValidity) {
    const expectedSubjectValidity = item.passiveValidity === 'ALL_INVALID' ? 'ALL_INVALID' : 'MIXED_INVALID';
    assert.ok(frames[0].records.every((record) => record.subjectValidity === expectedSubjectValidity), item.input);
  }
  assert.ok(frames[0].records.every((record) => !record.qualifies), item.input);
  assert.equal(frames[0].records.some((record) => record.relationType === 'CHLOROPHYLL_SUPPORT'), false, item.input);
  assert.ok(frames[0].records.every((record) => record.voice === 'PASSIVE'
    && record.verbLemma === (item.passiveVerbLemma || 'store') && record.verbForm === 'PAST_PARTICIPLE'), item.input);
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

const allInvalidRoleOrders = [
  ['animals', 'rocks'], ['animals', 'bacteria'], ['rocks', 'animals'],
  ['rocks', 'bacteria'], ['bacteria', 'animals'], ['bacteria', 'rocks'],
  ['animals', 'rocks', 'bacteria'], ['animals', 'bacteria', 'rocks'],
  ['rocks', 'animals', 'bacteria'], ['rocks', 'bacteria', 'animals'],
  ['bacteria', 'animals', 'rocks'], ['bacteria', 'rocks', 'animals'],
];
const commaAndMalformedRoleShapes = [
  { count: 2, render: ([a, b]) => `${a}, and and ${b}`, members: ([a, b]) => [a, '', b], barriers: ['COMMA_AND', 'DUPLICATE_CONJUNCTION'] },
  { count: 2, render: ([a, b]) => `${a} and and ${b}`, members: ([a, b]) => [a, '', b], barriers: ['AND', 'DUPLICATE_CONJUNCTION'] },
  { count: 2, render: ([a, b]) => `${a}, , and ${b}`, members: ([a, b]) => [a, '', b], barriers: ['COMMA', 'EMPTY_MEMBER', 'COMMA_AND'] },
  { count: 2, render: ([a, b]) => `${a}, ${b}, and`, members: ([a, b]) => [a, b, ''], barriers: ['SERIAL_COMMA', 'TRAILING_CONJUNCTION'] },
  { count: 3, render: ([a, b, c]) => `${a}, ${b}, , and ${c}`, members: ([a, b, c]) => [a, b, '', c], barriers: ['SERIAL_COMMA', 'EMPTY_MEMBER', 'COMMA_AND'] },
  { count: 3, render: ([a, b, c]) => `${a} and ${b} and and ${c}`, members: ([a, b, c]) => [a, b, '', c], barriers: ['AND', 'DUPLICATE_CONJUNCTION', 'AND'] },
  { count: 3, render: ([a, b, c]) => `${a}, and and ${b} and and ${c}`, members: ([a, b, c]) => [a, '', b, '', c], barriers: ['COMMA_AND', 'DUPLICATE_CONJUNCTION', 'AND', 'DUPLICATE_CONJUNCTION'] },
];
const directedPassiveConfigurations = commaAndMalformedRoleShapes.flatMap((shape, shapeIndex) =>
  allInvalidRoleOrders.filter((subjects) => subjects.length === shape.count).map((subjects) => ({ shape, shapeIndex, subjects })));
const directedSiblingPairs = [
  ['plants', 'algae'], ['plants', 'green plants'], ['plants', 'photosynthetic bacteria'], ['plants', 'some bacteria'],
  ['algae', 'plants'], ['algae', 'green plants'], ['algae', 'photosynthetic bacteria'], ['algae', 'some bacteria'],
  ['green plants', 'plants'], ['green plants', 'algae'], ['green plants', 'photosynthetic bacteria'], ['green plants', 'some bacteria'],
  ['photosynthetic bacteria', 'plants'], ['photosynthetic bacteria', 'algae'], ['photosynthetic bacteria', 'green plants'], ['photosynthetic bacteria', 'some bacteria'],
  ['some bacteria', 'plants'], ['some bacteria', 'algae'], ['some bacteria', 'green plants'], ['some bacteria', 'photosynthetic bacteria'],
];
const directedActiveVariants = [
  ...['capture', 'absorb', 'harness', 'convert', 'transform'].map((verbLemma) => ({
    type: 'coordinated-active', verbLemma, verbForm: 'BASE', malformed: false, voice: 'ACTIVE',
    render: (subjects, light) => `${subjects[0]} and ${subjects[1]} ${verbLemma} ${light}`,
    supportMembers: [],
  })),
  {
    type: 'mediated-active', verbLemma: 'capture', verbForm: 'BASE', malformed: false, voice: 'ACTIVE',
    render: (subjects, light) => `${subjects[0]} and ${subjects[1]} use chlorophyll to capture ${light}`,
    supportMembers: (subjects) => subjects.slice(),
  },
];
const directedPassiveVerbs = ['store', 'capture', 'absorb', 'harness', 'convert', 'transform'];
const directedLightForms = ['light', 'sunlight', 'solar energy'];
const directedContexts = [
  { text: '', type: 'NONE', variant: 'NONE' },
  { text: ' in photosynthesis', type: 'EXPLICIT_SUBJECT', variant: 'IN' },
  { text: ' for photosynthesis', type: 'EXPLICIT_SUBJECT', variant: 'FOR' },
];
const directedExpectedLemma = (surface) => evaluator.normalizeExactFormLemmaV2(surface);
const directedSemanticKey = (item) => JSON.stringify({
  frames: [
    {
      grammarShape: 'PASSIVE_LOCAL_AGENT',
      orderedSubjectLemmasAndRoleClasses: item.passiveMembers.map((surface) => ({ lemma: directedExpectedLemma(surface), roleClass: surface ? 'UNSUPPORTED_AGENT' : 'EMPTY_MEMBER' })),
      coordinationTypeAndCardinality: { type: 'AND', cardinality: item.passiveMembers.length },
      voice: 'PASSIVE',
      verbLemmaAndMorphology: { lemma: item.passiveVerbLemma, form: 'PAST_PARTICIPLE' },
      directObjectRoleAndNormalizedLightForm: { role: 'LIGHT_OBJECT', form: 'light-energy' },
      objectBindingOrigin: 'PASSIVE_SUBJECT',
      auxiliaryChain: ['is'], modal: null, controlChain: null, polarityStructure: 'AFFIRMED',
      orderedBarrierTypes: item.passiveBarriers,
      clauseSentenceTopology: 'FRAME_0_OF_2_SAME_SENTENCE', contextBindingType: 'NONE',
      pronounAntecedentTopology: [], pigmentIdentity: null, invalidClaimType: 'UNSUPPORTED_PASSIVE_AGENT', expectedDecision: false,
    },
    {
      grammarShape: item.sibling.type === 'mediated-active' ? 'ACTIVE_INFINITIVAL_MEDIATED' : 'ACTIVE_SIMPLE',
      orderedSubjectLemmasAndRoleClasses: item.sibling.members.map((surface) => ({ lemma: directedExpectedLemma(surface), roleClass: 'SUPPORTED_BIOLOGICAL_AGENT' })),
      coordinationTypeAndCardinality: { type: 'AND', cardinality: item.sibling.members.length },
      voice: 'ACTIVE',
      verbLemmaAndMorphology: { lemma: item.sibling.verbLemma, form: item.sibling.verbForm },
      directObjectRoleAndNormalizedLightForm: { role: 'LIGHT_OBJECT', form: 'light-energy' },
      objectBindingOrigin: 'ACTIVE_DIRECT_OBJECT',
      auxiliaryChain: [], modal: null, controlChain: item.sibling.type === 'mediated-active' ? ['USE', 'INFINITIVAL_TO'] : null,
      polarityStructure: 'AFFIRMED', orderedBarrierTypes: ['COORDINATED_SUBJECT_AND'],
      clauseSentenceTopology: 'FRAME_1_OF_2_SAME_SENTENCE', contextBindingType: 'EXPLICIT_SUBJECT',
      pronounAntecedentTopology: [], pigmentIdentity: item.sibling.type === 'mediated-active' ? 'chlorophyll' : null,
      invalidClaimType: null, expectedDecision: false,
    },
  ],
  orderedBarrierTypes: ['COMMA_AND'],
  clauseSentenceTopology: 'ONE_SENTENCE_TWO_FRAMES',
});

test('directed all-invalid passive comma-and family preserves active and mediated sibling ownership', async () => {
  const packaged = await packageEvaluator();
  const targetCases = 3000;
  const totalVariants = directedPassiveConfigurations.length * directedPassiveVerbs.length
    * directedSiblingPairs.length * directedActiveVariants.length * directedLightForms.length * directedContexts.length;
  const keys = new Set();
  const counts = { allInvalid: 0, coordinated: 0, mediated: 0, contextBindings: Object.create(null), contextVariants: Object.create(null), patterns: Array(commaAndMalformedRoleShapes.length).fill(0) };
  for (let index = 0; index < targetCases; index += 1) {
    let ordinal = Math.floor((index + 0.5) * totalVariants / targetCases);
    const context = directedContexts[ordinal % directedContexts.length]; ordinal = Math.floor(ordinal / directedContexts.length);
    const lightForm = directedLightForms[ordinal % directedLightForms.length]; ordinal = Math.floor(ordinal / directedLightForms.length);
    const activeVariant = directedActiveVariants[ordinal % directedActiveVariants.length]; ordinal = Math.floor(ordinal / directedActiveVariants.length);
    const siblingMembers = directedSiblingPairs[ordinal % directedSiblingPairs.length]; ordinal = Math.floor(ordinal / directedSiblingPairs.length);
    const passiveVerbLemma = directedPassiveVerbs[ordinal % directedPassiveVerbs.length]; ordinal = Math.floor(ordinal / directedPassiveVerbs.length);
    const configuration = directedPassiveConfigurations[ordinal % directedPassiveConfigurations.length];
    const { shape, shapeIndex, subjects: passiveSubjects } = configuration;
    const passiveMembers = shape.members(passiveSubjects);
    const past = (verb) => verb + (verb.endsWith('e') ? 'd' : 'ed');
    const siblingText = activeVariant.render(siblingMembers, lightForm);
    const input = `Light is ${past(passiveVerbLemma)} by ${shape.render(passiveSubjects)}, and ${siblingText}${context.text}`;
    const supportMembers = typeof activeVariant.supportMembers === 'function' ? activeVariant.supportMembers(siblingMembers) : activeVariant.supportMembers;
    const sibling = { ...activeVariant, members: siblingMembers, supportMembers };
    const item = { input, passiveMembers, passiveValidity: 'ALL_INVALID', passiveVerbLemma, passiveBarriers: shape.barriers, lightForm, contextType: context.type, sibling };
    item.structuralKey = directedSemanticKey(item);
    assert.equal(keys.has(item.structuralKey), false, `duplicate normalized semantic key at directed case ${index}`);
    keys.add(item.structuralKey);
    counts.allInvalid += 1;
    counts[activeVariant.type === 'mediated-active' ? 'mediated' : 'coordinated'] += 1;
    counts.contextBindings[context.type] = (counts.contextBindings[context.type] || 0) + 1;
    counts.contextVariants[context.variant] = (counts.contextVariants[context.variant] || 0) + 1;
    counts.patterns[shapeIndex] += 1;

    const source = assertMalformedPassiveMatrixCase(item, evaluator);
    const built = assertMalformedPassiveMatrixCase(item, packaged);
    assert.deepEqual(built, source, input);
    assert.deepEqual(frameProjection(built), frameProjection(source), input);
    assert.equal(packaged.semanticCaseFingerprint(built), evaluator.semanticCaseFingerprint(source), input);
    const validSubjects = passiveSubjects.length === 2 ? ['plants', 'algae'] : ['plants', 'algae', 'green plants'];
    const validTwin = `Light is ${past(passiveVerbLemma)} by ${validSubjects.join(' and ')}, and ${siblingText}${context.text}`;
    const validSource = evaluator.evaluatePhotosynthesisRelationsV2(validTwin);
    const validBuilt = packaged.evaluatePhotosynthesisRelationsV2(validTwin);
    assert.deepEqual(validBuilt, validSource, validTwin);
    assert.equal(validSource.passed, true, validTwin);
    assert.equal(validSource.hasMalformed, false, validTwin);
    assert.equal(frameProjection(validSource)[0].malformed, false, validTwin);
  }
  assert.equal(counts.allInvalid, targetCases);
  assert.equal(counts.coordinated + counts.mediated, targetCases);
  assert.equal(counts.mediated > 0, true);
  assert.equal(keys.size, targetCases);
  console.log(`ALL_INVALID_COMMA_AND_DIRECTED ${targetCases}/${keys.size}; categories=${JSON.stringify(counts)}; failures=0; source/package mismatches=0`);
});

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
  ['plants', 'rocks'],
  ['rocks', 'plants'],
  ['algae', 'animals'],
  ['animals', 'algae'],
  ['plants', 'rocks', 'bacteria'],
  ['animals', 'algae', 'rocks'],
];
const unsupportedPassiveEntitySurfaces = new Set(['animals', 'rocks', 'bacteria']);
const passiveValidityOf = (subjects) => {
  const validCount = subjects.filter((surface) => !unsupportedPassiveEntitySurfaces.has(surface)).length;
  return validCount === subjects.length ? 'ALL_VALID' : validCount === 0 ? 'ALL_INVALID' : 'MIXED_INVALID';
};
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
      const item = { input, passiveMembers, passiveValidity: passiveValidityOf(passiveSubjects), sibling: { ...sibling, members: sibling.members(siblingSubjects), supportMembers: sibling.supportMembers } };
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
  assert.equal(cases, 4797);
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
    "if (subject.coordinator !== 'AND') return false;",
    "if (subject.coordinator !== 'AND' || !subject.members.at(-1)?.surface) return false;"));
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
  const j = loadMutant(replaceOnce(sourceText,
    "if (subject.coordinator !== 'AND') return false;",
    "if (subject.coordinator !== 'AND' || !subject.members.some((member) => member.valid)) return false;"));
  assert.doesNotThrow(() => j.evaluatePhotosynthesisRelationsV2(exactCases[2].input));
  assert.throws(() => assertMalformedPassiveBoundary(exactCases[2], j), { code: 'ERR_ASSERTION' });
  assert.doesNotThrow(() => j.evaluatePhotosynthesisRelationsV2(exactCases[3].input));
  assert.throws(() => assertMalformedPassiveBoundary(exactCases[3], j), { code: 'ERR_ASSERTION' });
  console.log('NEW_H-I_MUTATIONS 2/2 MEANINGFUL; NEW_J_MUTATION 1/1 MEANINGFUL; crashes=0');
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

function createMalformedPassiveHoldoutCase(random, familyIndex, validityMode) {
  const subjects = ['plants', 'algae', 'green plants', 'photosynthetic bacteria', 'some bacteria'];
  const unsupportedSubjects = ['animals', 'rocks', 'bacteria'];
  const supportedSubjectForms = new Set(['plant', 'plants', 'green plant', 'green plants', 'alga', 'algae', 'some bacteria', 'photosynthetic bacterium', 'photosynthetic bacteria', 'photosynthesis', 'chlorophyll']);
  const verbs = ['capture', 'absorb', 'harness', 'convert', 'transform', 'store'];
  const past = (verb) => verb + (verb.endsWith('e') ? 'd' : 'ed');
  const pick = (values) => values[Math.floor(random() * values.length)];
  const sampleFrom = (values, count) => {
    const pool = values.slice();
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [pool[index], pool[swap]] = [pool[swap], pool[index]];
    }
    return pool.slice(0, count);
  };
  const sample = (count) => sampleFrom(subjects, count);
  const makeMalformedPassive = (validityMode) => {
    const patterns = [
      { id: 'comma-duplicate', count: 2, barriers: ['COMMA_AND', 'DUPLICATE_CONJUNCTION'], render: ([a, b]) => `${a}, and and ${b}`, members: ([a, b]) => [a, '', b] },
      { id: 'plain-duplicate', count: 2, barriers: ['AND', 'DUPLICATE_CONJUNCTION'], render: ([a, b]) => `${a} and and ${b}`, members: ([a, b]) => [a, '', b] },
      { id: 'comma-empty', count: 2, barriers: ['COMMA', 'EMPTY_MEMBER', 'COMMA_AND'], render: ([a, b]) => `${a}, , and ${b}`, members: ([a, b]) => [a, '', b] },
      { id: 'terminal-empty', count: 2, barriers: ['SERIAL_COMMA', 'TRAILING_CONJUNCTION'], render: ([a, b]) => `${a}, ${b}, and`, members: ([a, b]) => [a, b, ''] },
      { id: 'internal-empty', count: 3, barriers: ['SERIAL_COMMA', 'EMPTY_MEMBER', 'COMMA_AND'], render: ([a, b, c]) => `${a}, ${b}, , and ${c}`, members: ([a, b, c]) => [a, b, '', c] },
      { id: 'duplicate-after-and', count: 3, barriers: ['AND', 'DUPLICATE_CONJUNCTION', 'AND'], render: ([a, b, c]) => `${a} and ${b} and and ${c}`, members: ([a, b, c]) => [a, b, '', c] },
      { id: 'repeated-empty', count: 3, barriers: ['COMMA_AND', 'DUPLICATE_CONJUNCTION', 'AND', 'DUPLICATE_CONJUNCTION'], render: ([a, b, c]) => `${a}, and and ${b} and and ${c}`, members: ([a, b, c]) => [a, '', b, '', c] },
    ];
    const pattern = pick(patterns);
    const count = pattern.count;
    const validMembers = sampleFrom(subjects, count);
    const invalidMembers = sampleFrom(unsupportedSubjects, count);
    const members = validityMode === 0 ? validMembers
      : validityMode === 1 ? count === 2 ? [validMembers[0], invalidMembers[0]] : [validMembers[0], invalidMembers[0], validMembers[1]]
        : validityMode === 2 ? count === 2 ? [invalidMembers[0], validMembers[0]] : [invalidMembers[0], validMembers[0], invalidMembers[1]]
          : invalidMembers;
    const verbLemma = pick(verbs);
    const validEntityCount = members.filter((surface) => supportedSubjectForms.has(evaluator.normalizeExactFormLemmaV2(surface))).length;
    const passiveValidity = validEntityCount === members.length ? 'ALL_VALID' : validEntityCount === 0 ? 'ALL_INVALID' : 'MIXED_INVALID';
    return {
      type: 'malformed-passive',
      shape: pattern.id,
      barrierTypes: pattern.barriers,
      text: `Light is ${past(verbLemma)} by ${pattern.render(members)}`,
      members: pattern.members(members),
      passiveValidity,
      malformed: true,
      voice: 'PASSIVE',
      grammarShape: 'PASSIVE_LOCAL_AGENT',
      verbLemma,
      verbForm: 'PAST_PARTICIPLE',
      lightForm: 'light',
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
      return { type, text: `${subject} ${past(verbLemma)} ${light}`, members: [subject], malformed: false, voice: 'ACTIVE', grammarShape: 'ACTIVE_SIMPLE', verbLemma, verbForm: 'PAST', lightForm: light, barrierTypes: [], modal: null, supportMembers: [] };
    }
    if (type === 'multiword-active') {
      const subject = pick(['green plants', 'photosynthetic bacteria', 'some bacteria']);
      const verbLemma = pick(['capture', 'absorb', 'harness', 'convert', 'transform']);
      return { type, text: `${subject} ${past(verbLemma)} ${light}`, members: [subject], malformed: false, voice: 'ACTIVE', grammarShape: 'ACTIVE_SIMPLE', verbLemma, verbForm: 'PAST', lightForm: light, barrierTypes: [], modal: null, supportMembers: [] };
    }
    if (type === 'coordinated-active') {
      const members = sample(2);
      const verbLemma = pick(['capture', 'absorb', 'harness', 'convert', 'transform']);
      return { type, text: `${members[0]} and ${members[1]} ${verbLemma} ${light}`, members, malformed: false, voice: 'ACTIVE', grammarShape: 'ACTIVE_SIMPLE', verbLemma, verbForm: 'BASE', lightForm: light, barrierTypes: ['COORDINATED_SUBJECT_AND'], modal: null, supportMembers: [] };
    }
    if (type === 'mediated-active') {
      const members = sample(2);
      return { type, text: `${members[0]} and ${members[1]} use chlorophyll to capture ${light}`, members, malformed: false, voice: 'ACTIVE', grammarShape: 'ACTIVE_INFINITIVAL_MEDIATED', verbLemma: 'capture', verbForm: 'BASE', lightForm: light, barrierTypes: ['COORDINATED_SUBJECT_AND'], modal: null, supportMembers: members.slice() };
    }
    if (type === 'modal-active') {
      const subject = pick(subjects);
      const verbLemma = pick(['capture', 'absorb', 'harness', 'convert', 'transform']);
      return { type, text: `${subject} must ${verbLemma} ${light}`, members: [subject], malformed: false, voice: 'ACTIVE', grammarShape: 'ACTIVE_SIMPLE', verbLemma, verbForm: 'BASE', lightForm: light, barrierTypes: [], modal: 'must', supportMembers: [] };
    }
    if (type === 'valid-passive') {
      const members = sample(2);
      const verbLemma = pick(verbs);
      return { type, text: `Light is ${past(verbLemma)} by ${members[0]} and ${members[1]}`, members, malformed: false, voice: 'PASSIVE', grammarShape: 'PASSIVE_LOCAL_AGENT', verbLemma, verbForm: 'PAST_PARTICIPLE', lightForm: 'light', barrierTypes: ['COORDINATED_AGENT_AND'], modal: null, supportMembers: [] };
    }
    const members = sample(2);
    const verbLemma = pick(verbs);
    return { type, text: `${members[0]} and and ${members[1]} ${past(verbLemma)} ${light}`, members: [members[0], '', members[1]], malformed: true, voice: 'ACTIVE', grammarShape: 'ACTIVE_SIMPLE', verbLemma, verbForm: 'PAST', lightForm: light, barrierTypes: ['AND', 'DUPLICATE_CONJUNCTION'], modal: null, supportMembers: [] };
  };
  const makeModal = () => {
    const subject = pick(subjects);
    const verbLemma = pick(['capture', 'absorb', 'harness', 'convert', 'transform']);
    return { type: 'modal-active', text: `${subject} must ${verbLemma} sunlight`, members: [subject], malformed: false, voice: 'ACTIVE', grammarShape: 'ACTIVE_SIMPLE', verbLemma, verbForm: 'BASE', lightForm: 'sunlight', barrierTypes: [], modal: 'must', supportMembers: [] };
  };
  const badPassive = makeMalformedPassive(validityMode);
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
  const context = pick([
    { text: '', variant: 'NONE' },
    { text: ' in photosynthesis', variant: 'IN' },
    { text: ' for photosynthesis', variant: 'FOR' },
  ]);
  const contextEligibleFrames = frames.map((frame, index) => frame.type !== 'malformed-active' ? index : null).filter((index) => index !== null);
  const contextTarget = context.variant === 'NONE' ? null : pick(contextEligibleFrames);
  const contextBindingType = contextTarget === null ? 'NONE' : frames[contextTarget].voice === 'PASSIVE' ? 'LOCAL_ADJUNCT' : 'EXPLICIT_SUBJECT';
  frames.forEach((frame, index) => {
    frame.contextBindingType = frame.type === 'malformed-active' ? 'NONE'
      : frame.voice === 'PASSIVE' ? index === contextTarget ? 'LOCAL_ADJUNCT' : 'NONE'
        : 'EXPLICIT_SUBJECT';
  });
  const text = frames.map((frame, index) => frame.text + (index === contextTarget ? context.text : '')).reduce((all, part, index) => all + (index ? boundaries[index - 1] : '') + part, '');
  const boundaryClass = (boundary) => boundary.includes('.') ? 'SENTENCE_END'
    : boundary.includes(';') || boundary.includes(':') ? 'SEMICOLON_BARRIER'
      : boundary.includes('but') ? boundary.includes(',') ? 'COMMA_BUT' : 'BUT'
        : boundary.includes(',') ? 'COMMA_AND' : 'AND';
  const frameSentenceIndices = [];
  let sentenceIndex = 0;
  for (let index = 0; index < frames.length; index += 1) {
    frameSentenceIndices.push(sentenceIndex);
    if (boundaries[index] && boundaryClass(boundaries[index]) === 'SENTENCE_END') sentenceIndex += 1;
  }
  const sentenceCount = sentenceIndex + 1;
  const roleClass = (surface) => !surface ? 'EMPTY_MEMBER'
    : surface === 'chlorophyll' ? 'PIGMENT_AGENT'
      : supportedSubjectForms.has(evaluator.normalizeExactFormLemmaV2(surface)) ? 'BIOLOGICAL_AGENT' : 'UNSUPPORTED_AGENT';
  const structuralKey = JSON.stringify({
    frames: frames.map((frame, index) => ({
      grammarShape: frame.grammarShape,
      orderedSubjectLemmasAndRoleClasses: frame.members.map((surface) => ({
        lemma: surface ? evaluator.normalizeExactFormLemmaV2(surface) : '',
        roleClass: roleClass(surface),
      })),
      coordinationTypeAndCardinality: { type: frame.members.length > 1 ? 'AND' : 'SINGLE', cardinality: frame.members.length },
      voice: frame.voice,
      verbLemmaAndMorphology: { lemma: frame.verbLemma, form: frame.verbForm },
      directObjectRoleAndNormalizedLightForm: { role: 'LIGHT_OBJECT', form: 'light-energy' },
      objectBindingOrigin: frame.voice === 'PASSIVE' ? 'PASSIVE_SUBJECT' : 'ACTIVE_DIRECT_OBJECT',
      auxiliaryChain: frame.voice === 'PASSIVE' ? ['is'] : frame.modal ? [frame.modal] : [],
      modal: frame.modal,
      controlChain: frame.type === 'mediated-active' ? ['USE', 'INFINITIVAL_TO'] : null,
      polarityStructure: 'AFFIRMED',
      orderedBarrierTypes: frame.barrierTypes || [],
      clauseSentenceTopology: { frameSentenceIndex: frameSentenceIndices[index], sentenceCount },
      contextBindingType: frame.contextBindingType,
      pronounAntecedentTopology: [],
      pigmentIdentity: frame.type === 'mediated-active' ? 'chlorophyll' : null,
      invalidClaimType: frame.type === 'malformed-passive' ? frame.passiveValidity
        : frame.type === 'malformed-active' ? 'MALFORMED_ACTIVE_COORDINATION' : null,
      expectedDecision: false,
    })),
    orderedBarrierTypes: boundaries.map(boundaryClass),
    clauseSentenceTopology: { sentenceCount, frameCount: frames.length },
  });
  return { text, frames, boundaries, structuralKey, familyIndex, validityMode, contextVariant: context.variant, contextType: contextBindingType, contextTarget };
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
    if (expected.contextBindingType !== 'NONE') {
      assert.ok(actual.records.length > 0, item.text);
      assert.ok(actual.records.every((record) => record.processContext === expected.contextBindingType), item.text);
    }
    if (expected.malformed) {
      assert.ok(actual.records.every((record) => !record.qualifies), item.text);
      assert.equal(actual.records.some((record) => record.relationType === 'CHLOROPHYLL_SUPPORT' && record.qualifies), false, item.text);
      if (expected.type === 'malformed-passive') {
        const subjectValidity = expected.passiveValidity === 'ALL_INVALID' ? 'ALL_INVALID' : 'MIXED_INVALID';
        assert.ok(actual.records.every((record) => record.voice === 'PASSIVE' && record.subjectValidity === subjectValidity
          && record.verbLemma === expected.verbLemma && record.verbForm === expected.verbForm
          && record.lightObject.binding === 'PASSIVE_SUBJECT'), item.text);
      }
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

function normalizedHoldoutObservation(result) {
  const normalize = (surface) => surface ? evaluator.normalizeExactFormLemmaV2(surface) : '';
  const normalizeMember = ([surface, role]) => [role === 'UNSUPPORTED' ? 'UNSUPPORTED_SUBJECT' : normalize(surface), role];
  const normalizeObject = (value) => value ? { role: value.role || null, normalized: value.normalized || value.lemma || null } : null;
  const frames = frameProjection(result);
  return JSON.stringify({
    decision: result.passed,
    polarity: result.polarity,
    hasMalformed: result.hasMalformed,
    topology: result.topology,
    frames: frames.map((frame) => ({
      sentenceIndex: frame.sentenceIndex,
      clauseIndex: frame.clauseIndex,
      malformed: frame.malformed,
      subjectSets: frame.subjectSets.map((group) => group.map(normalizeMember)),
      coordinationTopology: frame.coordinationTopology.map((topology) => ({
        type: topology.type,
        cardinality: topology.cardinality,
        orderedMembers: topology.orderedMembers.map(normalizeMember),
        shapeValid: topology.shapeValid,
      })),
      records: frame.records.map((record) => ({
        relationType: record.relationType,
        grammarShape: record.grammarShape,
        subject: {
          role: record.subjectSet?.role || null,
          lemma: record.subjectSet?.role === 'UNSUPPORTED' ? 'UNSUPPORTED_SUBJECT' : normalize(record.subjectSet?.lemma || record.subjectSet?.surface),
          valid: record.subjectSet?.valid ?? null,
          coordinator: record.subjectSet?.coordinator || null,
          shapeValid: record.subjectSet?.shapeValid ?? null,
          subjectValidity: record.subjectValidity,
        },
        voice: record.voice,
        verbLemma: record.verbLemma,
        verbForm: record.verbForm,
        auxiliaryChain: record.auxiliaryChain?.chain || [],
        modal: record.modal,
        controlChain: record.controlChain ? [record.controlChain.type, record.controlChain.surface] : null,
        polarity: [record.polarity, record.polarityReason],
        directObject: normalizeObject(record.directObject),
        lightObject: record.lightObject ? { ...normalizeObject(record.lightObject), binding: record.lightObject.binding || null } : null,
        instrument: normalizeObject(record.instrumentSet),
        objectBarriers: record.objectBarriers?.type || null,
        objectBarrierEncountered: record.objectBarrierEncountered,
        processContext: record.processContext,
        qualifies: record.qualifies,
        rejectionReasons: record.rejectionReasons.slice().sort(),
      })),
    })),
  });
}

function differingSemanticPaths(left, right, path = '') {
  if (Object.is(left, right)) return [];
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return [path || '$'];
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].flatMap((key) => differingSemanticPaths(left[key], right[key], path ? `${path}.${key}` : key));
}

function semanticValueAt(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

test('fresh deterministic malformed-passive holdout covers 5,400 cases and normalized structural keys with source/package parity', async () => {
  const packaged = await packageEvaluator();
  const seeds = [0x0D63249A, 0xCC53D5C3, 0x4A06223B];
  const cases = [];
  const keys = new Set();
  const inputs = new Set();
  const fingerprints = new Set();
  const fingerprintGroups = new Map();
  const familyCounts = Array(8).fill(0);
  const validityCounts = { ALL_VALID: 0, MIXED_INVALID: 0, ALL_INVALID: 0 };
  const shapeCounts = Object.create(null);
  const boundaryCounts = Object.create(null);
  const contextVariants = { IN: 0, FOR: 0, NONE: 0 };
  const contextBindingCounts = { LOCAL_ADJUNCT: 0, EXPLICIT_SUBJECT: 0, NONE: 0 };
  for (const seed of seeds) {
    const random = holdoutRandom(seed);
    let accepted = 0;
    for (let attempts = 0; accepted < 1800; attempts += 1) {
      assert.ok(attempts < 400000, `holdout generator stalled for seed 0x${seed.toString(16)}`);
      const familyIndex = accepted % 8;
      const validityMode = Math.floor(accepted / 8) % 4;
      const item = createMalformedPassiveHoldoutCase(random, familyIndex, validityMode);
      if (keys.has(item.structuralKey) || inputs.has(item.text)) continue;
      keys.add(item.structuralKey);
      inputs.add(item.text);
      cases.push(item);
      familyCounts[familyIndex] += 1;
      const malformedPassive = item.frames.find((frame) => frame.type === 'malformed-passive');
      shapeCounts[malformedPassive.shape] = (shapeCounts[malformedPassive.shape] || 0) + 1;
      validityCounts[malformedPassive.passiveValidity] += 1;
      for (const boundary of item.boundaries) {
        const type = boundary === ', and ' ? 'COMMA_AND' : boundary === ' and ' ? 'AND'
          : boundary === ', but ' ? 'COMMA_BUT' : boundary === ' but ' ? 'BUT'
            : boundary === '; ' ? 'SEMICOLON' : 'PERIOD';
        boundaryCounts[type] = (boundaryCounts[type] || 0) + 1;
      }
      contextVariants[item.contextVariant] += 1;
      contextBindingCounts[item.contextType] += 1;
      accepted += 1;
    }
  }
  assert.equal(cases.length, 5400);
  assert.ok(keys.size >= 4500, `unique normalized structural keys ${keys.size} < 4500`);
  assert.equal(keys.size, cases.length, 'holdout structural keys must be unique');
  const failures = [];
  for (const item of cases) {
    try {
      const source = assertMalformedPassiveHoldoutCase(item, evaluator);
      const built = assertMalformedPassiveHoldoutCase(item, packaged);
      const fingerprint = evaluator.semanticCaseFingerprint(source);
      fingerprints.add(fingerprint);
      const group = fingerprintGroups.get(fingerprint) || [];
      group.push({ item, observation: normalizedHoldoutObservation(source) });
      fingerprintGroups.set(fingerprint, group);
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
  assert.ok(fingerprints.size >= 4500, `unique semantic fingerprints ${fingerprints.size} < 4500`);
  const collisionGroups = [...fingerprintGroups.values()].filter((group) => group.length > 1);
  const collisionTriage = collisionGroups.map((group) => {
    const observations = new Set(group.map((entry) => entry.observation));
    const parsedObservations = group.map((entry) => JSON.parse(entry.observation));
    const expectedKeys = group.map((entry) => JSON.parse(entry.item.structuralKey));
    const differingFields = [...new Set(expectedKeys.slice(1).flatMap((value) => differingSemanticPaths(expectedKeys[0], value)))].sort();
    const differingObservedFields = [...new Set(parsedObservations.slice(1).flatMap((value) => differingSemanticPaths(parsedObservations[0], value)))].sort();
    return {
      classification: observations.size === 1 ? 'NORMALIZATION_EQUIVALENT' : 'SEMANTIC_FINGERPRINT_COLLISION',
      reason: observations.size === 1 ? 'normalized source frames and relation records are identical' : 'normalized source observations differ under one fingerprint',
      differingExpectedFields: differingFields,
      differingObservedFields: differingObservedFields.map((path) => ({ path, values: parsedObservations.map((observation) => semanticValueAt(observation, path)) })),
      cases: group.map(({ item }) => ({ input: item.text, family: item.familyIndex, shape: item.frames.find((frame) => frame.type === 'malformed-passive').shape, passiveValidity: item.frames.find((frame) => frame.type === 'malformed-passive').passiveValidity, contextBinding: item.contextType, contextVariant: item.contextVariant, boundaries: item.boundaries.map((boundary) => boundary === ', and ' ? 'COMMA_AND' : boundary === ' and ' ? 'AND' : boundary === ' but ' ? 'BUT' : boundary === ', but ' ? 'COMMA_BUT' : boundary === '; ' ? 'SEMICOLON' : 'SENTENCE_END') })),
    };
  });
  assert.equal(collisionTriage.filter((group) => group.classification === 'SEMANTIC_FINGERPRINT_COLLISION').length, 0,
    JSON.stringify(collisionTriage.filter((group) => group.classification === 'SEMANTIC_FINGERPRINT_COLLISION').slice(0, 8)));
  console.log(`MALFORMED_PASSIVE_HOLDOUT ${JSON.stringify({ seeds: seeds.map((seed) => `0x${seed.toString(16).padStart(8, '0').toUpperCase()}`), cases: cases.length, uniqueNormalizedStructuralKeys: keys.size, uniqueSemanticFingerprints: fingerprints.size, familyCounts, validityCounts, shapeCounts, boundaryCounts, contextVariants, contextBindingCounts, materialFailures: failures.length, failureFamilies, fingerprintCollisionCount: collisionGroups.length, fingerprintCollisionCases: collisionGroups.reduce((sum, group) => sum + group.length, 0), fingerprintCollisionTriage: collisionTriage, examples: failures.slice(0, 24) })}`);
  assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 8)));
});
}
