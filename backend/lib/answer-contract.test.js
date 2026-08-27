'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COMPLETENESS_CONTRACT,
  assessAnswer,
  buildAnswerContract,
} = require('./answer-contract');

const history = [
  { role: 'user', content: 'The release must stay within budget and avoid adding a datastore.' },
  { role: 'assistant', content: 'That keeps the first rollout small.' },
  { role: 'user', content: 'A small team will operate it, so the runbook must stay simple.' },
  { role: 'assistant', content: 'Incremental measurement will help.' },
  { role: 'user', content: 'Account-sensitive answers need freshness, and the release needs a rollback path.' },
  { role: 'assistant', content: 'Those paths need stronger guarantees.' },
];

test('a contextual collection request creates coverage obligations', () => {
  const contract = buildAnswerContract({
    question: 'Which requirements did I mention that should guide the release?',
    history,
  });

  assert.equal(contract.requiresCoverage, true);
  assert.equal(contract.units.length, 3);
});

test('a readable fragment cannot be treated as a complete contextual answer', () => {
  const contract = buildAnswerContract({
    question: 'Which requirements did I mention that should guide the release?',
    history,
  });
  const result = assessAnswer({
    answer: 'You mentioned staying within budget',
    contract,
    finishReason: 'stop',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'context_coverage');
  assert.equal(result.coveredUnits, 1);
});

test('a concise answer that covers each context unit remains complete', () => {
  const contract = buildAnswerContract({
    question: 'Which requirements did I mention that should guide the release?',
    history,
  });
  const result = assessAnswer({
    answer: 'Keep the release within budget without a new datastore; account for the small team and simple operations; keep sensitive answers fresh and maintain a rollback path.',
    contract,
    finishReason: 'stop',
  });

  assert.equal(result.ok, true);
  assert.equal(result.coverage, 1);
});

test('ordinary concise answers are not rejected for lacking context coverage', () => {
  const contract = buildAnswerContract({ question: 'What is the capital of France?', history: [] });
  const result = assessAnswer({ answer: 'Paris.', contract, finishReason: 'stop' });

  assert.equal(contract.requiresCoverage, false);
  assert.equal(result.ok, true);
});

test('provider truncation is incomplete even when the text looks readable', () => {
  const result = assessAnswer({
    answer: 'The rollout should begin with a measured baseline.',
    contract: buildAnswerContract({ question: 'How should I begin?' }),
    finishReason: 'length',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'provider_truncation');
});

test('the synthesis contract is general rather than tied to an evaluator case', () => {
  assert.match(COMPLETENESS_CONTRACT, /every explicit part/i);
  assert.match(COMPLETENESS_CONTRACT, /condition|dimension|measurement|caveat|counterargument/i);
  assert.doesNotMatch(COMPLETENESS_CONTRACT, /long-context|evidence-before|model-disagreement/);
});
