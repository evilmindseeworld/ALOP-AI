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

test('maxRetries 0 makes a provider 429 exactly one POST', async () => {
  /* The council's half of this contract is in council-run.test.js — that every
   * seat asks for maxRetries 0. This is the other half: that asking for it
   * actually costs one request against the daily cap and not three. The
   * failure it prevents is a policy that reads correctly at the call site and
   * is ignored one module down. */
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return response(429, rateLimit('', { provider_code: 429 }));
  };

  await assert.rejects(
    callModel('https://openrouter.ai/api/v1', 'key', 'model:free', [], 0, 3000, 20, undefined, { maxRetries: 0 }),
    /OpenRouter 429/,
  );
  assert.equal(calls, 1);
});

test('maxRetries is clamped, so a caller cannot invent delays the ladder does not have', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return response(429, rateLimit('', { provider_code: 429 }));
  };

  await assert.rejects(
    callModel('https://openrouter.ai/api/v1', 'key', 'model:free', [], 0, 5000, 20, undefined, { maxRetries: 99 }),
    /OpenRouter 429/,
  );
  assert.equal(calls, 3, 'the ladder is two retries and 99 must not mean 99 requests');
});

test('an unroutable model id is not retried into three requests', async () => {
  /* `inclusionai/ling-3.0-tiny:free` answered a council turn with HTTP 404 in
   * 38ms: OpenRouter still holds the model's record but no provider serves it,
   * so the id cannot be made to answer by asking again. A 404 is not in the
   * retryable set, and this pins that — a dead seat costs one request, and the
   * fix for it is deleting the id, not a backoff. */
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return response(404, { error: { message: 'No endpoints found for inclusionai/ling-3.0-tiny:free', code: 404 } });
  };

  await assert.rejects(
    callModel('https://openrouter.ai/api/v1', 'key', 'inclusionai/ling-3.0-tiny:free', [], 0, 3000, 20),
    /OpenRouter 404/,
  );
  assert.equal(calls, 1);
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

test('a handed-off stream is still aborted when the turn is', async () => {
  // The caller reads the body in a loop that never tests the signal itself, so
  // the fetch is the only route from a cancelled turn to a stopped generation.
  // Dropping the parent listener at handoff leaves a user who closed the tab
  // paying for tokens nobody will read, and nothing logs it.
  const controller = new AbortController();
  let seen = null;
  global.fetch = async (_url, init) => {
    seen = init.signal;
    return response(200, {});
  };

  const stream = await fetchOpenRouterStream(
    'https://openrouter.ai/api/v1',
    'key',
    'model:free',
    [],
    0,
    controller.signal,
  );
  assert.equal(stream.status, 200);
  assert.equal(seen.aborted, false);

  controller.abort(new Error('client disconnected'));
  assert.equal(seen.aborted, true, 'the returned body was left with no route from the turn abort');
});

test('structured mode returns the whole reply; default mode still returns a string', async () => {
  const body = {
    id: 'gen-9',
    model: 'test/model',
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_7', type: 'function', function: { name: 'web_search', arguments: '{"query":"q"}' } }],
      },
      finish_reason: 'tool_calls',
    }],
    usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52 },
  };
  global.fetch = async () => response(200, body);

  const asString = await callModel('https://openrouter.ai/api/v1', 'key', 'test/model:free', [], 0, 1000, 100);
  assert.equal(asString, '', 'the legacy contract is unchanged');

  const reply = await callModel('https://openrouter.ai/api/v1', 'key', 'test/model:free', [], 0, 1000, 100, undefined, { structured: true });
  assert.equal(reply.toolCalls.length, 1, 'the native tool call reached the caller');
  assert.equal(reply.toolCalls[0].id, 'call_7');
  assert.equal(reply.finishReason, 'tool_calls');
  assert.equal(reply.usage.totalTokens, 52);
});

test('structured mode returns an empty reply rather than a string on abort', async () => {
  const controller = new AbortController();
  controller.abort(new Error('gone'));
  global.fetch = async () => { throw new Error('should not be called'); };

  const reply = await callModel('https://openrouter.ai/api/v1', 'key', 'test/model:free', [], 0, 1000, 100, controller.signal, { structured: true });
  assert.equal(typeof reply, 'object');
  assert.equal(reply.content, '');
  assert.equal(reply.finishReason, 'aborted');
  assert.equal(await callModel('https://openrouter.ai/api/v1', 'key', 'test/model:free', [], 0, 1000, 100, controller.signal), '');
});

test('a stream asks the gateway for usage accounting ONLY when told to', async () => {
  let sent = null;
  global.fetch = async (_url, init) => { sent = JSON.parse(init.body); return response(200, {}); };

  // Default OFF. This field goes in the body of the request that writes every
  // answer, and it could not be measured against the live gateway from a
  // machine with no key — see the comment on the request body.
  await fetchOpenRouterStream('https://openrouter.ai/api/v1', 'key', 'test/model:free', [], 0, undefined);
  assert.equal('usage' in sent, false, 'the default request body must be byte-identical to what shipped before');

  await fetchOpenRouterStream('https://openrouter.ai/api/v1', 'key', 'test/model:free', [], 0, undefined, null, { includeUsage: true });
  assert.deepEqual(sent.usage, { include: true });
});

test('a free streamed head synthesis can request high reasoning effort without exposing it', async () => {
  let sent = null;
  global.fetch = async (_url, init) => { sent = JSON.parse(init.body); return response(200, {}); };

  await fetchOpenRouterStream(
    'https://openrouter.ai/api/v1',
    'key',
    'test/model:free',
    [],
    0,
    undefined,
    null,
    { reasoning: { effort: 'high', exclude: true } },
  );

  assert.deepEqual(sent.reasoning, { effort: 'high', exclude: true });
});

/* ---- physical attempt accounting -------------------------------------- */

/* WHY THIS MATTERS AND WHY IT IS HERE. The account-wide ceiling counts
 * OpenRouter REQUESTS, and it derived that count from what the turn was known
 * to have done — one per seat, one for synthesis. That derivation cannot see a
 * retry, and every retry in this file is a real POST against the same daily
 * cap. The hook is the only place the true number exists. */

test('every physical POST is reported once, retries included', async () => {
  const attempts = [];
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return calls < 3
      ? response(500, { error: 'upstream' })
      : response(200, { choices: [{ message: { content: 'ok' } }] });
  };

  const text = await callModel(
    'https://openrouter.ai/api/v1', 'key', 'model:free', [], 0, 5000, 20, undefined,
    { onAttempt: (row) => attempts.push(row) },
  );

  assert.equal(text, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(attempts.map((a) => a.attempt), [1, 2, 3]);
  assert.deepEqual(attempts.map((a) => a.outcome), ['http_error', 'http_error', 'ok']);
  assert.deepEqual(attempts.map((a) => a.status), [500, 500, 200]);
  assert.equal(attempts.every((a) => a.provider === 'openrouter' && a.model === 'model:free'), true);
  assert.equal(attempts.every((a) => a.streamed === false), true);
});

test('one POST is reported exactly once, even when it also throws', async () => {
  const attempts = [];
  global.fetch = async () => response(400, { error: 'bad request' });
  await assert.rejects(
    callModel('https://openrouter.ai/api/v1', 'key', 'test/model:free', [], 0, 1000, 20, undefined,
      { onAttempt: (row) => attempts.push(row) }),
  );
  assert.equal(attempts.length, 1, 'the http_error report must not be followed by a network_error one');
  assert.equal(attempts[0].outcome, 'http_error');
});

test('a request refused before it is sent is not charged as an attempt', async () => {
  const attempts = [];
  let fetched = 0;
  global.fetch = async () => { fetched += 1; return response(200, {}); };
  const controller = new AbortController();
  controller.abort();
  await callModel('https://openrouter.ai/api/v1', 'key', 'test/model:free', [], 0, 1000, 20, controller.signal,
    { onAttempt: (row) => attempts.push(row) });
  assert.equal(fetched, 0);
  assert.deepEqual(attempts, [], 'nothing reached the gateway, so nothing may be counted');
});

test('a recorder that throws cannot break the model call', async () => {
  global.fetch = async () => response(200, { choices: [{ message: { content: 'fine' } }] });
  const text = await callModel('https://openrouter.ai/api/v1', 'key', 'test/model:free', [], 0, 1000, 20, undefined,
    { onAttempt: () => { throw new Error('telemetry exploded'); } });
  assert.equal(text, 'fine');
});

test('the streaming path reports its own POSTs, including the pre-body 429 retry', async () => {
  const attempts = [];
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return calls === 1
      ? response(429, rateLimit('provider_rate_limit', { provider_code: 'x' }), { 'retry-after': '0' })
      : { ...response(200, {}), body: { getReader: () => ({}) } };
  };

  const res = await fetchOpenRouterStream(
    'https://openrouter.ai/api/v1', 'key', 'test/model:free', [], 0, undefined, null,
    { timeoutMs: 5000, maxRetries: 1, onAttempt: (row) => attempts.push(row) },
  );

  assert.equal(res.ok, true);
  assert.deepEqual(attempts.map((a) => [a.attempt, a.outcome]), [[1, 'http_error'], [2, 'ok']]);
  assert.equal(attempts.every((a) => a.streamed === true), true);
});

/* THE ERROR CARRIES WHAT IT SPENT.
 *
 * The retries in this loop are real POSTs against an account-wide daily cap,
 * and lib/pacer.js's breaker counts one failure per CALL. Without the count on
 * the error, a model failing on its third attempt is indistinguishable from one
 * failing on its first, and the breaker needs five calls — fifteen requests —
 * to open on a model that is plainly dead.
 *
 * Watched fail before the fix: `providerAttempts` was undefined. */
test('an error thrown after retries reports how many POSTs it cost', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return response(500, { error: 'upstream' });
  };

  await assert.rejects(
    callModel('https://openrouter.ai/api/v1', 'key', 'model:free', [], 0, 5000, 20),
    (error) => error.providerAttempts === 3,
  );
  assert.equal(calls, 3, 'initial request plus the two retries');
});

/* A failure that never retried spent exactly one. */
test('a non-retryable error reports the single POST it cost', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return response(400, { error: 'bad request' });
  };

  await assert.rejects(
    callModel('https://openrouter.ai/api/v1', 'key', 'model:free', [], 0, 5000, 20),
    (error) => error.providerAttempts === 1,
  );
  assert.equal(calls, 1);
});

/* A 200 WHOSE BODY WILL NOT PARSE IS NOT A NETWORK ERROR.
 *
 * The gateway answered, the status was 200, and only the payload was garbage —
 * but the parse threw from inside the `response.ok` branch, landed in the outer
 * catch and was reported as `network_error` with `status: null`. The attempt
 * then counted under `byStatus.none`, the bucket whose whole purpose is
 * "the request produced no reply at all". A window of these would read as
 * connectivity trouble and send someone looking at the wrong layer.
 *
 * Watched fail before the fix: outcome `network_error`, status `null`. */
test('a 200 with an unparseable body keeps its status and is not called a network error', async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => 'not json',
    json: async () => { throw new SyntaxError('Unexpected token o in JSON at position 1'); },
  });

  const attempts = [];
  await assert.rejects(
    callModel('https://openrouter.ai/api/v1', 'key', 'test/model:free', [], 0, 1000, 20, null, {
      onAttempt: (row) => attempts.push(row),
    }),
  );

  assert.equal(attempts.length, 1, 'one physical request, reported once');
  assert.equal(attempts[0].status, 200, 'the status the gateway actually returned');
  assert.notEqual(attempts[0].outcome, 'network_error', 'the network delivered a reply');
  assert.notEqual(attempts[0].outcome, 'ok', 'and the reply was unusable');
});
