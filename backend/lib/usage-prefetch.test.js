'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { candidateToReplayInput, rankPrefetchCandidates, scoreCandidate } = require('./usage-prefetch');

const NOW = Date.parse('2026-08-15T00:00:00.000Z');
const row = (patch = {}) => ({
  key: 'key-1',
  question_text: 'How does caching work?',
  lang: 'English',
  country: 'AE',
  plan: 'free',
  detailed: false,
  branch: 'turn:tools-off',
  used_live_web: false,
  stored_at: new Date(NOW - 60 * 60 * 1000).toISOString(),
  expires_at: new Date(NOW + 6 * 60 * 60 * 1000).toISOString(),
  hit_count: 3,
  quality: 0.9,
  provenance: { request_count: 2 },
  ...patch,
});

test('replay input fails closed when durable identity fields are absent', () => {
  assert.equal(candidateToReplayInput({ ...row(), question_text: null }), null);
  assert.equal(candidateToReplayInput({ ...row(), branch: '' }), null);
  assert.equal(candidateToReplayInput({ ...row(), detailed: 'false' }), null);
  assert.equal(candidateToReplayInput(row()).question, 'How does caching work?');
});

test('score is bounded and exposes demand, freshness, quality, and quota signals', () => {
  const scored = scoreCandidate(row(), { now: NOW, quotaRemaining: 10, quotaCapacity: 50 });
  assert.ok(scored.score >= 0 && scored.score <= 1);
  assert.deepEqual(Object.keys(scored.signals).sort(), [
    'demand', 'freshness', 'missCost', 'quality', 'quotaCost', 'quotaPressure',
  ]);
  assert.equal(scored.signals.quality, 0.9);
  assert.ok(scored.signals.freshness > 0);
});

test('ranking favours popular, costly, and expiring rows', () => {
  const rows = [
    row({ key: 'quiet-stable', hit_count: 0, expires_at: new Date(NOW + 30 * 24 * 60 * 60 * 1000).toISOString(), provenance: { request_count: 1 } }),
    row({ key: 'popular-expiring', hit_count: 50, expires_at: new Date(NOW + 10 * 60 * 1000).toISOString(), provenance: { request_count: 8 } }),
  ];
  const ranked = rankPrefetchCandidates(rows, { now: NOW, limit: 2, quotaRemaining: 10 });
  assert.deepEqual(ranked.map((candidate) => candidate.key), ['popular-expiring', 'quiet-stable']);
});

test('zero remaining quota produces no prefetch work', () => {
  assert.deepEqual(rankPrefetchCandidates([row()], { now: NOW, limit: 5, quotaRemaining: 0 }), []);
});

test('invalid and legacy rows are skipped without guessing a replay identity', () => {
  const ranked = rankPrefetchCandidates([
    row({ key: 'valid' }),
    row({ key: 'legacy', question_text: null }),
    row({ key: 'no-expiry', expires_at: null }),
  ], { now: NOW, limit: 5 });
  assert.deepEqual(ranked.map((candidate) => candidate.key), ['valid']);
});
