'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dedupeKey, backoffMs, afterFailure, afterSuccess, isClaimable, claimPatch, nextJobs, enqueue,
} = require('./job-queue');

const NOW = 1_760_000_000_000;
const iso = (ms) => new Date(ms).toISOString();
const job = (extra = {}) => ({
  id: 'j1', kind: 'chat_summary', status: 'pending', attempts: 0,
  run_at: iso(NOW - 1000), lease_until: null, created_at: iso(NOW - 5000), priority: 5, ...extra,
});

/* ---- idempotency --------------------------------------------------------- */

test('the same work produces the same key', () => {
  assert.equal(dedupeKey('chat_summary', ['chat-1', 12]), dedupeKey('chat_summary', ['chat-1', 12]));
});

test('different work produces different keys', () => {
  assert.notEqual(dedupeKey('chat_summary', ['chat-1', 12]), dedupeKey('chat_summary', ['chat-1', 13]));
  assert.notEqual(dedupeKey('chat_summary', ['chat-1', 12]), dedupeKey('fact_extraction', ['chat-1', 12]));
});

test('the key is prefixed with its kind so a queue can be read by eye', () => {
  assert.match(dedupeKey('cache_warm', ['q']), /^cache_warm:[0-9a-f]{24}$/);
});

test('null and undefined parts do not collide with each other by accident', () => {
  assert.equal(dedupeKey('chat_summary', [null]), dedupeKey('chat_summary', [undefined]));
  assert.notEqual(dedupeKey('chat_summary', [null]), dedupeKey('chat_summary', ['null-ish']));
});

/* ---- enqueue ------------------------------------------------------------- */

test('an unknown kind is refused at enqueue rather than sitting unclaimed', () => {
  assert.throws(() => enqueue({ kind: 'not_a_kind' }), TypeError);
});

test('two enqueues of the same declared work share a dedupe key', () => {
  const a = enqueue({ kind: 'chat_summary', chatId: 'c1', keyParts: ['c1', 12], now: NOW });
  const b = enqueue({ kind: 'chat_summary', chatId: 'c1', keyParts: ['c1', 12], now: NOW + 5000 });
  assert.equal(a.dedupe_key, b.dedupe_key, 'the key must not depend on when it was enqueued');
});

/* A setTimeout does not survive the deploy that is the reason this queue
 * exists. A delay is a due date on a row. */
test('a delay is a future run_at, not a timer', () => {
  const row = enqueue({ kind: 'cache_warm', delayMs: 60_000, now: NOW });
  assert.equal(row.run_at, iso(NOW + 60_000));
  assert.equal(row.status, 'pending');
});

test('a job with no delay is due immediately', () => {
  assert.equal(enqueue({ kind: 'cache_warm', now: NOW }).run_at, iso(NOW));
});

/* ---- backoff ------------------------------------------------------------- */

test('backoff grows with each attempt', () => {
  const fixed = { random: () => 1 };
  assert.ok(backoffMs(0, fixed) < backoffMs(1, fixed));
  assert.ok(backoffMs(1, fixed) < backoffMs(2, fixed));
});

test('backoff is capped', () => {
  assert.ok(backoffMs(50, { random: () => 1 }) <= 3_600_000);
});

/* Without jitter every job queued during an outage retries at the same instant
 * — a self-inflicted herd against a service that just said it is struggling. */
test('two jobs failing together do not retry at the same moment', () => {
  const draws = [0.1, 0.9];
  let i = 0;
  const random = () => draws[i++];
  assert.notEqual(backoffMs(2, { random }), backoffMs(2, { random }));
});

test('jitter never produces a negative or zero delay', () => {
  assert.ok(backoffMs(0, { random: () => 0 }) > 0);
});

/* ---- failure and death --------------------------------------------------- */

test('an ordinary failure is rescheduled, not lost', () => {
  const patch = afterFailure(job(), new Error('provider timeout'), { now: NOW, random: () => 1 });
  assert.equal(patch.status, 'pending');
  assert.equal(patch.attempts, 1);
  assert.ok(new Date(patch.run_at).getTime() > NOW);
  assert.equal(patch.lease_until, null, 'a failed job must release its lease or nothing can claim it');
});

test('a job that has failed enough times is dead-lettered', () => {
  const patch = afterFailure(job({ attempts: 4 }), new Error('still failing'), { now: NOW });
  assert.equal(patch.status, 'dead');
  assert.equal(patch.run_at, null);
  assert.equal(typeof patch.dead_at, 'string');
});

/* A malformed payload fails identically every time; five attempts spend an
 * account-wide provider budget proving it. */
test('a failure the caller calls permanent skips the retries', () => {
  const permanent = Object.assign(new Error('chat was deleted'), { permanent: true });
  const patch = afterFailure(job(), permanent, { now: NOW });
  assert.equal(patch.status, 'dead');
  assert.equal(patch.attempts, 1);
});

/* "Which jobs are failing and why" is the only question worth asking about a
 * queue, and a deleted row cannot answer it. */
test('a dead job keeps its error', () => {
  const patch = afterFailure(job({ attempts: 4 }), new Error('the reason'), { now: NOW });
  assert.equal(patch.last_error, 'the reason');
});

test('an error with no message still produces a row', () => {
  assert.equal(typeof afterFailure(job(), undefined, { now: NOW }).last_error, 'string');
});

test('success is terminal and releases the lease', () => {
  const patch = afterSuccess(job({ attempts: 1 }), { now: NOW });
  assert.equal(patch.status, 'done');
  assert.equal(patch.attempts, 2);
  assert.equal(patch.lease_until, null);
  assert.equal(patch.last_error, null);
});

/* ---- claiming ------------------------------------------------------------ */

test('a due, unleased, unfinished job is claimable', () => {
  assert.equal(isClaimable(job(), { now: NOW }), true);
});

test('a job that is not due yet is not claimable', () => {
  assert.equal(isClaimable(job({ run_at: iso(NOW + 60_000) }), { now: NOW }), false);
});

test('a finished job is never claimable', () => {
  assert.equal(isClaimable(job({ status: 'done' }), { now: NOW }), false);
  assert.equal(isClaimable(job({ status: 'dead' }), { now: NOW }), false);
});

test('a job somebody else is holding is not claimable', () => {
  assert.equal(isClaimable(job({ status: 'running', lease_until: iso(NOW + 60_000) }), { now: NOW }), false);
});

/* THE REASON THE LEASE IS A TIMESTAMP. A worker that dies mid-job leaves a
 * lease behind; if that were a boolean the job would be lost forever. */
test('an expired lease means the worker died and the job is free again', () => {
  assert.equal(isClaimable(job({ status: 'running', lease_until: iso(NOW - 1) }), { now: NOW }), true);
});

test('a claim records who took it and when it expires', () => {
  const patch = claimPatch({ leaseMs: 30_000, now: NOW, workerId: 'render-1' });
  assert.equal(patch.status, 'running');
  assert.equal(patch.lease_until, iso(NOW + 30_000));
  assert.equal(patch.claimed_by, 'render-1');
});

/* ---- ordering ------------------------------------------------------------ */

test('only claimable jobs are offered to a worker', () => {
  const out = nextJobs([
    job({ id: 'due' }),
    job({ id: 'later', run_at: iso(NOW + 10_000) }),
    job({ id: 'held', status: 'running', lease_until: iso(NOW + 10_000) }),
    job({ id: 'done', status: 'done' }),
  ], { now: NOW });
  assert.deepEqual(out.map((j) => j.id), ['due']);
});

test('priority is taken before age', () => {
  const out = nextJobs([
    job({ id: 'old-low', priority: 9, run_at: iso(NOW - 100_000) }),
    job({ id: 'new-high', priority: 1, run_at: iso(NOW - 10) }),
  ], { now: NOW });
  assert.deepEqual(out.map((j) => j.id), ['new-high', 'old-low']);
});

/* A queue that always takes the oldest row spends every cycle on the job that
 * has been failing longest, which is the one least likely to succeed. */
test('among equal priorities the one due longest goes first', () => {
  const out = nextJobs([
    job({ id: 'recent', run_at: iso(NOW - 10) }),
    job({ id: 'older', run_at: iso(NOW - 10_000) }),
  ], { now: NOW });
  assert.deepEqual(out.map((j) => j.id), ['older', 'recent']);
});

test('the batch size is respected', () => {
  const rows = Array.from({ length: 10 }, (_, i) => job({ id: `j${i}` }));
  assert.equal(nextJobs(rows, { now: NOW, limit: 3 }).length, 3);
});

test('an empty queue offers nothing', () => {
  assert.deepEqual(nextJobs([], { now: NOW }), []);
});
