'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  ANSWER_HEAD_CHARS,
  ANSWER_TAIL_CHARS,
  answerReplayDiagnostics,
} = require('./evaluation-diagnostics');

test('replay diagnostics preserve a bounded head and tail plus a digest of the full answer', () => {
  const answer = `${'H'.repeat(700)}${'T'.repeat(1100)}`;
  const diagnostics = answerReplayDiagnostics({ answer, frames: [] });

  assert.equal(diagnostics.answerLength, answer.length);
  assert.equal(diagnostics.answerHash, createHash('sha256').update(answer, 'utf8').digest('hex'));
  assert.equal(diagnostics.head.length, ANSWER_HEAD_CHARS);
  assert.equal(diagnostics.tail.length, ANSWER_TAIL_CHARS);
  assert.equal(diagnostics.head, answer.slice(0, ANSWER_HEAD_CHARS));
  assert.equal(diagnostics.tail, answer.slice(-ANSWER_TAIL_CHARS));
  assert.equal(Object.prototype.hasOwnProperty.call(diagnostics, 'answer'), false);
});

test('replay diagnostics retain known finish/stop and public execution state only', () => {
  const diagnostics = answerReplayDiagnostics({
    answer: 'A complete answer.',
    frames: [
      { type: 'chunk', text: 'A complete answer.' },
      { type: 'finish', finish_reason: 'length', stopReason: 'max_tokens', privatePrompt: 'do not persist' },
    ],
    provenance: {
      route: 'fallback',
      requestState: 'complete',
      council: { used: true, seatCount: 7, answered: 6, completed: false, partial: true, privateDraft: 'secret' },
      synthesis: { started: true, completed: false, skipped: false, failed: true, fallback: true, privateDraft: 'secret' },
      completion: { assembled: false, qualified: 'incomplete', privateDraft: 'secret' },
      privateSecret: 'do not persist',
    },
  });

  assert.equal(diagnostics.completion.finishReason, 'length');
  assert.equal(diagnostics.completion.stopReason, 'max_tokens');
  assert.equal(diagnostics.completion.status, 'incomplete');
  assert.deepEqual(diagnostics.execution, {
    route: 'fallback',
    requestState: 'complete',
    council: { used: true, seatCount: 7, answered: 6, completed: false, partial: true },
    synthesis: { started: true, completed: false, skipped: false, failed: true, fallback: true },
    completion: { assembled: false, qualified: 'incomplete' },
  });
  assert.doesNotMatch(JSON.stringify(diagnostics), /privatePrompt|privateDraft|privateSecret|secret/);
});

test('diagnostic metadata remains small when the answer is empty or an error ended the turn', () => {
  const diagnostics = answerReplayDiagnostics({
    answer: '',
    frames: [],
    error: { code: 'internal_error', text: 'provider detail omitted from this assertion' },
  });
  assert.equal(diagnostics.answerLength, 0);
  assert.equal(diagnostics.head, '');
  assert.equal(diagnostics.tail, '');
  assert.equal(diagnostics.completion.status, 'incomplete');
  assert.equal(diagnostics.execution.route, null);
});

test('the runner can persist the diagnostic block under an isolated namespace', () => {
  const observation = { answer: 'A complete answer.', frames: [] };
  const persisted = { ...observation, diagnostics: answerReplayDiagnostics(observation) };

  assert.equal(persisted.diagnostics.answerLength, observation.answer.length);
  assert.equal(typeof persisted.diagnostics.answerHash, 'string');
  assert.equal(persisted.answerLength, undefined);
  assert.equal(persisted.completion, undefined);
  assert.equal(persisted.diagnostics.completion.status, 'unknown');
});
