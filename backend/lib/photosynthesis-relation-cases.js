'use strict';

/*
 * Deterministic generated matrix for photosynthesis-light-relation-v1.
 * The matrix is deliberately data-only: the evaluator, not this fixture, owns
 * the semantic decision. The suffix keeps every generated input and id stable
 * while exercising the same relation under controlled lexical variation.
 */
const POSITIVE_TEMPLATES = [
  (verb, light) => `Photosynthesis is how plants use chlorophyll to ${verb} ${light} and make food.`,
  (verb, light) => `Plants use chlorophyll to ${verb} ${light} during photosynthesis.`,
  (verb, light) => `During photosynthesis, chlorophyll ${verb}s ${light}.`,
  (verb, light) => `Chlorophyll ${verb}s ${light} for photosynthesis.`,
  (verb, light) => `Photosynthesis ${verb}s ${light}. It is driven by chlorophyll.`,
];

const POSITIVE_VERBS = ['capture', 'absorb', 'harness', 'convert'];
const LIGHT_OBJECTS = ['light energy', 'sunlight', 'solar energy', 'solar light'];

const NEGATIVE_TEMPLATES = [
  (light) => `Photosynthesis is the process by which plants convert ${light} into chemical energy.`,
  (light) => `Plants do not use chlorophyll to capture ${light} during photosynthesis.`,
  (light) => `Photosynthesis does not use chlorophyll to capture ${light}.`,
  (light) => `Photosynthesis never uses chlorophyll to harness ${light}.`,
  (light) => `Photosynthesis is not driven by chlorophyll, but it captures ${light}.`,
  (light) => `Photosynthesis cannot use chlorophyll to capture ${light}.`,
  (light) => `Photosynthesis uses chlorophyll to not capture ${light}.`,
  (light) => `Photosynthesis destroys ${light}. It is driven by chlorophyll.`,
  (light) => `Photosynthesis wastes ${light}. This process is powered by chlorophyll.`,
  (light) => `Photosynthesis ignores ${light} completely. It is powered by chlorophyll.`,
  (light) => `Plants use melanin instead of chlorophyll to capture ${light}.`,
  (light) => `Photosynthesis uses melanin to capture ${light}, and chlorophyll plays no role.`,
  (light) => `Chlorophyll is unrelated to photosynthesis, although plants capture ${light}.`,
  (light) => `Chlorophyll plays no role in photosynthesis; plants capture ${light}.`,
  (light) => `Chlorophyll prevents plants from using ${light}.`,
  (light) => `Photosynthesis converts ${light} into chemical energy. Chlorophyll is a pigment found in plants.`,
  () => 'Plants, chlorophyll, and light are mentioned here, but plants do not use chlorophyll and release no oxygen during photosynthesis.',
];

const makeCase = (kind, index, answer, expected) => Object.freeze({
  id: `photosynthesis-light-relation-v1-generated-${kind}-${String(index).padStart(4, '0')}`,
  generated: true,
  answer: `${answer} Case ${index}.`,
  expected,
});

const generatedCases = [];
let positiveIndex = 0;
for (const template of POSITIVE_TEMPLATES) {
  for (const verb of POSITIVE_VERBS) {
    for (const light of LIGHT_OBJECTS) {
      for (let variant = 0; variant < 5; variant += 1) {
        positiveIndex += 1;
        generatedCases.push(makeCase('positive', positiveIndex, template(verb, light), true));
      }
    }
  }
}

let negativeIndex = 0;
while (negativeIndex < 423) {
  const template = NEGATIVE_TEMPLATES[negativeIndex % NEGATIVE_TEMPLATES.length];
  const light = LIGHT_OBJECTS[negativeIndex % LIGHT_OBJECTS.length];
  negativeIndex += 1;
  generatedCases.push(makeCase('negative', negativeIndex, template(light), false));
}

if (generatedCases.length !== 823) {
  throw new Error(`photosynthesis generated case count drifted: ${generatedCases.length}`);
}

const PHOTOSYNTHESIS_RELATION_CASES = Object.freeze(generatedCases);

module.exports = {
  EXPECTED_GENERATED_CASE_COUNT: 823,
  PHOTOSYNTHESIS_RELATION_CASES,
  generatedCases: PHOTOSYNTHESIS_RELATION_CASES,
};
