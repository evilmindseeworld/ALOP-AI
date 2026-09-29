'use strict';

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

const malformedCases = [];
for (const noun of freshNouns) {
  for (const [position, makeSubject] of malformedTemplates) {
    const subject = makeSubject(noun);
    malformedCases.push({ position, noun, subject, voice: 'active', input: `${subject} absorb sunlight.` });
    malformedCases.push({
      position,
      noun,
      subject,
      voice: 'passive',
      input: `Sunlight is absorbed by ${subject} during photosynthesis.`,
    });
  }
}

const boundaryCases = [];
for (const noun of freshNouns) {
  const subject = `, and ${noun} and algae`;
  for (const [boundary, prefix] of [
    ['period', 'Plants capture light energy. '],
    ['semicolon', 'Plants capture light energy; '],
  ]) {
    boundaryCases.push({
      position: 'initial', noun, subject, boundary, voice: 'active',
      input: `${prefix}${subject} absorb sunlight.`,
    });
    boundaryCases.push({
      position: 'initial', noun, subject, boundary, voice: 'passive',
      input: `${prefix}Sunlight is absorbed by ${subject} during photosynthesis.`,
    });
  }
}

const validControls = [];
for (const noun of freshNouns) {
  for (const [kind, continuation] of [
    ['plain', 'Plants and algae absorb sunlight.'],
    ['initial-and', 'And plants and algae absorb sunlight.'],
    ['initial-but', 'But plants and algae absorb sunlight.'],
  ]) {
    validControls.push({ noun, kind, input: `${noun} grow. ${continuation}` });
  }
}

const optionalCommaControls = Object.freeze([
  'plants and algae',
  'plants, and algae',
  'plants, algae and plants',
  'plants, algae, and plants',
]);

module.exports = {
  freshNouns,
  malformedCases,
  boundaryCases,
  validControls,
  optionalCommaControls,
};
