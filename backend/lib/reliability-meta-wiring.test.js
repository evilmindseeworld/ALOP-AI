'use strict';

/**
 * B2: THE TURN FINISHES WITH A COMPLETE MEASUREMENT AND PERSISTS NONE OF IT.
 *
 * By the time the route's `finally` runs, `telemetry` holds every provider
 * attempt, every seat and the whole synthesis stream lifecycle for the turn —
 * B1 (telemetry-after-audit-latch.test.js) proves the audit latch does not stop
 * that collection. The single `turnLedger.finish(...)` in that `finally` closed
 * the row with `turnId`, `state`, `answer` and `lastEventId` and NO `meta`, so
 * the row landed with `meta` at its column default `'{}'` and the measurement
 * died with the request.
 *
 * `audit_logs.metadata` is not a substitute. It is written at most once per
 * turn behind the audit latch, so its coverage is whatever branch happened to
 * fire first; `metadata.seats` is historically a number in some rows and an
 * array in others; and it is user-visible through `audit_owner_read`. None of
 * those are properties you want in the surface you are going to compute a p50
 * from.
 *
 * This file covers the persistence BOUNDARY. The serializer's own contract —
 * allow-list, privacy, caps — is in turn-reliability-meta.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { createTurnLedger } = require('./turn-ledger');
const { createTurnTelemetry } = require('./turn-telemetry');
const { buildTurnReliabilityMeta } = require('./turn-reliability-meta');

const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

const fakeSupabase = () => {
  const calls = [];
  return {
    calls,
    rpc: async () => ({ data: null, error: null }),
    from() {
      const api = {
        upsert() { return Promise.resolve({ data: null, error: null }); },
        update(patch) { calls.push(patch); return api; },
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        limit() { return api; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        then(resolve) { return Promise.resolve({ data: null, error: null }).then(resolve); },
      };
      return api;
    },
  };
};

/** A turn that did real work, recorded the way the route records it. */
function busyTelemetry() {
  let clock = 0;
  const telemetry = createTurnTelemetry({ now: () => clock, startedAt: 0 });
  telemetry.recordProviderAttempt({ phase: 'router', model: 'router/model', outcome: 'ok', status: 200, ms: 40 });
  telemetry.recordProviderAttempt({ phase: 'council', model: 'seat/one', outcome: 'http_error', status: 429, ms: 80, attempt: 1 });
  telemetry.recordProviderAttempt({ phase: 'council', model: 'seat/one', outcome: 'ok', status: 200, ms: 120, attempt: 2 });
  telemetry.recordSeat({ phase: 'council', model: 'seat/one', round: 1, durationMs: 200, outcome: 'answered' });
  telemetry.recordSeat({ phase: 'council', model: 'seat/two', round: 1, durationMs: 260, outcome: 'quorum' });
  telemetry.recordProviderAttempt({ phase: 'synthesis', model: 'head/model', outcome: 'ok', status: 200, ms: 900, streamed: true });
  telemetry.recordStreamTiming({
    phase: 'synthesis', model: 'head/model', status: 200, outcome: 'ok',
    streamOpenMs: 120, msToFirstToken: 480, streamBodyMs: 900, completed: true,
  });
  telemetry.recordSynthesis(1_020, 'head/model');
  clock = 2_500;
  return telemetry;
}

/* ---- the boundary, functionally ---------------------------------------- */

test('a finish that carries no meta persists none of the turn measurement', async () => {
  const telemetry = busyTelemetry();
  const snapshot = telemetry.snapshot({ category: 'council' });

  // The measurement is COMPLETE at this moment. That is the premise.
  assert.equal(snapshot.providerAttempts.byStatus['429'], 1);
  assert.equal(snapshot.seats.length, 2);
  assert.equal(snapshot.streamTimings[0].msToFirstToken, 480);

  const supabase = fakeSupabase();
  const ledger = createTurnLedger({ supabase });
  // Exactly the call the route's `finally` made before this change.
  await ledger.finish({ turnId: 't1', state: 'complete', answer: 'an answer', lastEventId: 12 });

  const patch = supabase.calls[0];
  assert.equal(patch.state, 'complete', 'the rest of finish is unchanged and must stay so');
  assert.equal(
    patch.meta, undefined,
    'a finish without meta leaves the column at its default — this is what the route used to do',
  );
});

test('finish persists the reliability namespace when the route hands it over', async () => {
  const telemetry = busyTelemetry();
  const meta = buildTurnReliabilityMeta(telemetry.snapshot({ category: 'council' }));

  const supabase = fakeSupabase();
  const rejected = [];
  const ledger = createTurnLedger({ supabase, onError: (m) => rejected.push(m) });
  await ledger.finish({ turnId: 't1', state: 'complete', answer: 'an answer', lastEventId: 12, meta });

  assert.deepEqual(rejected, [], 'the reliability namespace must pass the ledger contract, not be dropped by it');
  const patch = supabase.calls[0];
  assert.ok(patch.meta, 'meta must reach the row');
  assert.equal(patch.meta.reliability.schemaVersion, 1);
  assert.equal(patch.meta.reliability.providerAttempts.byStatus['429'], 1);
  assert.equal(patch.meta.reliability.seats.length, 2);
  assert.equal(patch.meta.reliability.synthesis.msToFirstToken, 480);
  // Everything else finish already did still happens.
  assert.equal(patch.state, 'complete');
  assert.equal(patch.answer, 'an answer');
  assert.equal(patch.last_event_id, 12);
  assert.equal(patch.answer_complete, true);
});

/* ---- the boundary, in the route ---------------------------------------- */

test('there is still exactly one turnLedger.finish, and it is in the route finally', () => {
  const calls = SOURCE.match(/turnLedger\.finish\(/g) || [];
  assert.equal(calls.length, 1, 'one close for eleven exits — a second one is a second chance to disagree');
});

test('the one finish takes the FINAL snapshot and passes reliability meta', () => {
  const at = SOURCE.indexOf('turnLedger.finish(');
  const call = SOURCE.slice(at, SOURCE.indexOf('});', at) + 3);
  assert.match(call, /meta:/, 'the finish call must not drop the completed telemetry on the floor');
  assert.match(
    call, /buildTurnReliabilityMeta\(/,
    'the meta must come from the explicit allow-list serializer, never from a spread snapshot',
  );
  // The snapshot must be taken AT the finish, not carried from an earlier
  // branch: everything recorded after that branch is what this exists to keep.
  assert.match(call, /telemetry\.snapshot\(/, 'the snapshot must be the final one, taken here');
});

test('the serializer is the only thing that reaches turns.meta', () => {
  const at = SOURCE.indexOf('turnLedger.finish(');
  const call = SOURCE.slice(at, SOURCE.indexOf('});', at) + 3);
  assert.ok(
    !/\.\.\.\s*telemetry|\.\.\.\s*snapshot|\.\.\.\s*settleSnapshot/.test(call),
    'a spread snapshot would put arbitrary telemetry content into a database column',
  );
});
