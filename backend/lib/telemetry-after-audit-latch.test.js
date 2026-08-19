'use strict';

/**
 * B1: THE AUDIT LATCH STOPS A SECOND AUDIT ROW. IT DOES NOT STOP MEASURING.
 *
 * `turnAudited` (server.js, next to the telemetry construction) exists so that
 * eleven exits from one route cannot write eleven `audit_logs` rows for one
 * turn. It is a write latch. The worry it invites is the opposite thing: that
 * a turn which audited early — a search branch, a cache hit — also stopped
 * COLLECTING, so everything after the latch is lost and `turns.meta` would
 * inherit a truncated record.
 *
 * It does not. `createTurnTelemetry` has no reference to the latch, and the
 * latch guards only `auditLog`. This file pins that, because the coupling
 * would be a one-line change by someone reasonably thinking they were
 * de-duplicating work, and nothing else would fail.
 *
 * Two halves, because the invariant lives in two files:
 *   1. the recorder keeps recording after a latched write (this is exercised
 *      against the real module, with the real latch semantics replicated);
 *   2. `server.js` never puts `turnAudited` in front of a `telemetry.record*`
 *      call (asserted on the source, the way seat-audit-wiring already does —
 *      server.js calls `process.exit(1)` at import on missing env).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { createTurnTelemetry } = require('./turn-telemetry');

/**
 * The route's latch, reproduced exactly: one boolean, set by the first writer,
 * guarding only the audit write. Nothing else in the route reads it.
 */
function makeLatchedAuditor(telemetry) {
  const rows = [];
  let turnAudited = false;
  return {
    rows,
    audited: () => turnAudited,
    /** server.js `auditBranch` — hand-built metadata, no snapshot. */
    async auditBranch(metadata) {
      if (turnAudited) return;
      turnAudited = true;
      rows.push({ kind: 'branch', metadata });
    },
    /** server.js `auditTelemetry` — snapshots, then writes. */
    async auditTelemetry(action, category) {
      if (turnAudited) return;
      turnAudited = true;
      rows.push({ kind: 'telemetry', action, snapshot: telemetry.snapshot({ category }) });
    },
  };
}

test('telemetry keeps collecting after the audit latch has closed', async () => {
  let clock = 1_000;
  const telemetry = createTurnTelemetry({ now: () => clock, startedAt: clock });
  const auditor = makeLatchedAuditor(telemetry);

  // Before the latch: one router read, so the snapshot is demonstrably alive.
  telemetry.recordProviderAttempt({ phase: 'router', model: 'router/model', outcome: 'ok', status: 200, ms: 40 });

  // A branch wins the latch — this is the search/cache/no_results shape.
  await auditor.auditBranch({ category: 'search' });
  assert.equal(auditor.audited(), true, 'the latch must be closed for this test to mean anything');
  assert.equal(auditor.rows.length, 1);

  // A second writer is refused. That is the latch doing its only job.
  await auditor.auditTelemetry('council', 'council');
  assert.equal(auditor.rows.length, 1, 'the latch must still prevent a duplicate audit row');

  // EVERYTHING BELOW HAPPENS AFTER THE LATCH CLOSED.
  clock += 100;
  telemetry.recordProviderAttempt({ phase: 'council', model: 'seat/one', outcome: 'http_error', status: 429, ms: 90, attempt: 1 });
  telemetry.recordProviderAttempt({ phase: 'council', model: 'seat/one', outcome: 'ok', status: 200, ms: 110, attempt: 2 });
  telemetry.recordSeat({ phase: 'council', model: 'seat/one', round: 1, durationMs: 200, outcome: 'answered' });
  telemetry.recordSeat({ phase: 'council', model: 'seat/two', round: 1, durationMs: 210, outcome: 'quorum' });
  clock += 300;
  telemetry.recordProviderAttempt({ phase: 'synthesis', model: 'head/model', outcome: 'ok', status: 200, ms: 300, streamed: true });
  telemetry.recordStreamTiming({
    phase: 'synthesis', model: 'head/model', status: 200, outcome: 'ok',
    streamOpenMs: 120, msToFirstToken: 480, streamBodyMs: 900, completed: true,
  });
  telemetry.recordSynthesis(1_020, 'head/model');
  telemetry.recordUsage({ promptTokens: 1_200, completionTokens: 340, totalTokens: 1_540 }, { phase: 'synthesis' });

  const final = telemetry.snapshot({ category: 'council' });

  // The provider attempt recorded after the latch is in the final snapshot.
  assert.equal(final.providerAttempts.total, 4, 'every attempt, before and after the latch');
  assert.equal(final.providerAttempts.byStatus['429'], 1, 'a 429 raised after the latch survives');
  assert.equal(final.providerAttempts.retries, 1, 'a retry raised after the latch survives');

  // The seats recorded after the latch are in the final snapshot.
  assert.equal(final.seats.length, 2, 'both seats recorded after the latch');
  assert.deepEqual(final.seats.map((s) => s.outcome).sort(), ['answered', 'quorum']);

  // The synthesis lifecycle recorded after the latch is in the final snapshot.
  assert.equal(final.synthesisMs, 1_020);
  assert.equal(final.synthesisModel, 'head/model');
  assert.equal(final.streamTimings.length, 1);
  assert.equal(final.streamTimings[0].msToFirstToken, 480);
  assert.equal(final.streamTimings[0].streamTotalMs, 1_020);
  assert.equal(final.usage.byPhase.synthesis.completionTokens, 340);

  // And the audit row that WON the latch is the poorer record, which is the
  // whole reason `turns.meta` is being given the job.
  const audited = auditor.rows[0];
  assert.equal(audited.kind, 'branch');
  assert.equal(audited.metadata.telemetry, undefined, 'the latched row carries none of the above');
});

test('the recorder has no notion of an audit latch at all', () => {
  const source = readFileSync(join(__dirname, 'turn-telemetry.js'), 'utf8');
  assert.ok(
    !/turnAudited|audited|auditLog/.test(source),
    'turn-telemetry.js must not learn about the audit latch; collection and the audit write are separate concerns',
  );
});

test('server.js never guards a telemetry record on the audit latch', () => {
  const source = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
  const offenders = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!/turnAudited/.test(line)) return;
    // A window, because `if (turnAudited) return;` and the call it would guard
    // are on different lines. Anything recording within three lines of a read
    // of the latch is the coupling this test exists to refuse.
    const window = lines.slice(i, i + 4).join('\n');
    if (/telemetry\.record[A-Za-z]*\(|telemetry\.mark[A-Za-z]*\(/.test(window)) {
      offenders.push(`${i + 1}: ${line.trim()}`);
    }
  });
  assert.deepEqual(
    offenders, [],
    'a telemetry record must never sit behind `turnAudited`: the latch de-duplicates audit_logs writes, '
    + 'and coupling collection to it would truncate every turn that audited early',
  );
});
