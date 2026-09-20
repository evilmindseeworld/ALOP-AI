'use strict';

/*
 * ONE LOGICAL ATTEMPT, COUNTED AT THE SOCKET.
 *
 * `resilience-wiring.test.js` asserts that `maxRetries: 0` is SPELLED at each
 * call site in server.js, which is all a test can do for a file that calls
 * `process.exit(1)` at import time. But spelling is not behaviour: it cannot
 * tell you how many POSTs a 429 actually costs, and it cannot see the defect
 * that made this repair necessary — an adapter whose parameter list was one
 * short, so the option was passed by the caller and silently dropped before
 * it ever reached `callModel`.
 *
 * These tests count real requests through a stubbed transport instead. They
 * exercise `lib/` only and require no production change.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { callModel } = require('./openrouter');
const { fallbacksAfter, DEFAULT_HEAD_LADDER } = require('./model-ladder');

const originalFetch = global.fetch;
test.afterEach(() => { global.fetch = originalFetch; });

const SUPER = 'nvidia/nemotron-3-super-120b-a12b:free';
const ULTRA = 'nvidia/nemotron-3-ultra-550b-a55b:free';

const reply = (content) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ choices: [{ message: { content } }] }),
  text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
});
const httpError = (status) => ({
  ok: false,
  status,
  headers: { get: () => null },
  json: async () => ({ error: { message: 'boom', code: status } }),
  text: async () => 'boom',
});

/** Count POSTs, and answer each one according to the model it names. */
function stubTransport(behaviourByModel) {
  const counts = {};
  global.fetch = async (_url, init) => {
    const { model } = JSON.parse(init.body);
    counts[model] = (counts[model] || 0) + 1;
    const behaviour = behaviourByModel[model] ?? 'ok';
    if (behaviour === 'ok') return reply('answered');
    if (behaviour === 'reset') { const e = new Error('socket hang up'); e.code = 'ECONNRESET'; throw e; }
    if (behaviour === 'timeout') { const e = new Error('timed out'); e.code = 'UND_ERR_CONNECT_TIMEOUT'; throw e; }
    if (behaviour === 'garbage') {
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError('bad body'); }, text: async () => 'x' };
    }
    return httpError(Number(behaviour));
  };
  return counts;
}

const call = (model, options) => callModel(
  'https://openrouter.ai/api/v1', 'key', model, [{ role: 'user', content: 'q' }], 0, 3000, 20, undefined, options,
);

/* ---- what `maxRetries: 0` means, measured ---------------------------- */

test('maxRetries 0 is ONE request, not zero and not the default ladder', async () => {
  /* Zero requests would be a different bug: a bound that silently answers
   * nothing is indistinguishable from a model that refused. */
  const ok = stubTransport({ [SUPER]: 'ok' });
  assert.equal(await call(SUPER, { maxRetries: 0 }), 'answered');
  assert.equal(ok[SUPER], 1, 'a success under the bound still costs exactly one request');

  for (const [failure, matcher] of [['429', /429/], ['500', /500/]]) {
    const bounded = stubTransport({ [SUPER]: failure });
    await assert.rejects(call(SUPER, { maxRetries: 0 }), matcher);
    assert.equal(bounded[SUPER], 1, `a ${failure} under the bound is one POST`);

    const unbounded = stubTransport({ [SUPER]: failure });
    await assert.rejects(call(SUPER, {}), matcher);
    assert.equal(unbounded[SUPER], 3, `a ${failure} without the bound still walks the whole ladder`);
  }
});

test('the bound holds for transport failures and unreadable bodies too', async () => {
  for (const behaviour of ['reset', 'timeout', 'garbage']) {
    const counts = stubTransport({ [SUPER]: behaviour });
    await assert.rejects(call(SUPER, { maxRetries: 0 }));
    assert.equal(counts[SUPER], 1, `${behaviour} costs one request`);
  }
});

test('a non-retryable provider failure keeps the status and code that classify it', async () => {
  stubTransport({ [SUPER]: '429' });
  await assert.rejects(call(SUPER, { maxRetries: 0 }), (error) => error.status === 429
    && error.code === 'OPENROUTER_RATE_LIMIT'
    && error.providerAttempts === 1);

  stubTransport({ [SUPER]: '500' });
  await assert.rejects(call(SUPER, { maxRetries: 0 }), (error) => error.status === 500
    && error.code === 'OPENROUTER_HTTP_ERROR');
});

/* ---- the defect the repair actually closed --------------------------- */

test('an adapter that drops its options argument loses the bound entirely', async () => {
  /* THIS IS THE BUG, REPRODUCED. `lib/council-run.js` has always passed
   * `{ maxRetries: 0 }` as its seventh argument. The server-side council
   * adapters declared six parameters, so the object was evaluated by the
   * caller and thrown away — every seat quietly walked the full retry ladder
   * against an account-wide daily request cap. A grep for `maxRetries: 0`
   * could never have seen this, because the spelling was already correct at
   * the only place anyone thought to look. */
  const seatOptions = { maxRetries: 0 };

  const dropsOptions = async (model, messages, temperature, whipMs, tokenLimit, signal) =>
    callModel('https://openrouter.ai/api/v1', 'key', model, messages, temperature, whipMs, tokenLimit, signal, { structured: true });
  const forwardsOptions = async (model, messages, temperature, whipMs, tokenLimit, signal, callOptions = {}) =>
    callModel('https://openrouter.ai/api/v1', 'key', model, messages, temperature, whipMs, tokenLimit, signal, { ...callOptions, structured: true });

  const dropped = stubTransport({ [SUPER]: '429' });
  await assert.rejects(dropsOptions(SUPER, [], 0, 3000, 20, undefined, seatOptions));
  assert.equal(dropped[SUPER], 3, 'the six-parameter adapter is the regression this pins');

  const forwarded = stubTransport({ [SUPER]: '429' });
  await assert.rejects(forwardsOptions(SUPER, [], 0, 3000, 20, undefined, seatOptions));
  assert.equal(forwarded[SUPER], 1, 'forwarding the seventh argument restores the seat bound');
});

/* ---- suppressing a retry must not suppress recovery ------------------ */

/** The shape of `callModelWithLadder` in server.js, which cannot be imported. */
const withLadder = async (head, attempt) => {
  const chain = [head, ...fallbacksAfter(head, DEFAULT_HEAD_LADDER).map((rung) => rung.model)];
  let lastError = null;
  for (const candidate of chain) {
    try { return await attempt(candidate); } catch (error) { lastError = error; }
  }
  throw lastError;
};

test('one attempt per model still leaves a bounded fallback to the next model', async () => {
  const succeeded = stubTransport({ [SUPER]: 'ok' });
  assert.equal(await withLadder(SUPER, (m) => call(m, { maxRetries: 0 })), 'answered');
  assert.equal(succeeded[SUPER], 1);
  assert.equal(succeeded[ULTRA], undefined, 'a working head must never also spend the fallback');

  for (const failure of ['429', 'timeout', 'garbage']) {
    const recovered = stubTransport({ [SUPER]: failure, [ULTRA]: 'ok' });
    assert.equal(await withLadder(SUPER, (m) => call(m, { maxRetries: 0 })), 'answered');
    assert.equal(recovered[SUPER], 1, `${failure}: the head is tried once`);
    assert.equal(recovered[ULTRA], 1, `${failure}: recovery on another model is still allowed`);
  }

  const exhausted = stubTransport({ [SUPER]: '429', [ULTRA]: '429' });
  await assert.rejects(withLadder(SUPER, (m) => call(m, { maxRetries: 0 })));
  assert.equal(exhausted[SUPER], 1);
  assert.equal(exhausted[ULTRA], 1, 'the last-resort rung is not itself retried');
});
