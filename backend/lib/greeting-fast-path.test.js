'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createGreetingCache } = require('./greeting-cache');

/**
 * THE GREETING BRANCH IS ONLY WORTH ANYTHING WHERE IT SITS.
 *
 * `greeting-cache.test.js` proves the layer answers without a model. It cannot
 * prove the server asks it before spending the round trips the layer exists to
 * avoid — a greeting checked below the ceiling reservations and the three
 * Supabase context reads would pass every one of those tests while still
 * costing the user the wait this branch was added to remove.
 *
 * `server.js` exits during import when env vars are missing, so this asserts on
 * the source text, the seam `arithmetic.test.js` uses for the same reason.
 */
const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

const at = (needle) => {
  const i = SOURCE.indexOf(needle);
  assert.notEqual(i, -1, `anchor vanished from server.js: ${needle}`);
  return i;
};

test('the greeting fast path runs BEFORE the router, the ceilings and the context reads', () => {
  const greeting = at('const greeting = image ? null : await greetingCache.get(pv.value);');
  assert.ok(greeting < at('classifyRequest(pv.value'), 'greeting must short-circuit above the router');
  assert.ok(greeting < at('const budget = await reserveSpend('), 'a greeting must not reserve spend');
  assert.ok(greeting < at('const requestBudget = await reserveRequests('), 'a greeting must not reserve requests');
  assert.ok(greeting < at('const contextReads = Promise.all(['), 'a greeting must not wait on summary/feedback/facts');
});

test('an image turn skips the greeting path', () => {
  // "hi" typed under a screenshot is a question about the screenshot. Tested
  // against `image` from the body, never `imageContext` — that one is the
  // vision model's output and is declared hundreds of lines below.
  assert.match(SOURCE, /const greeting = image \? null : await greetingCache\.get\(pv\.value\);/);
});

test('the greeting branch terminates the stream like every other branch', () => {
  const branch = SOURCE.slice(at("console.log('[COUNCIL] Greeting fast path"), at('const userPlan = user.plan'));
  assert.match(branch, /sendEvent\(res, \{ type: 'chunk', text: greeting \}\)/);
  assert.match(branch, /\[DONE\]/);
  // Without this the one turn the fast path exists to speed up is the one turn
  // with no latency recorded — the note the arithmetic branch already carries.
  assert.match(branch, /msToFirstByte: Date\.now\(\) - t0/);
  assert.match(branch, /models: 0/);
});

test('the layer it calls answers greetings without a cache and never throws', async () => {
  // Guards the assumption the branch above depends on: if this ever needed a
  // working cache to answer, a Postgres blip would turn "hi" into a model call.
  const broken = createGreetingCache({
    answerCache: { keyFor: () => 'k', get: () => Promise.reject(new Error('db down')), setConstant() {} },
    log: { warn() {} },
  });
  assert.equal(typeof await broken.get('hi'), 'string');
  assert.equal(await broken.get('what is the capital of France'), null);
});
