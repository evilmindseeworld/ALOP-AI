'use strict';

/*
 * BOUNDED REPLAY DIAGNOSTICS ONLY.
 *
 * The evaluator decides grades. This module records enough of an observation
 * to distinguish a short complete answer from a terminal fragment when a
 * report is re-opened later, without persisting prompts, transcripts, model
 * output beyond a small head/tail window, or arbitrary provider metadata.
 */

const { createHash } = require('node:crypto');
const { inspectCompletionMetadata } = require('./evaluation');

const ANSWER_HEAD_CHARS = 500;
const ANSWER_TAIL_CHARS = 1000;
const MAX_SIGNAL_CHARS = 120;

const clipSignal = (value) => {
  if (typeof value === 'string') return value.slice(0, MAX_SIGNAL_CHARS);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return null;
};

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

function recordsFor(observation) {
  const frames = Array.isArray(observation?.frames) ? observation.frames : [];
  return [observation, observation?.provenance, ...frames].filter(isRecord);
}

function firstKnownSignal(records, keys) {
  for (const record of records) {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
      const value = clipSignal(record[key]);
      if (value !== null) return value;
    }
  }
  return null;
}

function safePublicState(record, keys) {
  if (!isRecord(record)) return null;
  const output = {};
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = clipSignal(record[key]);
    if (value !== null) output[key] = value;
  }
  return Object.keys(output).length ? output : null;
}

function completionDiagnostics(observation) {
  const metadata = inspectCompletionMetadata(observation);
  const records = recordsFor(observation);
  return {
    status: metadata.status,
    available: metadata.available,
    finishReason: firstKnownSignal(records, ['finishReason', 'finish_reason', 'providerFinishReason', 'provider_finish_reason']),
    stopReason: firstKnownSignal(records, ['stopReason', 'stop_reason']),
    completionStatus: firstKnownSignal(records, ['completionStatus', 'completion_status']),
    fields: metadata.fields.slice(0, 32),
  };
}

function answerReplayDiagnostics(observation = {}) {
  const answer = String(observation?.answer ?? '');
  const provenance = isRecord(observation?.provenance) ? observation.provenance : null;
  return {
    answerLength: answer.length,
    answerHash: createHash('sha256').update(answer, 'utf8').digest('hex'),
    head: answer.slice(0, ANSWER_HEAD_CHARS),
    tail: answer.slice(-ANSWER_TAIL_CHARS),
    completion: completionDiagnostics(observation),
    execution: {
      route: typeof provenance?.route === 'string' ? provenance.route.slice(0, MAX_SIGNAL_CHARS) : null,
      requestState: typeof provenance?.requestState === 'string'
        ? provenance.requestState.slice(0, MAX_SIGNAL_CHARS)
        : null,
      council: safePublicState(provenance?.council, ['used', 'seatCount', 'answered', 'completed', 'partial']),
      synthesis: safePublicState(provenance?.synthesis, ['started', 'completed', 'skipped', 'failed', 'fallback']),
      completion: safePublicState(provenance?.completion, ['assembled', 'qualified']),
    },
  };
}

module.exports = {
  ANSWER_HEAD_CHARS,
  ANSWER_TAIL_CHARS,
  answerReplayDiagnostics,
  completionDiagnostics,
};
