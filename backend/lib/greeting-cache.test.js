const test = require('node:test');
const assert = require('node:assert/strict');
const { createGreetingCache, normaliseGreeting } = require('./greeting-cache');

const makeAnswerCache = ({ hit = null, reject = false } = {}) => {
  const calls = { gets: 0, constants: [] };
  return {
    calls,
    keyFor: ({ question, branch }) => `${branch}:${question}`,
    get: async () => {
      calls.gets++;
      if (reject) throw new Error('database unavailable');
      return hit;
    },
    setConstant: (key, answer, options) => calls.constants.push({ key, answer, options }),
  };
};

test('greetings are deterministic and seed the durable answer cache', async () => {
  const answerCache = makeAnswerCache();
  const greetings = createGreetingCache({ answerCache });

  assert.equal(await greetings.get('  HI!!! '), 'Hi! How can I help?');
  assert.equal(answerCache.calls.gets, 1);
  assert.equal(answerCache.calls.constants.length, 1);
  const [seed] = answerCache.calls.constants;
  assert.equal(seed.key, 'greeting:hi');
  assert.equal(seed.answer, 'Hi! How can I help?');
  assert.equal(seed.options.ttlMs, 365 * 24 * 60 * 60 * 1000);
  /* The row carries the inputs a refresh would need, because a write without
   * them is REJECTED outright — a greeting that never lands durably is one
   * model-free answer per deploy turned back into a model call. It is marked as
   * not search-backed, which is what keeps a constant out of the refresh query
   * it has no business being in. */
  assert.equal(seed.options.inputs.question, 'hi');
  assert.equal(seed.options.inputs.branch, 'greeting');
  assert.equal(seed.options.inputs.usedLiveWeb, false);
});

test('a durable greeting hit avoids reseeding and remains model-free', async () => {
  const answerCache = makeAnswerCache({ hit: { answer: 'You are welcome!', storedAt: Date.now() } });
  const greetings = createGreetingCache({ answerCache });

  assert.equal(await greetings.get('thanks'), 'You are welcome!');
  assert.equal(answerCache.calls.gets, 1);
  assert.equal(answerCache.calls.constants.length, 0);
});

test('thanks and thank-you variants are greeting constants', async () => {
  const greetings = createGreetingCache({ answerCache: makeAnswerCache() });

  assert.equal(await greetings.get('thanks!!!'), 'You are welcome!');
  assert.equal(await greetings.get('thank you'), 'You are welcome!');
  assert.equal(await greetings.get('thx'), 'You are welcome!');
});

test('a non-greeting is not intercepted', async () => {
  const answerCache = makeAnswerCache();
  const greetings = createGreetingCache({ answerCache });

  assert.equal(await greetings.get('thanks for explaining photosynthesis'), null);
  assert.equal(answerCache.calls.gets, 0);
});

test('a broken answer cache falls back to the constant and never throws', async () => {
  const greetings = createGreetingCache({ answerCache: makeAnswerCache({ reject: true }) });

  await assert.doesNotReject(() => greetings.get('hello'));
  assert.equal(await greetings.get('hello'), 'Hello! How can I help?');
});

test('greeting normalization keeps only safe boundary changes', () => {
  assert.equal(normaliseGreeting('  Good\u00a0Morning\uff01 '), 'good morning');
  assert.equal(normaliseGreeting('thanks for helping'), 'thanks for helping');
});
