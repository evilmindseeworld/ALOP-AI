'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isComparable, needsEmbedding, backlog, afterAttempt } = require('./embedding-lifecycle');

const CURRENT = { model: 'google/text-embedding-004', dim: 768 };
const good = (extra = {}) => ({
  id: 'r1',
  fact: 'a fact',
  embedding: [0.1, 0.2],
  embedding_model: CURRENT.model,
  embedding_dim: 768,
  embedding_status: 'ok',
  embedding_attempts: 0,
  ...extra,
});

/* ---- comparability: the invariant AGENTS.md names ------------------------ */

test('a row from the current model at the current width is comparable', () => {
  assert.equal(isComparable(good(), CURRENT), true);
});

/* The distance operator ranks across two geometries without erroring. The
 * failure is bad memory, not a stack trace, so the refusal has to happen here. */
test('a row from another model is never comparable', () => {
  assert.equal(isComparable(good({ embedding_model: 'openai/text-embedding-3-small' }), CURRENT), false);
});

test('a row of another width is never comparable', () => {
  assert.equal(isComparable(good({ embedding_dim: 1536 }), CURRENT), false);
});

/* Migration 021 labels pre-existing rows rather than guessing their model.
 * Guessing here would undo that, and a wrong label is trusted. */
test('a row with no recorded model is not comparable, however plausible it looks', () => {
  assert.equal(isComparable(good({ embedding_model: null, embedding_status: 'stale' }), CURRENT), false);
});

test('a row with no vector, or one not marked ok, is not comparable', () => {
  assert.equal(isComparable(good({ embedding: null }), CURRENT), false);
  assert.equal(isComparable(good({ embedding_status: 'failed' }), CURRENT), false);
  assert.equal(isComparable(null, CURRENT), false);
});

/* ---- what needs work ----------------------------------------------------- */

test('a healthy row needs nothing', () => {
  assert.equal(needsEmbedding(good(), CURRENT), null);
});

test('a row with no vector needs one, and it is the top priority', () => {
  const work = needsEmbedding(good({ embedding: null, embedding_status: 'pending' }), CURRENT);
  assert.equal(work.reason, 'missing');
  assert.equal(work.priority, 1);
});

test('a model or dimension change is detected as work', () => {
  assert.equal(needsEmbedding(good({ embedding_model: 'old/model' }), CURRENT).reason, 'model_changed');
  assert.equal(needsEmbedding(good({ embedding_dim: 1536 }), CURRENT).reason, 'dimension_changed');
});

test('an unlabelled row from before the lifecycle columns is work', () => {
  assert.equal(needsEmbedding(good({ embedding_status: 'stale' }), CURRENT).reason, 'unlabelled');
});

/* Retrying one bad row forever spends the whole budget on it while the rest of
 * the backlog waits behind it. */
test('a row that has failed enough times stops being retried', () => {
  assert.equal(needsEmbedding(good({ embedding_status: 'failed', embedding_attempts: 3 }), CURRENT), null);
  assert.notEqual(needsEmbedding(good({ embedding_status: 'failed', embedding_attempts: 2 }), CURRENT), null);
});

/* ---- the backlog --------------------------------------------------------- */

test('missing vectors are worked before mismatched ones', () => {
  const out = backlog([
    good({ id: 'mismatch', embedding_model: 'old/model' }),
    good({ id: 'failed', embedding_status: 'failed', embedding_attempts: 1 }),
    good({ id: 'missing', embedding: null, embedding_status: 'pending' }),
    good({ id: 'healthy' }),
  ], CURRENT);

  assert.deepEqual(out.map((r) => r.id), ['missing', 'mismatch', 'failed']);
});

test('among equals, the least-attempted row goes first', () => {
  const out = backlog([
    good({ id: 'tried', embedding: null, embedding_status: 'pending', embedding_attempts: 2 }),
    good({ id: 'fresh', embedding: null, embedding_status: 'pending', embedding_attempts: 0 }),
  ], CURRENT);
  assert.deepEqual(out.map((r) => r.id), ['fresh', 'tried']);
});

test('a healthy table has an empty backlog', () => {
  assert.deepEqual(backlog([good(), good({ id: 'r2' })], CURRENT), []);
});

/* ---- the write-back ------------------------------------------------------ */

test('a successful attempt records the model, the width and the time', () => {
  const patch = afterAttempt({ vector: [0.1, 0.2, 0.3], model: CURRENT.model, dim: 3, attempts: 0, now: 0 });
  assert.equal(patch.embedding_status, 'ok');
  assert.equal(patch.embedding_model, CURRENT.model);
  assert.equal(patch.embedding_dim, 3);
  assert.equal(patch.embedding_attempts, 1);
  assert.equal(typeof patch.embedded_at, 'string');
});

/* Status ok beside a null vector is a fact lost with no trace: invisible to the
 * backlog AND to recall. */
test('a failed attempt never records a model or a time', () => {
  const patch = afterAttempt({ vector: null, model: CURRENT.model, dim: 768, attempts: 1 });
  assert.equal(patch.embedding_status, 'failed');
  assert.equal(patch.embedding, null);
  assert.equal(patch.embedding_model, null);
  assert.equal(patch.embedded_at, null);
  assert.equal(patch.embedding_attempts, 2);
});

/* Storing a wrong-width vector puts two geometries in one column — the thing
 * 013's plain ALTER refuses to do silently. */
test('a vector of the wrong width is a failure, not a row', () => {
  const patch = afterAttempt({ vector: [0.1, 0.2], model: CURRENT.model, dim: 768, attempts: 0 });
  assert.equal(patch.embedding, null);
  assert.equal(patch.embedding_status, 'failed');
});

test('an empty vector is a failure rather than an empty success', () => {
  assert.equal(afterAttempt({ vector: [], model: CURRENT.model, dim: 768 }).embedding_status, 'failed');
});
