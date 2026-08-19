'use strict';

/**
 * THE CONTRACT OF `turns.meta.reliability`.
 *
 * Three things are being defended here and they are not the same thing:
 *
 *   1. THE SHAPE. A query written against this column is written once and read
 *      for months; `seats` being an array in some rows and a number in others is
 *      exactly what made `audit_logs.metadata` unqueryable, and it happened
 *      because nothing ever said out loud that it was an array.
 *   2. THE PRIVACY. The serializer is an allow-list, so the interesting test is
 *      not "does field X survive" but "does anything we did not name survive",
 *      asked with sentinels planted at every nesting depth the snapshot has.
 *   3. THE BOUND. `recordSeat` has no cap in the recorder, so this file is where
 *      the cap lives, and an uncapped array on the path that answers a user is a
 *      row that grows with a bug.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTurnTelemetry } = require('./turn-telemetry');
const {
  buildTurnReliabilityMeta, SCHEMA_VERSION, MAX_SEAT_RECORDS, MAX_STATUS_KEYS,
} = require('./turn-reliability-meta');

/* ---- a turn, recorded the way the route records one ---------------------- */

function councilTurn({ clock = { t: 0 } } = {}) {
  const telemetry = createTurnTelemetry({ now: () => clock.t, startedAt: 0 });
  telemetry.recordProviderAttempt({ phase: 'router', provider: 'openrouter', model: 'router/fast', outcome: 'ok', status: 200, ms: 45 });
  // A seat that 429s, retries and lands. Both facts must survive.
  telemetry.recordProviderAttempt({ phase: 'council', provider: 'openrouter', model: 'seat/one', outcome: 'http_error', status: 429, ms: 60, attempt: 1 });
  telemetry.recordProviderAttempt({ phase: 'council', provider: 'openrouter', model: 'seat/one', outcome: 'ok', status: 200, ms: 340, attempt: 2 });
  // A seat whose model no provider serves.
  telemetry.recordProviderAttempt({ phase: 'council', provider: 'openrouter', model: 'seat/gone', outcome: 'http_error', status: 404, ms: 30, attempt: 1 });
  telemetry.recordSeat({ phase: 'council', model: 'seat/one', round: 1, durationMs: 400, outcome: 'answered' });
  telemetry.recordSeat({ phase: 'council', model: 'seat/gone', round: 1, durationMs: 30, outcome: 'failed' });
  telemetry.recordSeat({ phase: 'council', model: 'seat/slow', round: 1, durationMs: 900, outcome: 'quorum' });
  telemetry.recordProviderAttempt({ phase: 'synthesis', provider: 'openrouter', model: 'head/model', outcome: 'ok', status: 200, ms: 1_100, streamed: true });
  telemetry.recordStreamTiming({
    phase: 'synthesis', provider: 'openrouter', model: 'head/model', status: 200, outcome: 'ok',
    streamOpenMs: 130, msToFirstToken: 520, streamBodyMs: 970, completed: true,
  });
  telemetry.recordSynthesis(1_100, 'head/model');
  telemetry.recordUsage({ promptTokens: 4_000, completionTokens: 610, totalTokens: 4_610 }, { phase: 'synthesis' });
  clock.t = 2_600;
  return telemetry;
}

const build = (telemetry, opts = {}) => buildTurnReliabilityMeta(telemetry.snapshot({ category: 'final', ...opts }));

/* ---- the shape ----------------------------------------------------------- */

test('the namespace is versioned and nothing sits outside it', () => {
  const meta = build(councilTurn());
  assert.deepEqual(Object.keys(meta), ['reliability'], 'one namespace, so an unrelated meta writer cannot collide');
  assert.equal(meta.reliability.schemaVersion, SCHEMA_VERSION);
  assert.equal(meta.reliability.schemaVersion, 1);
});

test('seats is ALWAYS an array and the count is a separate number', () => {
  const withSeats = build(councilTurn()).reliability;
  assert.ok(Array.isArray(withSeats.seats));
  assert.equal(withSeats.seats.length, 3);
  assert.equal(withSeats.council.seatCount, 3);
  assert.equal(typeof withSeats.council.seatCount, 'number');

  // The turn that ran no council at all is the one that used to change the type.
  const bare = buildTurnReliabilityMeta(createTurnTelemetry().snapshot({ category: 'greeting' })).reliability;
  assert.ok(Array.isArray(bare.seats), 'a turn with no seats has an EMPTY ARRAY, never 0 and never absent');
  assert.equal(bare.seats.length, 0);
  assert.equal(bare.council.seatCount, 0);
});

test('a 404, a 429 and the retry that followed all survive', () => {
  const r = build(councilTurn()).reliability;
  assert.equal(r.providerAttempts.byStatus['429'], 1, 'a 429 wants pacing');
  assert.equal(r.providerAttempts.byStatus['404'], 1, 'a 404 wants the model removed from the roster');
  assert.equal(r.providerAttempts.byStatus['200'], 3);
  assert.equal(r.providerAttempts.retries, 1, 'the retry is the difference between a seat and a request');
  assert.equal(r.providerAttempts.total, 5);
  assert.equal(r.providerAttempts.ok, 3);
  assert.equal(r.providerAttempts.failed, 2);
});

test('the quorum cut and the usable seat are told apart', () => {
  const r = build(councilTurn()).reliability;
  const byModel = Object.fromEntries(r.seats.map((s) => [s.model, s]));
  assert.equal(byModel['seat/slow'].outcome, 'quorum', 'cut by the quorum, paid for, not used');
  assert.equal(byModel['seat/slow'].usable, false);
  assert.equal(byModel['seat/one'].outcome, 'answered');
  assert.equal(byModel['seat/one'].usable, true);
  assert.equal(byModel['seat/gone'].usable, false);
  assert.equal(r.council.usableCount, 1);
  assert.equal(byModel['seat/slow'].durationMs, 900, 'seat latency is what a p50 is computed from');
});

test('the router lifecycle survives', () => {
  const r = build(councilTurn()).reliability;
  assert.equal(r.router.model, 'router/fast');
  assert.equal(r.router.provider, 'openrouter');
  assert.equal(r.router.status, 200);
  assert.equal(r.router.outcome, 'ok');
  assert.equal(r.router.attempts, 1);
  assert.equal(r.router.durationMs, 45);
  // A turn that never routed says so with null, not with a zeroed record.
  assert.equal(buildTurnReliabilityMeta(createTurnTelemetry().snapshot({})).reliability.router, null);
});

test('the whole synthesis stream lifecycle survives', () => {
  const r = build(councilTurn()).reliability.synthesis;
  assert.equal(r.model, 'head/model');
  assert.equal(r.provider, 'openrouter');
  assert.equal(r.status, 200);
  assert.equal(r.outcome, 'ok');
  assert.equal(r.attempts, 1);
  assert.equal(r.streamOpenMs, 130, 'how long the handshake took');
  assert.equal(r.msToFirstToken, 520, 'TTFT, the number the user actually feels');
  assert.equal(r.streamBodyMs, 970, 'the body, which the attempt row never measured');
  assert.equal(r.streamTotalMs, 1_100, 'derived from its own two halves, so they cannot disagree');
  assert.equal(r.completionTokens, 610);
  assert.equal(r.completed, true);
  assert.equal(r.abortReason, null);
});

test('a stream that emitted nothing reports a null TTFT, never a zero', () => {
  const telemetry = createTurnTelemetry();
  telemetry.recordStreamTiming({
    phase: 'synthesis', model: 'head/model', outcome: 'aborted',
    streamOpenMs: 200, msToFirstToken: null, streamBodyMs: 4_000,
    aborted: true, abortReason: 'turn_deadline',
  });
  const r = buildTurnReliabilityMeta(telemetry.snapshot({})).reliability.synthesis;
  assert.equal(r.msToFirstToken, null, '0 would read as an instant answer and drag a percentile with it');
  assert.equal(r.aborted, true);
  assert.equal(r.abortReason, 'turn_deadline', 'a binding deadline is not a user closing a tab');
});

test('a turn that never synthesised says null rather than a zeroed record', () => {
  const telemetry = createTurnTelemetry();
  telemetry.recordSeat({ model: 'seat/one', durationMs: 10, outcome: 'answered' });
  assert.equal(buildTurnReliabilityMeta(telemetry.snapshot({})).reliability.synthesis, null);
});

test('the turn-level abort reason survives', () => {
  const telemetry = createTurnTelemetry();
  telemetry.markCancelled('client_disconnected');
  const r = buildTurnReliabilityMeta(telemetry.snapshot({ category: 'aborted', aborted: true })).reliability;
  assert.equal(r.aborted, true);
  assert.equal(r.abortReason, 'client_disconnected');
  assert.equal(r.category, 'aborted');
});

/* ---- the privacy --------------------------------------------------------- */

const SENTINELS = [
  'SECRET_USER_PROMPT_123',
  'SECRET_ASSISTANT_ANSWER_456',
  'SECRET_COUNCIL_DRAFT_789',
  'SECRET_PROVIDER_BODY',
  'sk-test-secret',
  'SHOULD_NOT_SURVIVE',
];

test('nothing that was not named in the allow-list reaches the column', () => {
  const telemetry = councilTurn();

  /* Planted through the RECORDERS, at every level they accept, because that is
   * how content would actually arrive: a provider echoing the request it
   * refused, an error string used as an outcome, a caller filing a draft. */
  telemetry.recordProviderAttempt({
    phase: 'council', model: 'seat/leaky', provider: 'SECRET_PROVIDER_BODY',
    outcome: 'SHOULD_NOT_SURVIVE', status: 500, ms: 1,
    body: 'SECRET_PROVIDER_BODY', error: new Error('SECRET_PROVIDER_BODY'),
  });
  telemetry.recordSeat({
    model: 'seat/leaky', durationMs: 1, outcome: 'failed',
    draft: 'SECRET_COUNCIL_DRAFT_789', answer: 'SECRET_ASSISTANT_ANSWER_456',
    prompt: 'SECRET_USER_PROMPT_123',
  });
  telemetry.recordStreamTiming({
    phase: 'synthesis', model: 'head/model', outcome: 'ok',
    streamOpenMs: 1, streamBodyMs: 1, text: 'SECRET_ASSISTANT_ANSWER_456',
  });

  /* And planted through the two doors that take a free-form bag: the snapshot's
   * `extra`, which every audit caller fills by hand, and the top level. */
  const snapshot = telemetry.snapshot({
    category: 'final',
    extra: {
      question: 'SECRET_USER_PROMPT_123',
      answer: 'SECRET_ASSISTANT_ANSWER_456',
      apiKey: 'sk-test-secret',
      history: [{ role: 'user', content: 'SECRET_USER_PROMPT_123' }],
      systemPrompt: 'SECRET_USER_PROMPT_123',
      search: { results: [{ snippet: 'SHOULD_NOT_SURVIVE' }] },
      stack: new Error('SECRET_PROVIDER_BODY').stack,
      nested: { deep: { deeper: { deepest: 'SHOULD_NOT_SURVIVE' } } },
    },
  });
  // Straight onto the snapshot object too — the shape a future field would take.
  snapshot.drafts = ['SECRET_COUNCIL_DRAFT_789'];
  snapshot.providerAttempts.rawBody = 'SECRET_PROVIDER_BODY';
  snapshot.seats[0].draft = 'SECRET_COUNCIL_DRAFT_789';
  snapshot.streamTimings[0].chunk = 'SECRET_ASSISTANT_ANSWER_456';
  snapshot.providerAttempts.byStatus['SECRET_USER_PROMPT_123'] = 1;
  /* NOT a sentinel: `abortReason` is an allow-listed classification and the
   * test above already pins that it is clipped. Planting content in a field
   * that is meant to carry a short reason would be testing the wrong thing. */
  snapshot.cancellation = { reason: 'client_disconnected', note: 'SHOULD_NOT_SURVIVE' };

  const serialized = JSON.stringify(buildTurnReliabilityMeta(snapshot));
  for (const sentinel of SENTINELS) {
    assert.ok(!serialized.includes(sentinel), `${sentinel} survived into turns.meta`);
  }
});

test('a status map cannot be used to smuggle a key', () => {
  const meta = buildTurnReliabilityMeta({
    providerAttempts: {
      byStatus: {
        200: 3,
        429: 1,
        none: 2,
        SECRET_USER_PROMPT_123: 1,
        'sk-test-secret': 9,
        999: 1,
        '-1': 1,
        401: -5,
        403: 'SHOULD_NOT_SURVIVE',
      },
    },
  });
  const byStatus = meta.reliability.providerAttempts.byStatus;
  assert.deepEqual(byStatus, { 200: 3, 429: 1, none: 2 }, 'status-like keys with non-negative counts, nothing else');
});

test('an outcome long enough to be prose is clipped to a classification', () => {
  const telemetry = createTurnTelemetry();
  telemetry.recordSeat({ model: 'm', durationMs: 1, outcome: 'x'.repeat(5_000) });
  telemetry.markCancelled('y'.repeat(5_000));
  const r = buildTurnReliabilityMeta(telemetry.snapshot({})).reliability;
  assert.ok(r.seats[0].outcome.length <= 60, 'a reason is a classification; a provider message is not one');
  assert.ok(r.abortReason.length <= 60, 'the same for an abort reason, which is also only ever a classification');
});

/* A timing that was never taken must not read as a timing of zero. */
test('an unmeasured timing is null, never a zero', () => {
  const r = buildTurnReliabilityMeta(createTurnTelemetry().snapshot({})).reliability;
  assert.equal(r.msToFirstByte, null, '0 here would say the first byte arrived instantly');
});

/* ---- the bound ----------------------------------------------------------- */

test('seats are capped, and the row says so instead of lying about the count', () => {
  const telemetry = createTurnTelemetry();
  for (let i = 0; i < MAX_SEAT_RECORDS + 40; i += 1) {
    telemetry.recordSeat({ model: `seat/${i}`, durationMs: i, outcome: 'answered' });
  }
  const r = buildTurnReliabilityMeta(telemetry.snapshot({})).reliability;
  assert.equal(r.seats.length, MAX_SEAT_RECORDS, 'recordSeat has no cap of its own; this is the only one');
  assert.equal(r.council.seatCount, MAX_SEAT_RECORDS + 40, 'the COUNT stays exact — losing it would misreport the turn');
  assert.equal(r.council.seatsTruncated, true, 'a short array must be distinguishable from a small council');
  assert.equal(r.council.usableCount, MAX_SEAT_RECORDS + 40);
});

test('the status map cannot grow without bound', () => {
  const byStatus = {};
  for (let i = 0; i < 200; i += 1) byStatus[String(200 + (i % 300))] = 1;
  const out = buildTurnReliabilityMeta({ providerAttempts: { byStatus } }).reliability.providerAttempts.byStatus;
  assert.ok(Object.keys(out).length <= MAX_STATUS_KEYS);
});

test('a missing or junk snapshot produces a valid row rather than a throw', () => {
  for (const input of [undefined, null, 'nonsense', 42, [], {}]) {
    const r = buildTurnReliabilityMeta(input).reliability;
    assert.equal(r.schemaVersion, 1);
    assert.ok(Array.isArray(r.seats));
    assert.equal(r.council.seatCount, 0);
    assert.equal(r.providerAttempts.total, 0);
  }
});

/* ---- coverage: every state the route can close a begun turn in ----------- */

test('every begun turn gets a reliability row, whatever state it closes in', () => {
  const cases = {
    /* council success */
    council: () => councilTurn(),
    /* simple / fallback: no council, one head call */
    simple: () => {
      const t = createTurnTelemetry();
      t.recordProviderAttempt({ phase: 'synthesis', model: 'head/model', outcome: 'ok', status: 200, ms: 300 });
      t.recordSynthesis(300, 'head/model');
      return t;
    },
    /* an error thrown after begin: attempts exist, nothing finished */
    error: () => {
      const t = createTurnTelemetry();
      t.recordProviderAttempt({ phase: 'council', model: 'seat/one', outcome: 'http_error', status: 500, ms: 20 });
      return t;
    },
    /* the client left */
    clientAbort: () => {
      const t = createTurnTelemetry();
      t.recordSeat({ model: 'seat/one', durationMs: 100, outcome: 'aborted' });
      t.markCancelled('client_disconnected');
      return t;
    },
    /* the turn deadline bound */
    deadlineAbort: () => {
      const t = createTurnTelemetry();
      t.recordStreamTiming({
        phase: 'synthesis', model: 'head/model', outcome: 'aborted',
        streamOpenMs: 100, msToFirstToken: null, streamBodyMs: 30_000,
        aborted: true, abortReason: 'turn_deadline',
      });
      t.markCancelled('turn_deadline');
      return t;
    },
  };
  for (const [name, make] of Object.entries(cases)) {
    const aborted = name.endsWith('Abort');
    const r = buildTurnReliabilityMeta(make().snapshot({
      category: aborted ? 'aborted' : 'final', aborted,
    })).reliability;
    assert.equal(r.schemaVersion, 1, `${name}: versioned`);
    assert.ok(Array.isArray(r.seats), `${name}: seats is an array`);
    assert.equal(typeof r.council.seatCount, 'number', `${name}: seatCount is a number`);
    assert.equal(r.aborted, aborted, `${name}: abort flag`);
    if (aborted) assert.ok(r.abortReason, `${name}: an abort must say which one`);
  }
});
