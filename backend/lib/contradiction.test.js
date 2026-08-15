'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { conflictBetween, resolveConflicts, verifyAnswer } = require('./contradiction');

const ev = (claim, extra = {}) => ({
  id: `ev_${Math.abs(claim.length * 7)}${extra.sourceUrl || ''}`.slice(0, 24),
  claim,
  sourceUrl: 'https://one.example/page',
  sourceId: 'one.example',
  sourceDate: null,
  fetchedAt: 0,
  freshness: 'unknown',
  confidence: 0.5,
  via: 'test',
  ...extra,
});

/* ---- what a conflict is -------------------------------------------------- */

test('two figures for the same thing are a numeric conflict', () => {
  assert.equal(
    conflictBetween('The Pro plan costs 40 dollars per month.', 'The Pro plan costs 55 dollars per month.'),
    'numeric',
  );
});

test('opposite claims about the same thing are a polarity conflict', () => {
  assert.equal(
    conflictBetween(
      'The adapter is compatible with the older dock and works at full speed.',
      'The adapter is not compatible with the older dock and will not work.',
    ),
    'polarity',
  );
});

/* A turn that read a pricing page and a biography has two sources, not two
 * sides. Reporting that as a contradiction makes the signal worthless. */
test('unrelated sources are not a conflict', () => {
  assert.equal(
    conflictBetween('The Pro plan costs 40 dollars per month.', 'The composer was born in 1841 in Bohemia.'),
    null,
  );
});

test('two sources agreeing are not a conflict', () => {
  assert.equal(
    conflictBetween('The Pro plan costs 40 dollars per month.', 'Pro is priced at 40 dollars monthly.'),
    null,
  );
});

test('a source with figures against one with none is not a numeric conflict', () => {
  assert.equal(
    conflictBetween('The Pro plan costs 40 dollars per month.', 'The Pro plan is billed monthly to the card on file.'),
    null,
  );
});

/* ---- resolution ---------------------------------------------------------- */

test('a fresh source beats a stale one across a real gap', () => {
  const fresh = ev('The Pro plan costs 55 dollars per month.', { freshness: 'fresh', sourceUrl: 'https://a.example/p' });
  const stale = ev('The Pro plan costs 40 dollars per month.', { freshness: 'stale', sourceUrl: 'https://b.example/p' });
  const { conflicts, unresolved } = resolveConflicts([stale, fresh]);
  assert.equal(conflicts.length, 1);
  assert.equal(unresolved.length, 0);
  assert.equal(conflicts[0].winner.claim, fresh.claim);
  assert.equal(conflicts[0].reason, 'freshness');
});

/* fresh-over-dated is a nudge, not a verdict: otherwise the answer follows
 * whichever site touches its footer most often. */
test('fresh does not beat dated — the gap has to be real', () => {
  const a = ev('The Pro plan costs 55 dollars per month.', { freshness: 'fresh', sourceUrl: 'https://a.example/p' });
  const b = ev('The Pro plan costs 40 dollars per month.', { freshness: 'dated', sourceUrl: 'https://b.example/p' });
  assert.equal(resolveConflicts([a, b]).unresolved.length, 1);
});

test('a clear confidence margin decides between independent hosts', () => {
  const strong = ev('The Pro plan costs 55 dollars per month.', { confidence: 0.9, sourceUrl: 'https://a.example/p' });
  const weak = ev('The Pro plan costs 40 dollars per month.', { confidence: 0.4, sourceUrl: 'https://b.example/p' });
  const { conflicts } = resolveConflicts([weak, strong]);
  assert.equal(conflicts[0].winner.claim, strong.claim);
  assert.equal(conflicts[0].reason, 'confidence');
});

test('a narrow confidence margin decides nothing', () => {
  const a = ev('The Pro plan costs 55 dollars per month.', { confidence: 0.55, sourceUrl: 'https://a.example/p' });
  const b = ev('The Pro plan costs 40 dollars per month.', { confidence: 0.5, sourceUrl: 'https://b.example/p' });
  assert.equal(resolveConflicts([a, b]).unresolved.length, 1);
});

/* The same syndicated story on one domain is one voice. */
test('confidence does not decide between two records from the same host', () => {
  const a = ev('The Pro plan costs 55 dollars per month.', { confidence: 0.9, sourceUrl: 'https://same.example/a' });
  const b = ev('The Pro plan costs 40 dollars per month.', { confidence: 0.4, sourceUrl: 'https://same.example/b' });
  assert.equal(resolveConflicts([a, b]).unresolved.length, 1);
});

test('unresolved is a real outcome, not a failure to run', () => {
  const a = ev('The Pro plan costs 55 dollars per month.', { sourceUrl: 'https://a.example/p' });
  const b = ev('The Pro plan costs 40 dollars per month.', { sourceUrl: 'https://b.example/p' });
  const { conflicts, unresolved } = resolveConflicts([a, b]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].winner, null);
  assert.equal(unresolved.length, 1);
});

test('an empty or single-source ledger produces no conflicts', () => {
  assert.deepEqual(resolveConflicts([]).conflicts, []);
  assert.deepEqual(resolveConflicts([ev('One source only, saying 40 dollars.')]).conflicts, []);
  assert.deepEqual(resolveConflicts([null, undefined, { claim: '  ' }]).conflicts, []);
});

/* ---- the final verifier -------------------------------------------------- */

const auditOf = (coverage, unsupported = [], claims = 2) => ({
  claims: Array.from({ length: claims }, (_, i) => ({ text: `claim ${i}` })),
  unsupported: unsupported.map((text) => ({ text })),
  coverage,
});

test('a well-supported searched answer passes and stays cacheable', () => {
  const out = verifyAnswer({ answer: 'The Pro plan costs 40 dollars.', audit: auditOf(1), searched: true });
  assert.equal(out.ok, true);
  assert.equal(out.cacheable, true);
});

test('a searched answer whose claims are not in any source it read is flagged', () => {
  const out = verifyAnswer({
    answer: 'The Pro plan costs 400 dollars and the Helsinki office opened in 2021.',
    audit: auditOf(0, ['The Pro plan costs 400 dollars.'], 2),
    searched: true,
  });
  assert.equal(out.ok, false);
  assert.equal(out.problems[0].kind, 'unsupported_claims');
  assert.equal(out.cacheable, false, 'an unverified answer is shown but never stored for someone else');
});

/* An answer written from the model's own knowledge has no sources to be
 * unsupported by. Holding it to a coverage bar fails every ordinary question. */
test('an unsearched answer is not judged on source coverage', () => {
  const out = verifyAnswer({
    answer: 'Water boils at 100 degrees Celsius at sea level.',
    audit: auditOf(0, ['Water boils at 100 degrees Celsius at sea level.'], 1),
    searched: false,
  });
  assert.equal(out.ok, true);
});

test('an answer with nothing checkable in it is not flagged', () => {
  const out = verifyAnswer({ answer: 'It depends on what you need.', audit: auditOf(1, [], 0), searched: true });
  assert.equal(out.ok, true);
});

test('taking one side of an unresolved conflict is flagged', () => {
  const a = ev('The Pro plan costs 55 dollars per month.', { sourceUrl: 'https://a.example/p' });
  const b = ev('The Pro plan costs 40 dollars per month.', { sourceUrl: 'https://b.example/p' });
  const { conflicts } = resolveConflicts([a, b]);

  const out = verifyAnswer({
    answer: 'The Pro plan costs 40 dollars per month.',
    audit: auditOf(1),
    conflicts,
    searched: true,
  });
  assert.equal(out.ok, false);
  assert.equal(out.problems[0].kind, 'picked_a_side');
  assert.deepEqual(out.problems[0].sources.sort(), ['https://a.example/p', 'https://b.example/p']);
});

/* Reporting the disagreement is the CORRECT behaviour and must not be flagged
 * — otherwise the check punishes the answer it is trying to produce. */
test('reporting both sides of an unresolved conflict passes', () => {
  const a = ev('The Pro plan costs 55 dollars per month.', { sourceUrl: 'https://a.example/p' });
  const b = ev('The Pro plan costs 40 dollars per month.', { sourceUrl: 'https://b.example/p' });
  const { conflicts } = resolveConflicts([a, b]);

  const out = verifyAnswer({
    answer: 'Sources disagree: one lists 40 dollars per month and another lists 55.',
    audit: auditOf(1),
    conflicts,
    searched: true,
  });
  assert.equal(out.ok, true);
});

test('a conflict the rules RESOLVED does not constrain the answer', () => {
  const fresh = ev('The Pro plan costs 55 dollars per month.', { freshness: 'fresh', sourceUrl: 'https://a.example/p' });
  const stale = ev('The Pro plan costs 40 dollars per month.', { freshness: 'stale', sourceUrl: 'https://b.example/p' });
  const { conflicts } = resolveConflicts([fresh, stale]);

  const out = verifyAnswer({
    answer: 'The Pro plan costs 55 dollars per month.',
    audit: auditOf(1),
    conflicts,
    searched: true,
  });
  assert.equal(out.ok, true, 'the winner may be stated flatly — that is what resolving it meant');
});

test('the verifier never claims the answer is correct, only that it is grounded', () => {
  const out = verifyAnswer({ answer: 'anything', audit: auditOf(1), searched: true });
  assert.deepEqual(Object.keys(out).sort(), ['cacheable', 'ok', 'problems']);
});

test('it produces a verdict from no arguments at all', () => {
  const out = verifyAnswer();
  assert.equal(out.ok, true);
  assert.equal(out.cacheable, true);
});
