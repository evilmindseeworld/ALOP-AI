'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  OPENROUTER_POLICY,
  OpenRouterPolicyError,
  assertAllowedOpenRouterModel,
  isAllowedOpenRouterModel,
} = require('./openrouter-policy');
const { callModel, fetchOpenRouterStream } = require('./openrouter');
const { parseLadder } = require('./model-ladder');

const response = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const silencePolicyWarnings = (run) => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(message);
  return Promise.resolve()
    .then(run)
    .finally(() => { console.warn = originalWarn; });
};

test('FREE_ONLY allows explicit free ids and the free router alias', () => {
  assert.equal(OPENROUTER_POLICY, 'FREE_ONLY');
  for (const model of ['model-a:free', 'model-b:free', 'openrouter/free']) {
    assert.equal(isAllowedOpenRouterModel(model), true, `${model} must remain permitted`);
    assert.doesNotThrow(() => assertAllowedOpenRouterModel(model));
  }
});

test('FREE_ONLY denies auto, paid, unknown, malformed, and missing model ids', () => {
  return silencePolicyWarnings(() => {
    for (const model of [
      'openrouter/auto',
      'model-a',
      'model-b',
      'openai/gpt-5.6-luna',
      'openai/gpt-5.6-luna:paid',
      'model-a:free:high',
      '',
      null,
    ]) {
      assert.equal(isAllowedOpenRouterModel(model), false, `${model} must be refused`);
      assert.throws(
        () => assertAllowedOpenRouterModel(model, { source: 'policy-test' }),
        (error) => error instanceof OpenRouterPolicyError
          && error.code === 'OPENROUTER_PAID_MODEL_BLOCKED'
          && error.policy === 'FREE_ONLY',
      );
    }
  });
});

test('model-ladder normalization preserves the free suffix before policy evaluation', () => {
  const [rung] = parseLadder('deepseek/model-a:free:high');
  assert.deepEqual(rung, { model: 'deepseek/model-a:free', effort: 'high' });
  assert.equal(isAllowedOpenRouterModel(rung.model), true);
});

test('a blocked model is refused before the non-streaming request or attempt accounting', async () => {
  await silencePolicyWarnings(async () => {
    const attempts = [];
    let fetches = 0;
    global.fetch = async () => { fetches++; return response(200); };

    await assert.rejects(
      callModel('https://openrouter.ai/api/v1', 'key', 'openai/gpt-5.6-luna', [], 0, 1000, 20, undefined, {
        onAttempt: (row) => attempts.push(row),
      }),
      (error) => error.code === 'OPENROUTER_PAID_MODEL_BLOCKED',
    );
    assert.equal(fetches, 0);
    assert.deepEqual(attempts, []);
  });
});

test('a blocked model is refused before the streaming request', async () => {
  await silencePolicyWarnings(async () => {
    let fetches = 0;
    global.fetch = async () => { fetches++; return response(200); };

    await assert.rejects(
      fetchOpenRouterStream('https://openrouter.ai/api/v1', 'key', 'openrouter/auto', []),
      (error) => error.code === 'OPENROUTER_PAID_MODEL_BLOCKED',
    );
    assert.equal(fetches, 0);
  });
});

test('a failed free attempt cannot fall through to a paid fallback request', async () => {
  await silencePolicyWarnings(async () => {
    let fetches = 0;
    global.fetch = async () => {
      fetches++;
      return response(503, { error: 'free provider unavailable' });
    };

    await assert.rejects(
      callModel('https://openrouter.ai/api/v1', 'key', 'model-a:free', [], 0, 1000, 20, undefined, { maxRetries: 0 }),
      /OpenRouter 503/,
    );
    await assert.rejects(
      callModel('https://openrouter.ai/api/v1', 'key', 'model-a', [], 0, 1000, 20, undefined, { maxRetries: 0 }),
      (error) => error.code === 'OPENROUTER_PAID_MODEL_BLOCKED',
    );
    assert.equal(fetches, 1, 'the paid fallback must not reach fetch');
  });
});

test('the standalone OpenRouter probe guards its model immediately before POST', () => {
  const source = readFileSync(join(__dirname, '..', '..', 'tools', 'or-probe.mjs'), 'utf8');
  const post = source.indexOf('fetchTransiently(`${API_ROOT}/chat/completions`');
  const guard = source.lastIndexOf('assertAllowedOpenRouterModel(model', post);
  assert.ok(post > 0, 'the probe POST is missing');
  assert.ok(guard > 0 && post - guard < 300, 'the probe can POST without the free-only guard');
});
