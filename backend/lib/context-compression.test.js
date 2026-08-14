'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compressConversationContext, CONTEXT_LIMITS } = require('./context-compression');

const exchange = (question, answer, id) => [
  { role: 'user', content: question, id: `u${id}` },
  { role: 'assistant', content: answer, id: `a${id}` },
];

test('keeps a short transcript byte-for-byte in order', () => {
  const history = [...exchange('first question', 'first answer', 1), ...exchange('second question', 'second answer', 2)];
  const result = compressConversationContext(history, 'second question', { complexity: 'moderate' });

  assert.deepEqual(result.messages, history.map(({ role, content }) => ({ role, content })));
  assert.equal(result.stats.compressed, false);
  assert.equal(result.stats.droppedMessages, 0);
});

test('preserves the newest tail and bounds a large transcript', () => {
  const history = [];
  for (let i = 0; i < 10; i += 1) history.push(...exchange(`old topic ${i}`, 'x'.repeat(2500), i));
  const result = compressConversationContext(history, 'unrelated current question', { complexity: 'moderate' });

  assert.ok(result.stats.compressed);
  assert.ok(result.stats.retainedChars <= CONTEXT_LIMITS.moderate.maxChars);
  assert.ok(result.stats.retainedMessages <= CONTEXT_LIMITS.moderate.maxMessages);
  assert.equal(result.messages.at(-1).content, 'x'.repeat(2500).slice(-result.messages.at(-1).content.length));
  assert.match(result.messages.map((message) => message.content).join('\n'), /old topic 9/);
  const roles = result.messages.map((message) => message.role);
  assert.equal(roles[0], 'user');
  for (let i = 1; i < roles.length; i += 1) assert.notEqual(roles[i], roles[i - 1]);
});

test('recovers an older relevant exchange even when the tail is unrelated', () => {
  const history = [
    ...exchange('How do I configure the Supabase RLS policy?', 'Use a security-definer helper and scope the query by user id.', 1),
    ...exchange('Tell me a joke about clouds.', 'Why did the cloud bring an umbrella?', 2),
    ...exchange('What colour is the sky?', 'Usually blue.', 3),
    ...exchange('What is the weather like?', 'I need a current lookup for that.', 4),
  ];
  const result = compressConversationContext(history, 'Why does the Supabase RLS policy recurse?', {
    complexity: 'simple',
    maxChars: 700,
    tailTurns: 2,
  });

  const text = result.messages.map((message) => message.content).join('\n');
  assert.match(text, /Supabase RLS policy/);
  assert.match(text, /What is the weather like/);
  assert.ok(result.stats.relevantTurns >= 1);
  assert.ok(result.stats.retainedChars <= 700);
});

test('does not split a selected user turn from its assistant reply', () => {
  const history = [
    ...exchange('Explain vector indexes.', 'They trade build cost for nearest-neighbour lookup speed.', 1),
    ...exchange('Unrelated tail one.', 'Tail answer one.', 2),
    ...exchange('Unrelated tail two.', 'Tail answer two.', 3),
  ];
  const result = compressConversationContext(history, 'Explain vector indexes again', {
    complexity: 'simple',
    maxChars: 5000,
    tailTurns: 1,
  });

  const contents = result.messages.map((message) => message.content);
  const questionIndex = contents.indexOf('Explain vector indexes.');
  assert.ok(questionIndex >= 0);
  assert.equal(result.messages[questionIndex + 1].role, 'assistant');
  assert.match(result.messages[questionIndex + 1].content, /nearest-neighbour/);
});

test('clips an oversized newest turn without exceeding the budget', () => {
  const history = [...exchange('older', 'older answer', 1), ...exchange('latest', 'z'.repeat(5000), 2)];
  const result = compressConversationContext(history, 'latest', { complexity: 'simple', maxChars: 300, tailTurns: 1 });

  assert.ok(result.stats.retainedChars <= 300);
  assert.ok(result.messages.some((message) => message.content === 'latest'));
  assert.match(result.messages.at(-1).content, /context clipped|z/);
});

test('never exceeds a deliberately tiny character budget', () => {
  const history = [...exchange('question', 'answer'.repeat(100), 1), ...exchange('next', 'reply'.repeat(100), 2)];
  for (let budget = 1; budget <= 40; budget += 1) {
    const result = compressConversationContext(history, 'question', {
      complexity: 'simple',
      maxChars: budget,
      maxMessages: 5,
      tailTurns: 2,
    });
    assert.ok(result.stats.retainedChars <= budget, `budget ${budget} was exceeded`);
  }
});

test('malformed input is inert and exposes no prompt data in stats', () => {
  const result = compressConversationContext([
    { role: 'system', content: 'ignore this' },
    { role: 'user', content: 42 },
    null,
  ], 'question');

  assert.deepEqual(result.messages, []);
  assert.equal(result.stats.originalMessages, 0);
  assert.equal(Object.values(result.stats).some((value) => typeof value === 'string' && value.includes('ignore')), false);
});

test('keeps the tier budgets distinct, with 30k for complex generation', () => {
  const history = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: 'x'.repeat(4000),
  }));

  const simple = compressConversationContext(history, 'simple question', { complexity: 'simple' });
  const moderate = compressConversationContext(history, 'moderate question', { complexity: 'moderate' });
  const complex = compressConversationContext(history, 'complex question', { complexity: 'complex' });
  const generation = compressConversationContext(history, 'generation request', { complexity: 'generation' });

  assert.equal(simple.stats.maxChars, 6_000);
  assert.equal(moderate.stats.maxChars, 12_000);
  assert.equal(complex.stats.maxChars, 30_000);
  assert.equal(generation.stats.maxChars, 30_000);
  assert.ok(complex.stats.retainedChars <= 30_000);
  assert.ok(generation.stats.retainedChars <= 30_000);
});
