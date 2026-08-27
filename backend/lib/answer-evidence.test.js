'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEvidenceLedger } = require('./evidence-ledger');
const { verifyAnswerForDisplay } = require('./answer-evidence');

test('a searched answer cannot display a citation outside the turn evidence', () => {
  const evidence = createEvidenceLedger();
  evidence.record({ text: 'Node 24 is the current LTS release.', url: 'https://nodejs.org/releases' });

  const verdict = verifyAnswerForDisplay({
    answer: 'Node 24 is current. https://untrusted.example/node',
    evidence,
    searched: true,
  });

  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => problem.kind === 'unsupported_citation'));
});
test('an unresolved searched numeric conflict cannot be shown as a confident side', () => {
  const evidence = createEvidenceLedger();
  evidence.record({ text: 'The current service limit is 20 requests per minute.', url: 'https://a.example/limits', confidence: 0.6 });
  evidence.record({ text: 'The current service limit is 30 requests per minute.', url: 'https://b.example/limits', confidence: 0.6 });

  const verdict = verifyAnswerForDisplay({
    answer: 'The current service limit is 20 requests per minute.',
    evidence,
    searched: true,
  });

  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => problem.kind === 'picked_a_side'));
});

const PRICE_URL = 'https://store.example/rtx-5090';

function priceEvidence() {
  const evidence = createEvidenceLedger();
  evidence.record({
    text: 'The RTX 5090 is listed at $1,999 on the official store page.',
    url: PRICE_URL,
  });
  return evidence;
}

test('faithful searched price answer with 0.25 support is displayable but not cacheable', () => {
  const evidence = priceEvidence();
  const verdict = verifyAnswerForDisplay({
    answer: [
      'The RTX 5090 is listed at $1,999 on the official store page.',
      'The product ships within 2 business days.',
      'The package weighs 4 kilograms.',
      'The listing was updated in 2026.',
      PRICE_URL,
    ].join(' '),
    evidence,
    searched: true,
  });

  assert.equal(verdict.audit.coverage, 0.25);
  assert.equal(verdict.ok, true, 'weak lexical support must not erase a cited answer');
  assert.equal(verdict.cacheable, false, 'weak lexical support remains a cache concern');
  assert.equal(verdict.evidenceSupport, 'weak');
  assert.equal(verdict.qualification, 'degraded');
  assert.deepEqual(verdict.hardProblems, []);
  assert.ok(verdict.softProblems.some((problem) => problem.kind === 'unsupported_claims'));
});

test('faithful searched answer with 0.33 support is displayable but remains degraded', () => {
  const evidence = priceEvidence();
  const verdict = verifyAnswerForDisplay({
    answer: [
      'The RTX 5090 is listed at $1,999 on the official store page.',
      'The product ships within 2 business days.',
      'The listing was updated in 2026.',
      PRICE_URL,
    ].join(' '),
    evidence,
    searched: true,
  });

  assert.equal(verdict.audit.coverage, 1 / 3);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.cacheable, false);
  assert.equal(verdict.evidenceSupport, 'weak');
  assert.equal(verdict.qualification, 'degraded');
});

test('unknown searched evidence is not treated as a false answer', () => {
  const verdict = verifyAnswerForDisplay({
    answer: 'Node.js 24 is the current release.',
    evidence: createEvidenceLedger(),
    searched: true,
  });

  assert.equal(verdict.ok, true);
  assert.equal(verdict.cacheable, false);
  assert.equal(verdict.evidenceSupport, 'unknown');
  assert.equal(verdict.qualification, 'unknown');
  assert.ok(verdict.softProblems.some((problem) => problem.kind === 'unsupported_claims'));
});

test('a normal well-supported searched answer is displayable and cacheable', () => {
  const evidence = priceEvidence();
  const verdict = verifyAnswerForDisplay({
    answer: `The RTX 5090 is listed at $1,999 on the official store page. ${PRICE_URL}`,
    evidence,
    searched: true,
  });

  assert.equal(verdict.ok, true);
  assert.equal(verdict.cacheable, true);
  assert.equal(verdict.evidenceSupport, 'strong');
  assert.equal(verdict.qualification, 'verified');
  assert.deepEqual(verdict.problems, []);
});

test('a citation to an unrelated trusted source remains a hard display failure', () => {
  const evidence = priceEvidence();
  const verdict = verifyAnswerForDisplay({
    answer: 'The RTX 5090 is listed at $1,999. https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/',
    evidence,
    searched: true,
  });

  assert.equal(verdict.ok, false);
  assert.ok(verdict.hardProblems.some((problem) => problem.kind === 'unsupported_citation'));
  assert.equal(verdict.cacheable, false);
});
