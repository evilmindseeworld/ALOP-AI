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
