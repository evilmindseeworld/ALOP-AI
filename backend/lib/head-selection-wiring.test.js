'use strict';

/**
 * The selector is proved by `head-selection.test.js`. This file proves it is
 * FED and CONSULTED — the two halves that regress silently.
 *
 * A ranking with no samples for the model it ranks is a hand-ordered list with
 * extra steps, and that was the state before this: `meteredCallModel` recorded
 * every council seat into provider health, while `streamModel` — the head, the
 * longest step of a turn — recorded nothing at all.
 *
 * server.js calls `process.exit(1)` at import time on a missing env var, so it
 * is read as text; see AGENTS.md.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SERVER = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
const STREAM_MODEL = SERVER.slice(SERVER.indexOf('const streamModel ='), SERVER.indexOf('const callGeminiVision'));

test('THE HEAD RECORDS ITS OWN CALLS INTO THE HEALTH SIGNAL', () => {
  assert.match(STREAM_MODEL, /providerHealth\.record\(/, 'the streamed answer is invisible to the ranking again');
  assert.match(STREAM_MODEL, /const recordStream = /);
  /* Both the first attempt and every recovery rung, or the ranking learns only
   * about models that never fail. */
  assert.ok(
    (STREAM_MODEL.match(/recordStream\(/g) || []).length >= 4,
    'a rung of the ladder is running unrecorded',
  );
});

test('an abort is not recorded as a failure', () => {
  // A user closing a tab says nothing about the model. Counting it would sink a
  // healthy head on the days people change their minds most.
  assert.match(STREAM_MODEL, /if \(signal\?\.aborted \|\| err\?\.name === 'AbortError'\) return;/);
});

test('a 429 is recorded as rate limiting, not as a failure', () => {
  // The distinction is provider-health's own: a rate limit is a signal about US
  // and a failure is a signal about them, and conflating them opens a breaker
  // on a model that is working perfectly.
  assert.match(STREAM_MODEL, /rate_limited/);
});

test('the recorder can never break the call it is recording', () => {
  assert.match(STREAM_MODEL, /catch \{ \/\* a recorder must never break the call it is recording \*\/ \}/);
});

test('the head selection is consulted with the health signal and the shared emphasis', () => {
  const plan = SERVER.slice(SERVER.indexOf('function planSynthesis('), SERVER.indexOf('function planSynthesis(') + 3000);
  assert.match(plan, /chooseHead\(/);
  assert.match(plan, /health: providerHealth/, 'the selector is being asked without any evidence to rank on');
  assert.match(plan, /chooseEmphasis\(/, 'the head must use the same emphasis definition as the roster planner');
  assert.match(plan, /candidates: HEAD_CANDIDATES/);
});

test('the ranking is offered only models the reservation already covers', () => {
  // chooseHead never widens its candidate list, but the list handed to it has
  // to be the same one the money was reserved against, or a promoted rung is an
  // unadmitted bill. Both are built from SYNTHESIS_MODEL plus HEAD_FALLBACKS.
  // Whitespace-tolerant on purpose: `a921020` reflowed this declaration across
  // four lines without changing what it builds, and a source-text guard that
  // fails on a line break is a guard that gets deleted rather than read.
  assert.match(SERVER, /const HEAD_CANDIDATES = \[\s*SYNTHESIS_MODEL,\s*\.\.\.HEAD_FALLBACKS\.map/);
  assert.match(SERVER, /const SYNTHESIS_MODEL_CANDIDATES = \[/);
  assert.match(SERVER, /\.\.\.HEAD_FALLBACKS\.map\(\(rung\) => rung\.model\)/);
});

test('adaptive head selection has a kill switch and defaults to on', () => {
  // Safe to default on only because the selector is the identity function until
  // it has MIN_CONFIDENT_SAMPLES; the switch exists for the case where that
  // reasoning turns out to be wrong in production.
  assert.match(SERVER, /const ADAPTIVE_HEAD = !\/\^\(0\|false\|off\)\$\/i\.test\(\s*process\.env\.COUNCIL_ADAPTIVE_HEAD \|\| ''\s*\)/);
  assert.match(SERVER, /ADAPTIVE_HEAD\s*\?\s*chooseHead\(/);
});
