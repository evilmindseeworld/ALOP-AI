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
  assert.equal(contract.units.length, 2);
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

  assert.equal(result.ok, true);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.reason, 'context_coverage_uncertain');
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

test('ordinary collection questions do not become conversation recall', () => {
  const questions = [
    'What are the requirements for running PostgreSQL?',
    'What things should I consider when choosing a database?',
    'What is the previous version of React?',
    'Which items are cheapest in this list?',
    'List the factors that affect TCP throughput.',
    'What are the main points of the CAP theorem?',
  ];

  for (const question of questions) {
    const contract = buildAnswerContract({
      question,
      history: [{ role: 'user', content: 'I prefer small, reversible changes.' }],
    });
    assert.equal(contract.kind, 'ordinary', question);
    assert.equal(contract.requiresCoverage, false, question);
  }
});

test('ordinary first-person and assistant-recommendation prompts stay ordinary', () => {
  const questions = [
    'What do you recommend for a database?',
    'How do I set up PostgreSQL?',
    'What can I tell you about TCP throughput?',
    'Why should I list the factors in the report?',
    'Should I mention the requirements in the runbook?',
    'What is the previous version of React?',
  ];

  for (const question of questions) {
    const contract = buildAnswerContract({
      question,
      history: [{ role: 'user', content: 'I mentioned a private deployment earlier.' }],
    });
    assert.equal(contract.kind, 'ordinary', question);
    assert.equal(contract.requiresCoverage, false, question);
  }
});

test('explicit references to what the user or assistant said require conversational context', () => {
  const questions = [
    'What budget did I tell you earlier?',
    'List the constraints I mentioned before.',
    'What did I say previously about deployment?',
    'Use the requirements I gave you earlier.',
    'Remind me what preferences I mentioned.',
    'What did you say earlier in this conversation?',
  ];

  for (const question of questions) {
    const contract = buildAnswerContract({
      question,
      history: [{ role: 'user', content: 'My deployment budget is limited.' }],
    });
    assert.equal(contract.kind, 'contextual_collection', question);
  }
});

test('coverage selects the referenced turn instead of every prior user turn', () => {
  const contract = buildAnswerContract({
    question: 'What datastore constraint did I mention earlier?',
    history: [
      { role: 'user', content: 'Hi there.' },
      { role: 'assistant', content: 'Hello.' },
      { role: 'user', content: 'The weather in Dubai may change tomorrow.' },
      { role: 'assistant', content: 'That needs a current forecast.' },
      { role: 'user', content: 'I need a cheap datastore for session state.' },
      { role: 'assistant', content: 'A small database could work.' },
    ],
  });

  assert.equal(contract.requiresCoverage, true);
  assert.equal(contract.units.length, 1);
});

test('target nouns select the relevant turn without treating the whole history as an obligation', () => {
  const contract = buildAnswerContract({
    question: 'List the constraints I mentioned before.',
    history: [
      { role: 'user', content: 'I need a cheap datastore.' },
      { role: 'user', content: 'The constraints are no public cloud and low latency.' },
      { role: 'user', content: 'The weather may change tomorrow.' },
    ],
  });

  assert.equal(contract.requiresCoverage, true);
  assert.equal(contract.units.length, 1);
  assert.ok(contract.units[0].terms.includes('constraints'));
});

test('a relevant older turn survives unrelated newer history', () => {
  const history = [
    { role: 'user', content: 'I need a cheap datastore for session state.' },
    ...Array.from({ length: 12 }, (_, index) => ({
      role: 'user',
      content: `Unrelated topic ${index} has no storage details.`,
    })),
  ];
  const contract = buildAnswerContract({
    question: 'What datastore did I mention earlier?',
    history,
  });

  assert.equal(contract.requiresCoverage, true);
  assert.equal(contract.units.length, 1);
  assert.ok(contract.units[0].terms.includes('datastore'));
});

test('uncertain lexical coverage stays unknown so a paraphrase is not a false failure', () => {
  const contract = buildAnswerContract({
    question: 'What datastore constraint did I mention earlier?',
    history: [{ role: 'user', content: 'I need a cheap datastore for session state.' }],
  });
  const result = assessAnswer({
    answer: 'You wanted a budget-conscious database.',
    contract,
    finishReason: 'stop',
  });

  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'context_coverage_uncertain');
});

test('a punctuation mark alone does not make a complete answer incomplete', () => {
  const contract = buildAnswerContract({ question: 'Give me a concise label.' });
  for (const answer of ['Status:', 'First; second;', 'One item,', 'Complete.']) {
    const result = assessAnswer({ answer, contract, finishReason: 'stop' });
    assert.equal(result.status, 'KNOWN_COMPLETE', answer);
    assert.equal(result.ok, true, answer);
  }
});

test('provider truncation remains known incomplete despite normal punctuation', () => {
  const result = assessAnswer({
    answer: 'The answer ends normally.',
    contract: buildAnswerContract({ question: 'What is the answer?' }),
    finishReason: 'length',
  });

  assert.equal(result.status, 'KNOWN_INCOMPLETE');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'provider_truncation');
});

test('ordinary single-turn answers stay admissible across common answer shapes', () => {
  const cases = [
    ['yes', 'Yes.'],
    ['no', 'No.'],
    ['one word', 'Ready.'],
    ['arithmetic', '42'],
    ['concise factual response', 'Water freezes at 0°C at standard pressure.'],
    ['one sentence requested', 'Start with a small reversible change.'],
    ['structured list', '- one\n- two'],
    ['colon ending', 'Sources:'],
    ['semicolon ending', 'First; second;'],
    ['comma ending', 'One item,'],
    ['period ending', 'Done.'],
  ];

  for (const [label, answer] of cases) {
    const result = assessAnswer({
      answer,
      contract: buildAnswerContract({ question: 'Give a concise answer.' }),
      finishReason: 'stop',
    });
    assert.equal(result.status, 'KNOWN_COMPLETE', label);
    assert.equal(result.ok, true, label);
  }
});

test('ordinary factual questions remain valid with unrelated conversation history', () => {
  const cases = [
    ['What are the requirements for PostgreSQL?', 'Use a supported operating system and enough memory.'],
    ['What are the main CAP theorem tradeoffs?', 'Consistency, availability, and partition tolerance cannot all be guaranteed together.'],
  ];

  for (const [question, answer] of cases) {
    const contract = buildAnswerContract({
      question,
      history: [
        { role: 'user', content: 'Hi there.' },
        { role: 'assistant', content: 'Hello.' },
        { role: 'user', content: 'Will it rain in Dubai tomorrow?' },
        { role: 'assistant', content: 'That needs a current forecast.' },
      ],
    });
    const result = assessAnswer({ answer, contract, finishReason: 'stop' });
    assert.equal(contract.kind, 'ordinary', question);
    assert.equal(result.status, 'KNOWN_COMPLETE', question);
    assert.equal(result.ok, true, question);
  }
});

test('an explicit recall request with no safely identifiable turn fails open to unknown', () => {
  const contract = buildAnswerContract({
    question: 'List the constraints I mentioned before.',
    history: [
      { role: 'user', content: 'I need a cheap datastore.' },
      { role: 'assistant', content: 'A database may fit.' },
    ],
  });
  const result = assessAnswer({
    answer: 'Use a budget-conscious database.',
    contract,
    finishReason: 'stop',
  });

  assert.equal(contract.kind, 'contextual_collection');
  assert.equal(contract.requiresCoverage, false);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.ok, true);
  assert.equal(result.reason, null);
});

test('known structural truncation remains incomplete without relying on punctuation', () => {
  const contract = buildAnswerContract({ question: 'Explain the deployment plan.' });
  for (const [reason, answer] of [
    ['length', 'Deploy the service after the checks pass.'],
    ['timeout', 'Deploy the service after the checks pass.'],
    ['aborted', 'Deploy the service after the checks pass.'],
    ['open fence', '```js\nconst ready = true;'],
    ['dangling tail', 'The service should remain broadly available with'],
  ]) {
    const result = assessAnswer({ answer, contract, finishReason: reason === 'open fence' || reason === 'dangling tail' ? 'stop' : reason });
    assert.equal(result.status, 'KNOWN_INCOMPLETE', reason);
    assert.equal(result.ok, false, reason);
  }
});
