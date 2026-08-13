const { normalise, TTL_MS } = require('./answer-cache');

/*
 * Greetings are a separate layer because they are not generated answers:
 * their response is a product constant. The answer cache still seeds and
 * reads them from Postgres, so a new process can serve the durable row, while
 * the constant fallback guarantees that a missing or slow cache never reaches
 * a model.
 */
const GREETING_ANSWERS = new Map([
  ['hi', 'Hi! How can I help?'],
  ['hello', 'Hello! How can I help?'],
  ['hey', 'Hey! How can I help?'],
  ['yo', 'Hey! How can I help?'],
  ['sup', 'Hey! How can I help?'],
  ['howdy', 'Howdy! How can I help?'],
  ['gm', 'Good morning! How can I help?'],
  ['good morning', 'Good morning! How can I help?'],
  ['good afternoon', 'Good afternoon! How can I help?'],
  ['good evening', 'Good evening! How can I help?'],
  ['thanks', 'You are welcome!'],
  ['thank you', 'You are welcome!'],
  ['thx', 'You are welcome!'],
]);

const normaliseGreeting = (value) => normalise(value);

function createGreetingCache({ answerCache, log = console } = {}) {
  const warn = (error) => {
    try { log.warn?.('[ANSWERS] greeting cache fallback: ' + (error?.message || error)); } catch {}
  };

  return {
    /**
     * Return a deterministic answer or null when this is not a greeting.
     * A cache miss falls back to the constant, so this function never needs a
     * model call and never makes cache availability part of question success.
     */
    async get(value) {
      const greeting = GREETING_ANSWERS.get(normaliseGreeting(value));
      if (!greeting) return null;

      const key = answerCache?.keyFor?.({
        question: normaliseGreeting(value),
        branch: 'greeting',
      });

      if (key && answerCache?.get) {
        try {
          const hit = await answerCache.get(key);
          if (hit && typeof hit.answer === 'string' && hit.answer.trim()) return hit.answer;
        } catch (error) {
          warn(error);
        }
      }

      if (key && answerCache?.setConstant) {
        try {
          /* The replay inputs are part of every write now, because a row the
           * brain cannot re-ask is a row the brain silently skips. A greeting
           * is never re-asked — `usedLiveWeb: false` keeps it out of the
           * refresh query entirely — but the write is rejected outright without
           * them, and a rejected greeting write is a durable seed that never
           * lands. The values are the same ones `keyFor` was given above; they
           * must not drift, or the row describes a different question than the
           * one it is keyed on. */
          answerCache.setConstant(key, greeting, {
            ttlMs: TTL_MS.greeting,
            inputs: {
              question: normaliseGreeting(value),
              lang: '',
              country: '',
              plan: '',
              detailed: false,
              branch: 'greeting',
              usedLiveWeb: false,
            },
          });
        } catch (error) {
          warn(error);
        }
      }
      return greeting;
    },
  };
}

module.exports = { createGreetingCache, normaliseGreeting, GREETING_ANSWERS };
