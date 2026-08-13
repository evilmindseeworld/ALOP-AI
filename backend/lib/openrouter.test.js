'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  callModel,
  fetchOpenRouterStream,
  getOpenRouterKeyStatus,
  OpenRouterRateLimitError,
} = require('./openrouter');

const originalFetch = global.fetch;
test.afterEach(() => { global.fetch = originalFetch; });

const response = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  text: async () => JSON.stringify(body),
  json: async () => body,
});

const rateLimit = (limitSource, extra = {}) => ({
  error: {
    message: `Rate limit exceeded: ${limitSource}`,
    code: 429,
    metadata: { limit_source: limitSource, ...extra },
  },
});

test('daily free-tier cap fails distinctly without retrying', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return response(429, rateLimit('openrouter_free_tier_daily'));
  };

  await assert.rejects(
    callModel('https://openrouter.ai/api/v1', 'key', 'model:free', [], 0, 1000, 20),
    (error) => error instanceof OpenRouterRateLimitError
      && error.code === 'OPENROUTER_DAILY_LIMIT'
      && error.kind === 'daily',
  );
  assert.equal(calls, 1);
});

test('per-minute cap retries after its reset when the deadline allows', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return response(429, rateLimit('free-models-per-min'), { 'x-ratelimit-reset': String(Date.now()) });
    }
    return response(200, { choices: [{ message: { content: 'recovered' } }] });
  };

  assert.equal(await callModel('https://openrouter.ai/api/v1', 'key', 'model:free', [], 0, 1000, 20), 'recovered');
  assert.equal(calls, 2);
});

test('per-minute cap fails without retry when reset cannot fit the deadline', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return response(429, rateLimit('free-models-per-min'), { 'x-ratelimit-reset': String(Date.now() + 50) });
  };

  await assert.rejects(
    callModel('https://openrouter.ai/api/v1', 'key', 'model:free', [], 0, 10, 20),
    (error) => error instanceof OpenRouterRateLimitError && error.kind === 'per-minute',
  );
  assert.equal(calls, 1);
});

test('provider 429 retains two retries', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return response(429, rateLimit('', { provider_code: 429 }));
  };

  await assert.rejects(callModel('https://openrouter.ai/api/v1', 'key', 'model:free', [], 0, 3000, 20), /OpenRouter 429/);
  assert.equal(calls, 3);
});

test('stream provider 429 retries before any bytes are available', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) return response(429, rateLimit('', { provider_code: 429 }), { 'retry-after': '0' });
    return response(200, { choices: [{ delta: { content: 'recovered' } }] });
  };

  const stream = await fetchOpenRouterStream(
    'https://openrouter.ai/api/v1',
    'key',
    'model:free',
    [],
    0,
    undefined,
    null,
    { deadlineAt: Date.now() + 1000 },
  );
  assert.equal(stream.status, 200);
  assert.equal(calls, 2);
});

test('stream provider 429 uses jittered backoff when Retry-After is absent', async () => {
  const originalRandom = Math.random;
  Math.random = () => 0;
  const fetchTimes = [];
  try {
    global.fetch = async () => {
      fetchTimes.push(Date.now());
      if (fetchTimes.length === 1) return response(429, rateLimit('', { provider_code: 429 }));
      return response(200, {});
    };

    await fetchOpenRouterStream(
      'https://openrouter.ai/api/v1',
      'key',
      'model:free',
      [],
      0,
      undefined,
      null,
      { deadlineAt: Date.now() + 1000 },
    );
  } finally {
    Math.random = originalRandom;
  }
  assert.ok(fetchTimes[1] - fetchTimes[0] >= 180, `retry was not delayed: ${fetchTimes[1] - fetchTimes[0]}ms`);
});

test('stream provider Retry-After that misses the deadline makes no second request', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return response(429, rateLimit('', { provider_code: 429 }), { 'retry-after': '60' });
  };

  await assert.rejects(
    fetchOpenRouterStream(
      'https://openrouter.ai/api/v1',
      'key',
      'model:free',
      [],
      0,
      undefined,
      null,
      { deadlineAt: Date.now() + 100 },
    ),
    (error) => error?.status === 429 && error?.retryAfterMs === 60_000,
  );
  assert.equal(calls, 1);
});

test('stream success uses the default deadline when none is supplied', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return response(200, {});
  };

  const stream = await fetchOpenRouterStream('https://openrouter.ai/api/v1', 'key', 'model:free', []);
  assert.equal(stream.status, 200);
  assert.equal(calls, 1);
});

test('abort still returns an empty string', async () => {
  const controller = new AbortController();
  controller.abort();
  global.fetch = async () => { throw new Error('fetch must not run'); };
  assert.equal(await callModel('https://openrouter.ai/api/v1', 'key', 'model:free', [], 0, 1000, 20, controller.signal), '');
});

test('key status uses the account endpoint and returns only capacity fields', async () => {
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return response(200, { data: { is_free_tier: true, usage: 12, limit_remaining: 38, label: 'private' } });
  };

  assert.deepEqual(await getOpenRouterKeyStatus('https://openrouter.ai/api/v1/chat/completions', 'secret'), {
    isFreeTier: true,
    usage: 12,
    limitRemaining: 38,
  });
  assert.equal(request.url, 'https://openrouter.ai/api/v1/key');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.Authorization, 'Bearer secret');
});
