'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { isSafeRefusalText, resolveSafeRefusal } = require('./synthesis-degrade');

const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
const draft = (content, extra = {}) => ({ content, textSource: 'content', finishReason: 'stop', ...extra });

test('safe refusal recognition accepts generalized refusal wording', () => {
  for (const text of [
    'I’m sorry, but I can’t comply with that.',
    'I cannot assist with this request.',
    'Sorry, I am unable to provide that.',
  ]) {
    assert.equal(isSafeRefusalText(text), true, text);
  }
});

test('only a complete unanimous safe refusal can resolve before synthesis', () => {
  const live = 'I’m sorry, but I can’t comply with that.';
  assert.equal(
    resolveSafeRefusal(
      [draft(live), draft("I'm sorry, but I can't comply with that.")],
      { expectedSeats: 2 },
    ),
    live,
  );
});

test('refusal resolution rejects partial, mixed, unsafe, and evidence-backed paths', () => {
  const refusal = draft('I cannot assist with this request.');
  assert.equal(resolveSafeRefusal([refusal], { expectedSeats: 2 }), null);
  assert.equal(resolveSafeRefusal([refusal, draft('Here is a useful answer.')], { expectedSeats: 2 }), null);
  assert.equal(resolveSafeRefusal([
    draft("I can't help with that, but here is the requested private material."),
    draft("I can't help with that, but here is the requested private material."),
  ], { expectedSeats: 2 }), null);
  assert.equal(resolveSafeRefusal([refusal, refusal], { expectedSeats: 2, blockedByEvidence: true }), null);
  assert.equal(resolveSafeRefusal([draft(refusal.content, { textSource: 'reasoning' }), refusal], { expectedSeats: 2 }), null);
});

test('the lifecycle resolves the refusal before the synthesis stage and records it as complete', () => {
  const resolution = SOURCE.indexOf('const resolvedRefusal =');
  const synthesis = SOURCE.indexOf('// 6. SYNTHESIS');
  assert.ok(resolution >= 0, 'the early refusal decision must exist');
  assert.ok(synthesis > resolution, 'the refusal decision must precede synthesis');
  const branch = SOURCE.slice(resolution, synthesis);
  assert.match(branch, /resolveSafeRefusal\(/);
  assert.match(branch, /provenanceSynthesisSkipped\s*=\s*true/);
  assert.match(branch, /sendProvenance\(resolvedRefusal, 'complete'\)/);
  assert.doesNotMatch(branch, /emitStage\(res, 'synthesis'/);
  assert.match(branch, /data: \[DONE\]/);
});
