'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createTurnContext } = require('./turn-context');

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

test('a supplied operation id is kept and a turn id is minted beside it', () => {
  const ctx = createTurnContext({ operationId: 'op-from-client', newId: ids() });
  assert.equal(ctx.operationId, 'op-from-client');
  assert.equal(ctx.turnId, 'id-1');
  assert.deepEqual(ctx.ids(), { operationId: 'op-from-client', turnId: 'id-1' });
});

/* A client that cannot mint one — an old build, a non-secure context where
 * `crypto.randomUUID` is absent — must still produce a correlatable turn. */
test('a missing operation id is minted rather than left null', () => {
  const ctx = createTurnContext({ newId: ids() });
  assert.equal(ctx.turnId, 'id-1');
  assert.equal(ctx.operationId, 'id-2');
});

/* THE POINT OF HAVING TWO. One operation retried twice is one operation and
 * three turns; a ledger keyed on either alone cannot say whether a user was
 * charged once for three executions or three times for one. */
test('a retried operation produces distinct turn ids under one operation id', () => {
  const newId = ids();
  const first = createTurnContext({ operationId: 'op-1', newId });
  const second = createTurnContext({ operationId: 'op-1', newId });
  assert.equal(first.operationId, second.operationId);
  assert.notEqual(first.turnId, second.turnId);
});

test('attempts are counted per component and retries are attempts beyond the first', () => {
  const ctx = createTurnContext({ newId: ids() });
  assert.equal(ctx.attempt('provider'), 1);
  assert.equal(ctx.attempt('provider'), 2);
  assert.equal(ctx.attempt('tool'), 1);
  assert.deepEqual(ctx.attemptCounts(), { provider: 2, tool: 1 });
  assert.equal(ctx.retryCount(), 1, 'one provider retry, no tool retry');
});

test('the deadline is a fact about the turn, not a promise about the clock', () => {
  const ctx = createTurnContext({ startedAt: 1_000, deadlineAt: 3_000, newId: ids() });
  assert.equal(ctx.remainingMs(1_500), 1_500);
  assert.equal(ctx.expired(2_999), false);
  assert.equal(ctx.expired(3_000), true);
  assert.equal(ctx.remainingMs(9_999), 0, 'never negative');

  const unbounded = createTurnContext({ newId: ids() });
  assert.equal(unbounded.remainingMs(), Infinity);
  assert.equal(unbounded.expired(), false);
});

/* The tag is copied into log lines read by people who are not the user whose
 * turn it was. It must carry ids and nothing else. */
test('the log tag is short and carries no user data', () => {
  const ctx = createTurnContext({
    operationId: '4f3a91c2-0000-4000-8000-000000000000',
    userId: 'user-row-id',
    chatId: 'chat-id',
    newId: () => 'aaaaaaaa-1111-4000-8000-000000000000',
  });
  const tag = ctx.tag('COUNCIL');
  assert.equal(tag, '[COUNCIL] op=4f3a91c2 turn=aaaaaaaa');
  assert.doesNotMatch(tag, /user-row-id|chat-id/);
});

test('the council route mints the context and hands it to the telemetry recorder', () => {
  const source = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /require\('\.\/lib\/turn-context'\)/);
  assert.match(source, /createTurnContext\(\{[\s\S]{0,300}?operationId: req\.operationId/);
  assert.match(source, /createTurnTelemetry\(\{ startedAt: t0, context: turnContext \}\)/);
});
