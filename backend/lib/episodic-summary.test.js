'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pendingSpans, selectSummaries, spanTurns, WINDOW, FANOUT } = require('./episodic-summary');

const row = (level, from, to, extra = {}) => ({ level, from_turn: from, to_turn: to, summary: `L${level} ${from}-${to}`, ...extra });

/* ---- which spans need work ----------------------------------------------- */

test('a short chat needs no summary at all', () => {
  assert.deepEqual(pendingSpans(WINDOW - 1, []), []);
});

test('a full window becomes one level-0 span', () => {
  const out = pendingSpans(WINDOW, []);
  assert.equal(out.length, 1);
  assert.deepEqual({ level: out[0].level, from: out[0].from, to: out[0].to }, { level: 0, from: 0, to: WINDOW });
});

/* A partial window would be re-summarised on every turn — a model call per turn
 * for a summary that keeps changing. The tail is already in the prompt raw. */
test('a partly-filled window is left alone', () => {
  assert.equal(pendingSpans(WINDOW + 2, []).length, 1, 'only the complete window');
});

test('work already done is not done again', () => {
  const existing = [row(0, 0, WINDOW)];
  assert.deepEqual(pendingSpans(WINDOW, existing), []);
});

test('a longer chat produces consecutive, non-overlapping windows', () => {
  const out = pendingSpans(WINDOW * 3, []).filter((s) => s.level === 0);
  assert.deepEqual(out.map((s) => [s.from, s.to]), [[0, WINDOW], [WINDOW, WINDOW * 2], [WINDOW * 2, WINDOW * 3]]);
});

/* ---- roll-up ------------------------------------------------------------- */

test('enough level-0 summaries roll up into a level-1', () => {
  const existing = Array.from({ length: FANOUT }, (_, i) => row(0, i * WINDOW, (i + 1) * WINDOW));
  const out = pendingSpans(WINDOW * FANOUT, existing);
  const level1 = out.filter((s) => s.level === 1);
  assert.equal(level1.length, 1);
  assert.equal(level1[0].from, 0);
  assert.equal(level1[0].to, WINDOW * FANOUT);
  assert.equal(level1[0].sources.length, FANOUT, 'the roll-up names what it summarises');
});

test('too few level-0 summaries do not roll up', () => {
  const existing = Array.from({ length: FANOUT - 1 }, (_, i) => row(0, i * WINDOW, (i + 1) * WINDOW));
  assert.equal(pendingSpans(WINDOW * (FANOUT - 1), existing).some((s) => s.level === 1), false);
});

test('a roll-up that already exists is not proposed again', () => {
  const existing = [
    ...Array.from({ length: FANOUT }, (_, i) => row(0, i * WINDOW, (i + 1) * WINDOW)),
    row(1, 0, WINDOW * FANOUT),
  ];
  assert.equal(pendingSpans(WINDOW * FANOUT, existing).some((s) => s.level === 1), false);
});

/* A chat is not a corpus; the hierarchy has to stop. */
test('the hierarchy stops at the maximum level', () => {
  const many = Array.from({ length: 400 }, (_, i) => row(0, i * WINDOW, (i + 1) * WINDOW));
  const out = pendingSpans(WINDOW * 400, many);
  assert.ok(out.every((s) => s.level <= 3), 'levels above the cap must not be proposed');
});

/* ---- retrieval ----------------------------------------------------------- */

/* The prompt already carries the last few turns verbatim; a summary of them
 * spends budget to say less than the caller already has. */
test('summaries of the raw tail are not returned', () => {
  const summaries = [row(0, 0, 6), row(0, 6, 12)];
  const out = selectSummaries({ summaries, turnCount: 12, rawTail: 6 });
  assert.deepEqual(out.map((s) => s.from_turn), [0]);
});

test('a chat shorter than the raw tail needs no summaries', () => {
  assert.deepEqual(selectSummaries({ summaries: [row(0, 0, 6)], turnCount: 4, rawTail: 6 }), []);
});

/* Returning a level-1 summary AND the level-0s inside it is the same content
 * twice, which is the cost the hierarchy exists to avoid. */
test('a summary contained by a higher-level one is dropped', () => {
  const summaries = [row(1, 0, 24), row(0, 0, 6), row(0, 6, 12), row(0, 12, 18)];
  const out = selectSummaries({ summaries, turnCount: 40, rawTail: 6, budget: 4 });
  assert.deepEqual(out.map((s) => s.level), [1]);
});

test('level-0 summaries outside the higher-level span are kept', () => {
  const summaries = [row(1, 0, 24), row(0, 24, 30)];
  const out = selectSummaries({ summaries, turnCount: 40, rawTail: 6, budget: 4 });
  assert.deepEqual(out.map((s) => s.from_turn), [0, 24]);
});

test('the budget is respected', () => {
  const summaries = [row(0, 0, 6), row(0, 6, 12), row(0, 12, 18), row(0, 18, 24)];
  assert.equal(selectSummaries({ summaries, turnCount: 40, rawTail: 6, budget: 2 }).length, 2);
});

test('a relevance score decides which of the equals are kept', () => {
  const summaries = [row(0, 0, 6, { id: 'a' }), row(0, 6, 12, { id: 'b' }), row(0, 12, 18, { id: 'c' })];
  const out = selectSummaries({
    summaries,
    turnCount: 40,
    rawTail: 6,
    budget: 1,
    score: (s) => (s.id === 'b' ? 10 : 0),
  });
  assert.deepEqual(out.map((s) => s.id), ['b']);
});

/* A model handed the middle of a conversation before its beginning
 * reconstructs the order itself, badly. */
test('what is returned is in conversation order', () => {
  const summaries = [row(0, 12, 18), row(0, 0, 6), row(0, 6, 12)];
  const out = selectSummaries({ summaries, turnCount: 40, rawTail: 6, budget: 3 });
  assert.deepEqual(out.map((s) => s.from_turn), [0, 6, 12]);
});

test('nothing in, nothing out', () => {
  assert.deepEqual(selectSummaries(), []);
  assert.deepEqual(selectSummaries({ summaries: [], turnCount: 100 }), []);
});

/* ---- span slicing -------------------------------------------------------- */

test('a span slices the turns it names, half-open like the CHECK constraint', () => {
  const turns = Array.from({ length: 10 }, (_, i) => `turn ${i}`);
  assert.deepEqual(spanTurns({ from: 2, to: 5 }, turns), ['turn 2', 'turn 3', 'turn 4']);
});
