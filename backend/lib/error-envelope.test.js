'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyError, errorEnvelope, sendError, CODES } = require('./error-envelope');

const withEnv = (value, fn) => {
  const previous = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  try { return fn(); } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
};

const fakeRes = () => ({
  headersSent: false,
  writableEnded: false,
  statusCode: null,
  headers: {},
  body: null,
  req: {},
  set(name, value) { this.headers[name] = value; },
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

test('an unrecognised throw is a 500 that says nothing about itself', () => {
  withEnv('production', () => {
    const { status, body } = errorEnvelope(new Error('relation "users" does not exist'));
    assert.equal(status, 500);
    assert.equal(body.code, CODES.INTERNAL);
    assert.equal(body.error, 'Internal server error.');
    assert.equal(body.detail, undefined, 'the thrown message must not reach a production client');
  });
});

test('the thrown message is kept as detail outside production', () => {
  withEnv('development', () => {
    const { body } = errorEnvelope(new Error('relation "users" does not exist'));
    assert.equal(body.error, 'Internal server error.', 'the safe prose is the same in every environment');
    assert.equal(body.detail, 'relation "users" does not exist');
  });
});

test('the mask is no longer a deployment-configuration question', () => {
  // The old handler masked only when NODE_ENV === 'production'. A deploy with
  // NODE_ENV unset returned every thrown message.
  withEnv(undefined, () => {
    const { body } = errorEnvelope(new Error('postgres://user:pw@host'));
    assert.equal(body.error, 'Internal server error.');
  });
});

test('a 4xx message IS returned — it describes the caller’s own request', () => {
  const err = new Error('Message must be under 8000 characters.');
  err.status = 400;
  withEnv('production', () => {
    const { status, body } = errorEnvelope(err);
    assert.equal(status, 400);
    assert.equal(body.code, CODES.BAD_REQUEST);
    assert.equal(body.error, 'Message must be under 8000 characters.');
    assert.equal(body.detail, undefined, 'detail would only duplicate error on a 4xx');
  });
});

test('CORS is a 403 even though it carries no status', () => {
  const { status, body } = classifyError(new Error('CORS: https://evil.example'));
  assert.equal(status, 403);
  assert.equal(body, undefined);
  const env = errorEnvelope(new Error('CORS: https://evil.example'));
  assert.equal(env.status, 403);
  assert.equal(env.body.code, CODES.CORS_REJECTED);
  assert.equal(env.body.error.includes('evil.example'), false, 'the rejected origin is not echoed back');
});

test('provider limits are typed rather than internal', () => {
  const daily = Object.assign(new Error('free-models-per-day'), { code: 'OPENROUTER_DAILY_LIMIT' });
  assert.equal(errorEnvelope(daily).status, 503);
  assert.equal(errorEnvelope(daily).body.code, CODES.MODEL_QUOTA_EXHAUSTED);

  const perMinute = Object.assign(new Error('free-models-per-min'), { code: 'OPENROUTER_RATE_LIMIT' });
  assert.equal(errorEnvelope(perMinute).body.code, CODES.MODEL_RATE_LIMITED);
});

test('a cancelled turn is not reported as a fault', () => {
  const abort = new DOMException('Client disconnected', 'AbortError');
  const { status, body } = errorEnvelope(abort);
  assert.equal(status, 499);
  assert.equal(body.code, CODES.CLIENT_CLOSED);
});

test('network and timeout conditions map to gateway statuses', () => {
  assert.equal(errorEnvelope(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })).status, 504);
  assert.equal(errorEnvelope(Object.assign(new Error('x'), { code: 'OPENROUTER_DEADLINE' })).status, 504);
  assert.equal(errorEnvelope(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })).status, 502);
  assert.equal(errorEnvelope(new DOMException('slow', 'TimeoutError')).status, 504);
});

test('a Postgres unique violation is a conflict, not a 500', () => {
  const { status, body } = errorEnvelope(Object.assign(new Error('duplicate key'), { code: '23505' }));
  assert.equal(status, 409);
  assert.equal(body.code, CODES.CONFLICT);
});

test('a declared status wins over a guess and keeps a sensible code', () => {
  assert.equal(errorEnvelope(Object.assign(new Error('nope'), { statusCode: 404 })).body.code, CODES.NOT_FOUND);
  assert.equal(errorEnvelope(Object.assign(new Error('nope'), { status: 418 })).body.code, CODES.BAD_REQUEST);
  assert.equal(errorEnvelope(Object.assign(new Error('nope'), { status: 599 })).body.code, CODES.INTERNAL);
  assert.equal(errorEnvelope(Object.assign(new Error('nope'), { status: 99 })).status, 500, 'a nonsense status is not honoured');
});

test('the operation id is echoed in the body and as a header', () => {
  const { body } = errorEnvelope(new Error('x'), { operationId: 'op-123' });
  assert.equal(body.operationId, 'op-123');

  const res = refusalRes();
  res.req.operationId = 'op-456';
  const status = sendError(res, new Error('boom'));
  assert.equal(status, 500);
  assert.equal(res.headers['X-Operation-Id'], 'op-456');
  assert.equal(res.body.operationId, 'op-456');
});

test('sendError never writes to a response that is already gone', () => {
  const res = refusalRes();
  res.headersSent = true;
  sendError(res, new Error('boom'));
  assert.equal(res.body, null, 'a streamed turn that failed late must not have a JSON body appended');

  const ended = fakeRes();
  ended.writableEnded = true;
  sendError(ended, new Error('boom'));
  assert.equal(ended.body, null);
});

test('a route may supply its own user-facing sentence', () => {
  const { body } = errorEnvelope(new Error('supabase down'), { message: 'Could not save that chat.' });
  assert.equal(body.error, 'Could not save that chat.');
  assert.equal(body.code, CODES.INTERNAL, 'the code still describes what happened');
});

test('non-Error throws do not crash the envelope', () => {
  for (const bad of [null, undefined, 'string', 42, {}]) {
    const { status, body } = errorEnvelope(bad);
    assert.equal(status, 500);
    assert.equal(typeof body.error, 'string');
  }
});

test('the wire shape stays backwards compatible', () => {
  // Existing clients read `error` as a plain string at the top level. `code`,
  // `operationId` and `detail` are additive; nothing moved.
  const { body } = errorEnvelope(new Error('x'), { operationId: 'op' });
  assert.equal(typeof body.error, 'string');
});

// ===== deliberate refusals =====
//
// Most 4xx/5xx responses in server.js are not thrown errors: the route knows
// what is wrong and has already written the sentence. Those were plain
// `res.status(n).json({ error })` — no code to branch on, no id to quote.

const { fail } = require('./error-envelope');

const refusalRes = (operationId = 'op-1') => ({
  req: { operationId },
  headers: {},
  headersSent: false,
  writableEnded: false,
  statusCode: null,
  body: null,
  set(k, v) { this.headers[k] = v; return this; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test('a refusal keeps the route prose and gains a type and an id', () => {
  const res = refusalRes();
  assert.equal(fail(res, 400, 'Attach at most 4 images.'), 400);
  assert.deepEqual(res.body, { error: 'Attach at most 4 images.', code: 'bad_request', operationId: 'op-1' });
  assert.equal(res.headers['X-Operation-Id'], 'op-1');
});

test('the code follows the status when the caller does not name one', () => {
  for (const [status, code] of [[401, 'unauthenticated'], [403, 'forbidden'], [404, 'not_found'], [409, 'conflict'], [503, 'upstream_unavailable']]) {
    const res = refusalRes();
    fail(res, status, 'x');
    assert.equal(res.body.code, code, String(status));
  }
});

test('a status with no mapping still gets a code rather than none', () => {
  // 402 is the ceilings' status and has no generic meaning worth guessing.
  const res = refusalRes();
  fail(res, 402, 'Out of requests.');
  assert.equal(res.body.code, 'bad_request', 'a 4xx with no mapping falls back to the client-error code');
  const named = refusalRes();
  fail(named, 402, 'Out of requests.', 'model_quota_exhausted');
  assert.equal(named.body.code, 'model_quota_exhausted');
});

test('the ceilings keep the extra fields a client already reads', () => {
  const res = refusalRes();
  fail(res, 402, 'Out of requests.', 'model_quota_exhausted', { reason: 'daily_request_limit', usedRequests: 50 });
  assert.equal(res.body.reason, 'daily_request_limit');
  assert.equal(res.body.usedRequests, 50);
  assert.equal(res.body.code, 'model_quota_exhausted');
});

test('nothing is written to a response that has already answered', () => {
  const res = refusalRes();
  res.headersSent = true;
  assert.equal(fail(res, 500, 'too late'), 500);
  assert.equal(res.body, null, 'a second write on a sent response throws in express');
});

test('no operationId still produces a valid body, without an empty field', () => {
  const res = refusalRes(null);
  fail(res, 404, 'Not found.');
  assert.deepEqual(res.body, { error: 'Not found.', code: 'not_found' });
  assert.equal(res.headers['X-Operation-Id'], undefined);
});

test('every error response in server.js is typed', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const src = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
  const untyped = [...src.matchAll(/res\.status\([45]\d\d\)\.json\(/g)];
  assert.deepEqual(
    untyped.map((m) => src.slice(m.index, m.index + 60)),
    [],
    'a bare res.status(...).json({ error }) has no code for a client to branch on and no operationId for a user to quote — use fail() or sendError()',
  );
});
