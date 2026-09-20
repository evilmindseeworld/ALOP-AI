'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOutputContract,
  assessOutputObligations,
  selectObligationPreservingDraft,
  outputObligationPrompt,
} = require('./answer-obligations');

test('requested code artifacts remain fenced through synthesis across coding tasks', () => {
  const cases = [
    {
      question: 'Write a JavaScript function that reverses a string. Code only.',
      source: '```js\nfunction reverse(value) { return [...value].reverse().join(\'\'); }\n```',
      flattened: 'function reverse(value) { return value; }',
    },
    {
      question: 'Provide a Python function that parses a CSV row. Code only.',
      source: '```python\ndef parse_row(line):\n    return line.split(\',\')\n```',
      flattened: 'def parse_row(line): return line.split(\',\')',
    },
  ];

  for (const { question, source, flattened } of cases) {
    const contract = buildOutputContract({ question });
    assert.equal(contract.code.required, true, question);
    assert.equal(assessOutputObligations({ text: source, contract }).ok, true, question);
    assert.equal(assessOutputObligations({ text: flattened, contract }).ok, false, question);
    assert.equal(
      selectObligationPreservingDraft({ contract, drafts: [{ content: source }] }),
      source,
      question,
    );
  }
});

test('format obligations generalize to JSON, tables, and enumerated output', () => {
  const json = buildOutputContract({ question: 'Return valid JSON with the name and value fields.' });
  const table = buildOutputContract({ question: 'Compare the options in a Markdown table.' });
  const list = buildOutputContract({ question: 'List the three steps in order.' });

  assert.equal(assessOutputObligations({ text: '```json\n{"name":"x","value":1}\n```', contract: json }).ok, true);
  assert.equal(assessOutputObligations({ text: '| A | B |\n|---|---|\n| 1 | 2 |', contract: table }).ok, true);
  assert.equal(assessOutputObligations({ text: '1. First\n2. Second\n3. Third', contract: list }).ok, true);
  assert.equal(assessOutputObligations({ text: 'A paragraph.', contract: table }).ok, false);
});

test('ordinary mentions of code, JSON, tables, and linked lists do not create output obligations', () => {
  assert.equal(buildOutputContract({ question: 'How does code work?' }).code.required, false);
  assert.equal(buildOutputContract({ question: 'What format is JSON?' }).json.required, false);
  assert.equal(buildOutputContract({ question: 'What is a table in HTML?' }).table.required, false);
  assert.equal(buildOutputContract({ question: 'How does a linked list work?' }).list.required, false);
});

test('performance claims require methodology, baseline, and distributional evidence', () => {
  const contract = buildOutputContract({
    question: 'What evidence should I collect before claiming that a backend optimisation made the service faster?',
  });
  const good = 'Measure a baseline and a comparable implementation under the same controlled load, repeat the samples, and report latency p50 and p95.';
  const missingDistribution = 'Measure a baseline and a comparable implementation under the same controlled load and repeat the samples.';

  assert.equal(contract.performance.required, true);
  assert.equal(assessOutputObligations({ text: good, contract }).ok, true);
  assert.equal(assessOutputObligations({ text: missingDistribution, contract }).ok, false);
  assert.match(outputObligationPrompt(contract), /p50|p95|percentile/i);
});
