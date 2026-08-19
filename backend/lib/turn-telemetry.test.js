const test = require("node:test");
const assert = require("node:assert/strict");
const { createTurnTelemetry } = require("./turn-telemetry");

test("records each turn phase without retaining prompts or answers", async () => {
  let clock = 100;
  const telemetry = createTurnTelemetry({ now: () => clock, startedAt: clock });

  await telemetry.measureContext("summary", async () => {
    clock += 4;
    return "private summary";
  });
  await assert.rejects(
    telemetry.measureRouter("search", async () => {
      clock += 6;
      throw new Error("router failed");
    }),
    /router failed/,
  );
  telemetry.recordContextCompression({
    compressed: true,
    originalMessages: 20,
    retainedMessages: 8,
    originalChars: 48_000,
    retainedChars: 11_000,
    droppedMessages: 12,
    relevantTurns: 2,
    maxChars: 12_000,
    maxMessages: 10,
  });
  telemetry.recordSeat({ phase: "council", round: 1, model: "alpha", durationMs: 120, outcome: "answered" });
  telemetry.recordSeat({ phase: "tools", round: 2, model: "beta", durationMs: 80, outcome: "timed_out" });
  telemetry.recordToolRound({ round: 1, durationMs: 210, calls: 2, aborted: false });
  telemetry.recordSynthesis(330);
  telemetry.recordFallback(90, "post_council");
  telemetry.markCeiling("round_whip");
  clock += 50;

  const row = telemetry.snapshot({ category: "council", msToFirstByte: 700, msToFirstProgress: 500 });
  assert.equal(row.telemetry, "council_turn");
  assert.equal(row.turnMs, 60);
  assert.deepEqual(row.contextReads.summary, { ms: 4, ok: true });
  assert.deepEqual(row.routerReads.search, { ms: 6, ok: false });
  assert.equal(row.contextMs, 4);
  assert.deepEqual(row.contextCompression, {
    compressed: true,
    originalMessages: 20,
    retainedMessages: 8,
    originalChars: 48_000,
    retainedChars: 11_000,
    droppedMessages: 12,
    relevantTurns: 2,
    maxChars: 12_000,
    maxMessages: 10,
  });
  assert.equal(row.synthesisMs, 330);
  assert.equal(row.toolMs, 210);
  assert.equal(row.toolRounds[0].calls, 2);
  assert.equal(row.seats[1].model, "beta");
  assert.deepEqual(row.ceiling, { hit: true, reason: "round_whip" });
  assert.deepEqual(row.fallbackCouncil, { used: true, durationMs: 90, kind: "post_council" });
  assert.equal(JSON.stringify(row).includes("private summary"), false);
});

test("the first ceiling reason wins", () => {
  const telemetry = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  telemetry.markCeiling("wall");
  telemetry.markCeiling("tool_budget");
  assert.deepEqual(telemetry.snapshot().ceiling, { hit: true, reason: "wall" });
});

test("compression telemetry clamps non-finite sizes", () => {
  const telemetry = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  telemetry.recordContextCompression({ originalChars: Infinity, retainedMessages: Number.NaN });
  assert.equal(telemetry.snapshot().contextCompression.originalChars, 0);
  assert.equal(telemetry.snapshot().contextCompression.retainedMessages, 0);
});

test("token usage is summed per phase and absent when no provider reported it", () => {
  const bare = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  assert.equal(bare.snapshot().usage, null, "a zero would read as 'this turn cost nothing'");

  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  t.recordUsage({ promptTokens: 100, completionTokens: 20, totalTokens: 120, costUsd: 0.001 }, { phase: "council" });
  t.recordUsage({ promptTokens: 50, completionTokens: 10, totalTokens: 60, costUsd: 0.0005 }, { phase: "council" });
  t.recordUsage({ promptTokens: 900, completionTokens: 400, totalTokens: 1300, costUsd: 0.004 }, { phase: "synthesis" });
  t.recordUsage(null);
  t.recordUsage(undefined, { phase: "synthesis" });

  const { usage } = t.snapshot();
  assert.equal(usage.calls, 3, "a null usage is not a call");
  assert.equal(usage.totalTokens, 1480);
  assert.equal(usage.promptTokens, 1050);
  assert.equal(usage.completionTokens, 430);
  assert.equal(usage.costUsd, 0.0055);
  assert.equal(usage.byPhase.council.calls, 2);
  assert.equal(usage.byPhase.synthesis.totalTokens, 1300);
});

test("a provider that reports no numbers does not poison the sums", () => {
  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  t.recordUsage({ promptTokens: null, completionTokens: null, totalTokens: null, costUsd: null });
  const { usage } = t.snapshot();
  assert.equal(usage.calls, 1, "the call still happened");
  assert.equal(usage.totalTokens, 0);
});

/* ---- physical provider attempts, tool outcomes, cancellation ---------- */

const { createTurnContext } = require("./turn-context");

test("the ids that make a row findable are carried into the snapshot", () => {
  const context = createTurnContext({ operationId: "op-1", newId: () => "turn-1" });
  const snap = createTurnTelemetry({ now: () => 0, startedAt: 0, context }).snapshot({});
  assert.equal(snap.operationId, "op-1");
  assert.equal(snap.turnId, "turn-1");
});

test("a turn with no context still snapshots, without inventing ids", () => {
  const snap = createTurnTelemetry({ now: () => 0, startedAt: 0 }).snapshot({});
  assert.equal("operationId" in snap, false);
  assert.equal("turnId" in snap, false);
});

/* THE NUMBER THE CEILING SETTLES AGAINST. A seat retried twice inside
 * lib/openrouter.js is ONE seat record and THREE requests against an
 * account-wide daily cap; before this the ceiling could only see the seat. */
test("physical provider attempts are counted separately from logical seats", () => {
  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  t.recordSeat({ model: "a", durationMs: 10, outcome: "ok" });
  t.recordProviderAttempt({ model: "a", attempt: 1, outcome: "http_error", status: 503 });
  t.recordProviderAttempt({ model: "a", attempt: 2, outcome: "http_error", status: 503 });
  t.recordProviderAttempt({ model: "a", attempt: 3, outcome: "ok", status: 200 });
  const snap = t.snapshot({});
  assert.equal(snap.seats.length, 1, "one seat was asked");
  assert.equal(snap.providerRequests, 3, "three POSTs reached the gateway");
  assert.equal(snap.providerAttempts.retries, 2);
  assert.equal(snap.providerAttempts.ok, 1);
  assert.equal(snap.providerAttempts.failed, 2);
  assert.deepEqual(snap.providerAttempts.byOutcome, { http_error: 2, ok: 1 });
});

test("a non-OpenRouter attempt is counted but never charged to the OpenRouter quota", () => {
  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  t.recordProviderAttempt({ provider: "google", model: "gemini", outcome: "ok" });
  const snap = t.snapshot({});
  assert.equal(snap.providerAttempts.total, 1);
  assert.equal(snap.providerRequests, 0, "vision does not spend the OpenRouter day");
});

test("attempt DETAIL is capped while the counts stay exact", () => {
  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  for (let i = 0; i < 250; i++) t.recordProviderAttempt({ outcome: "ok", attempt: 1 });
  const snap = t.snapshot({});
  assert.equal(snap.providerRequests, 250, "the count a ceiling reads is never truncated");
  assert.equal(snap.providerAttempts.truncatedDetail, true);
});

test("tool success is recorded, not just tool count", () => {
  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  t.recordToolOutcome({ name: "web_search", ok: true, ms: 400, round: 1 });
  t.recordToolOutcome({ name: "read_url", ok: false, ms: 900, round: 1 });
  t.recordToolOutcome({ name: "web_search", ok: true, ms: 200, round: 2 });
  const snap = t.snapshot({});
  assert.equal(snap.toolOutcomes.calls, 3);
  assert.equal(snap.toolOutcomes.ok, 2);
  assert.equal(snap.toolOutcomes.failed, 1);
  assert.deepEqual(snap.toolOutcomes.byName.web_search, { calls: 2, ok: 2, ms: 600 });
});

test("a turn that used no tools reports null rather than a zeroed object", () => {
  assert.equal(createTurnTelemetry({ now: () => 0, startedAt: 0 }).snapshot({}).toolOutcomes, null);
});

/* `aborted: true` was one number for three different problems. */
test("cancellation records why, once, and the first reason wins", () => {
  const t = createTurnTelemetry({ now: () => 100, startedAt: 0 });
  assert.equal(t.snapshot({}).cancellation, null);
  t.markCancelled("client_disconnected");
  t.markCancelled("deadline");
  const snap = t.snapshot({ aborted: true });
  assert.deepEqual(snap.cancellation, { reason: "client_disconnected", atMs: 100 });
});

test("the answer's provenance is recorded so a rescued answer is not silently cached as a written one", () => {
  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  assert.equal(t.snapshot({}).textSource, null);
  t.recordTextSource("reasoning");
  assert.equal(t.snapshot({}).textSource, "reasoning");
});

/* THE STATUS HAD TO REACH THE STORED ROW.
 *
 * `byOutcome` collapsed every non-200 into `http_error`, so a production window
 * where 61-72% of provider requests failed could not say whether they were 429s
 * or 5xx — and those want opposite fixes (pace vs. change the roster). The
 * status was captured per attempt and dropped at the snapshot boundary.
 *
 * Watched fail before the fix: `byStatus` was undefined. */
test('the snapshot reports provider failures by HTTP status', () => {
  const t = createTurnTelemetry();
  t.recordProviderAttempt({ provider: 'openrouter', outcome: 'http_error', status: 429, attempt: 1 });
  t.recordProviderAttempt({ provider: 'openrouter', outcome: 'http_error', status: 429, attempt: 2 });
  t.recordProviderAttempt({ provider: 'openrouter', outcome: 'http_error', status: 503, attempt: 3 });
  t.recordProviderAttempt({ provider: 'openrouter', outcome: 'ok', status: 200, attempt: 1 });

  const snap = t.snapshot();
  assert.deepEqual(snap.providerAttempts.byStatus, { 429: 2, 503: 1, 200: 1 });
  assert.equal(snap.providerAttempts.failed, 3);
});

/* An attempt that never got a reply carries no status. Counting it under 'none'
 * rather than dropping it matters: "no reply at all" is one of the answers this
 * field exists to distinguish from a rate limit. */
test('attempts with no HTTP status are counted, not dropped', () => {
  const t = createTurnTelemetry();
  t.recordProviderAttempt({ provider: 'openrouter', outcome: 'network_error', status: null, attempt: 1 });
  t.recordProviderAttempt({ provider: 'openrouter', outcome: 'timeout', attempt: 1 });

  const snap = t.snapshot();
  assert.deepEqual(snap.providerAttempts.byStatus, { none: 2 });
  assert.equal(
    Object.values(snap.providerAttempts.byStatus).reduce((a, b) => a + b, 0),
    snap.providerAttempts.total,
    'every attempt appears exactly once under some status key',
  );
});

/* The per-attempt DETAIL is capped at 200 records; these counts are not. A retry
 * storm is precisely the case whose statuses matter most and precisely the case
 * the cap truncates, so the two must not share a limit. */
test('statuses stay exact past the detail cap', () => {
  const t = createTurnTelemetry();
  for (let i = 0; i < 250; i += 1) {
    t.recordProviderAttempt({ provider: 'openrouter', outcome: 'http_error', status: 429, attempt: 1 });
  }
  const snap = t.snapshot();
  assert.equal(snap.providerAttempts.byStatus['429'], 250, 'counts are exact');
  assert.equal(snap.providerAttempts.truncatedDetail, true, 'while the detail array was capped');
});

/* THE TWO CACHE PROBES WERE THE ONLY UNTIMED STAGE ON THE TURN PATH.
 *
 * `measureContext` and `measureRouter` already time every other read, so a p95
 * first-byte breakdown could account for history, episodes, facts and routing
 * — and then attributed the exact and semantic cache lookups to nothing at all.
 * They run in series before the router on every miss, which is most turns.
 *
 * Watched fail before the fix: `telemetry.measureCache is not a function`. */
test('cache probes are timed under their own name', async () => {
  let clock = 0;
  const t = createTurnTelemetry({ now: () => clock });
  const value = await t.measureCache('answerExact', async () => { clock += 40; return 'hit'; });
  assert.equal(value, 'hit', 'the measured value passes through untouched');

  const snap = t.snapshot({});
  assert.deepEqual(snap.cacheReads.answerExact, { ms: 40, ok: true });
});

/* A LOOKUP THAT THREW STILL COST ITS TIME. Recording only successes would make
 * the slow case — the one worth finding — the invisible one. */
test('a failing cache probe is timed and still rejects', async () => {
  let clock = 0;
  const t = createTurnTelemetry({ now: () => clock });
  await assert.rejects(t.measureCache('answerSemantic', async () => { clock += 90; throw new Error('pgvector timeout'); }));
  assert.deepEqual(t.snapshot({}).cacheReads.answerSemantic, { ms: 90, ok: false });
});

/* CACHE TIME IS NOT CONTEXT TIME. `contextMs` is a published sum over
 * `contextReads` and is already being read; filing the cache probes there would
 * have silently inflated an existing measurement rather than adding a new one.
 * The buckets stay separate for the same reason `routerReads` is separate. */
test('cache timings do not inflate contextMs', async () => {
  let clock = 0;
  const t = createTurnTelemetry({ now: () => clock });
  await t.measureContext('summary', async () => { clock += 10; });
  await t.measureCache('answerExact', async () => { clock += 500; });

  const snap = t.snapshot({});
  assert.equal(snap.contextMs, 10, 'context time counts context reads only');
  assert.equal(snap.cacheReads.answerExact.ms, 500);
  assert.equal(snap.contextReads.answerExact, undefined);
});

/* The hit branches write bare metadata by hand (`auditBranch`), never
 * `snapshot()`, so they need a reader of their own — otherwise the turns whose
 * latency this measurement exists to explain are the turns with no measurement. */
test('cache timings are readable without taking a whole snapshot', async () => {
  const t = createTurnTelemetry({ now: () => 0 });
  await t.measureCache('answerExact', async () => 'x');
  const reads = t.cacheReads();
  assert.deepEqual(Object.keys(reads), ['answerExact']);
  reads.answerExact = 'tampered';
  assert.notEqual(t.cacheReads().answerExact, 'tampered', 'the caller gets a copy, not the live bucket');
});

/* THE PER-SEAT RECORDS WERE BEING DESTROYED BY THE ROW THAT CARRIED THEM.
 *
 * `snapshot()` spreads `...extra` last, and every council branch passed
 * `seats: selection.members.length` — a NUMBER — through `extra`. So the array
 * `recordSeat` spent the whole turn building was overwritten by a count on its
 * way into `audit_logs.metadata`.
 *
 * MEASURED in production, 30-day window: of 58 current-schema turns, exactly 1
 * carried a seats array, and 33 council turns and 24 fallback turns carried
 * none. The one survivor was an aborted turn whose `extra` happened not to
 * include the key. That is why the seat sample was n=14 — it was never traffic
 * volume, it was this.
 *
 * THE COUNT IS RENAMED, NOT THE ARRAY. `admin-commands.js` reads `row.seats`
 * expecting an array and falls back to [] when it finds a number, and
 * `lib/spend.js` reads `snap.seats` the same way. Renaming the array would
 * mean changing both readers and every already-written row that does hold an
 * array; renaming the count touches only the eight writers in server.js. The
 * count now travels as `seatCount`.
 *
 * Watched fail before the fix: `seats` === 7, a number, not the two records. */
test('a count passed through extra cannot destroy the per-seat records', () => {
  const t = createTurnTelemetry();
  t.recordSeat({ model: 'a:free', durationMs: 18002, outcome: 'timed_out' });
  t.recordSeat({ model: 'b:free', durationMs: 900, outcome: 'answered' });

  /* Exactly the shape the council path passes today: `auditTelemetry` hands the
   * count through the NESTED `extra` bag, which `snapshot()` spreads last. */
  const snap = t.snapshot({ category: 'council', extra: { seatCount: 7, quorum: 2 } });

  assert.ok(Array.isArray(snap.seats), '`seats` is the per-seat array, always');
  assert.equal(snap.seats.length, 2, 'and every recorded seat survives the row');
  assert.deepEqual(snap.seats.map((s) => s.outcome), ['timed_out', 'answered']);
  assert.equal(snap.seats[0].ms, 18002);
  assert.equal(snap.seats[0].model, 'a:free');

  assert.equal(snap.seatCount, 7, 'the count travels beside it, under its own name');
  assert.equal(snap.seatTimings, undefined, 'there is no third name for either of them');
});

/* The zero-seat branches (arithmetic, greeting, both answer caches) audit with
 * `seatCount: 0`. Their shape has to be the same shape, or a reader that sums
 * `seats.length` across rows has to special-case them. */
test('a turn that dispatched no seats has an empty array and a zero count', () => {
  const t = createTurnTelemetry();
  const snap = t.snapshot({ category: 'answer_cache', extra: { seatCount: 0 } });

  assert.deepEqual(snap.seats, [], 'no seats recorded is an empty array, not a missing field');
  assert.equal(snap.seatCount, 0);
  assert.equal(snap.seatTimings, undefined);
});

/* THE PER-ATTEMPT DETAIL WAS BUILT ALL TURN AND THROWN AWAY AT THE BOUNDARY.
 *
 * `recordProviderAttempt` has always stored a full row per physical request —
 * provider, model, PHASE, attempt number, outcome, status, ms, streamed — into
 * a capped array. `snapshot()` then emitted only `attemptTotals`, so the array
 * never reached `audit_logs.metadata` and died with the turn. Same shape as the
 * seats bug: collected all turn, discarded one line from the destination.
 *
 * MEASURED CONSEQUENCE, production turn 2026-08-19T01:21:03.9Z: the row said
 * `providerRequests: 6`, `byOutcome {ok:3, bad_body:2, http_error:1}` and
 * `synthesisMs: 37402`, and NOTHING in it could say how many of those six
 * requests the synthesis made or how long any single one took. The 37.4s could
 * not be attributed to one slow call or several sequential ones, which is the
 * only question worth asking about the largest phase in the turn.
 *
 * The counts stay exactly where they are: `attemptTotals` is what the spend
 * ceiling settles against, and `byPhase` is derived from the same rows rather
 * than counted a second time.
 *
 * Watched fail before the fix: `byPhase` and `detail` both undefined. */
test('the snapshot carries per-attempt detail, not only the totals', () => {
  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  t.recordProviderAttempt({ phase: 'router', model: 'fast', attempt: 1, outcome: 'bad_body', status: 200, ms: 4005 });
  t.recordProviderAttempt({ phase: 'council', model: 'dead', attempt: 1, outcome: 'http_error', status: 404, ms: 30 });
  t.recordProviderAttempt({ phase: 'synthesis', model: 'head', attempt: 1, outcome: 'ok', status: 200, ms: 37402, streamed: true });
  const snap = t.snapshot({});

  assert.equal(snap.providerAttempts.detail.length, 3);
  const synth = snap.providerAttempts.detail.find((a) => a.phase === 'synthesis');
  assert.equal(synth.model, 'head');
  assert.equal(synth.attempt, 1);
  assert.equal(synth.outcome, 'ok');
  assert.equal(synth.status, 200);
  assert.equal(synth.ms, 37402);
  assert.equal(synth.streamed, true);
  assert.equal(synth.provider, 'openrouter');
});

/* WHICH PHASE SPENT THE TIME — the question `synthesisMs` alone cannot answer
 * once a phase can make more than one request. */
test('attempts roll up by phase so synthesis can be told from council and router', () => {
  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  t.recordProviderAttempt({ phase: 'router', model: 'fast', attempt: 1, outcome: 'bad_body', status: 200, ms: 2000 });
  t.recordProviderAttempt({ phase: 'router', model: 'fast', attempt: 2, outcome: 'bad_body', status: 200, ms: 2005 });
  t.recordProviderAttempt({ phase: 'council', model: 'dead', attempt: 1, outcome: 'http_error', status: 404, ms: 30 });
  t.recordProviderAttempt({ phase: 'council', model: 'nano', attempt: 1, outcome: 'ok', status: 200, ms: 7403 });
  t.recordProviderAttempt({ phase: 'synthesis', model: 'head', attempt: 1, outcome: 'ok', status: 200, ms: 37402, streamed: true });
  const snap = t.snapshot({});

  assert.deepEqual(snap.providerAttempts.byPhase.synthesis, {
    attempts: 1, ok: 1, failed: 0, retries: 0, ms: 37402, models: { head: 1 },
  });
  assert.deepEqual(snap.providerAttempts.byPhase.router, {
    attempts: 2, ok: 0, failed: 2, retries: 1, ms: 4005, models: { fast: 2 },
  });
  assert.equal(snap.providerAttempts.byPhase.council.attempts, 2);

  /* Derived, never counted twice: the ceiling reads `total`, and a rollup that
   * disagreed with it would be a second, wrong number for the same fact. */
  const rolled = Object.values(snap.providerAttempts.byPhase).reduce((n, p) => n + p.attempts, 0);
  assert.equal(rolled, snap.providerAttempts.total);
  assert.equal(snap.providerRequests, 5, 'the ceiling still settles against the exact count');
});

/* An attempt with no phase is still an attempt. Dropping it would make the
 * rollup disagree with the total, which the test above forbids. */
test('an unphased attempt lands under a named bucket rather than vanishing', () => {
  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  t.recordProviderAttempt({ model: 'x', attempt: 1, outcome: 'ok', status: 200, ms: 5 });
  const snap = t.snapshot({});
  assert.equal(snap.providerAttempts.byPhase.unattributed.attempts, 1);
  assert.equal(
    Object.values(snap.providerAttempts.byPhase).reduce((n, p) => n + p.attempts, 0),
    snap.providerAttempts.total,
  );
});

/* NOTHING IN THIS ROW MAY BE USER TEXT. `audit_owner_read` lets a user SELECT
 * their own audit rows, and a provider error message can quote the request it
 * refused. The detail row is an allow-list of scalars for that reason, asserted
 * by exact key set so a future field cannot be added without meeting it. */
test('an attempt detail row carries only non-sensitive scalars', () => {
  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  t.recordProviderAttempt({
    phase: 'synthesis', model: 'head', attempt: 1, outcome: 'ok', status: 200, ms: 10,
    prompt: 'the user question', answer: 'the answer', apiKey: 'sk-secret', message: 'refused: <prompt>',
  });
  const snap = t.snapshot({});
  assert.deepEqual(
    Object.keys(snap.providerAttempts.detail[0]).sort(),
    ['attempt', 'model', 'ms', 'outcome', 'phase', 'provider', 'status', 'streamed'],
  );
});

/* WHY THE HEAD CHANGED, not just that it did. `synthesisModel` records the
 * model that finally answered and `onModelUsed` overwrites, so a turn that fell
 * from head to rung 2 to rung 3 looked identical to one that never fell at all.
 * The reason is CLASSIFIED, never the provider's message: that message can
 * quote the request it refused. */
test('a head fallback records where it went and why, without quoting the provider', () => {
  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  t.recordModelFallback({ phase: 'synthesis', from: 'head', to: 'rung2', reason: 'http_429' });
  t.recordModelFallback({ phase: 'synthesis', from: 'rung2', to: 'rung3', reason: 'deadline' });
  const snap = t.snapshot({});
  assert.equal(snap.modelFallbacks.length, 2);
  assert.deepEqual(snap.modelFallbacks[0], { phase: 'synthesis', from: 'head', to: 'rung2', reason: 'http_429' });
  assert.deepEqual(Object.keys(snap.modelFallbacks[1]).sort(), ['from', 'phase', 'reason', 'to']);
});

/* A turn that never fell back says so with an empty list, not a missing key —
 * the same rule the zero-seat shape follows. */
test('a turn with no fallback carries an empty list, not a missing field', () => {
  const snap = createTurnTelemetry({ now: () => 0, startedAt: 0 }).snapshot({});
  assert.deepEqual(snap.modelFallbacks, []);
});

/* THE ATTEMPT ROW MEASURES THE HANDSHAKE, AND THE HANDSHAKE IS NOT THE PROBLEM.
 *
 * `fetchOpenRouterStream` calls `reportAttempt('ok', status)` at the moment the
 * response is handed off, and clears the timer that bounded opening in the same
 * `finally`. For a STREAMED call that row is time-to-headers and nothing more;
 * the body is then read by `streamOnce` under no bound of its own.
 *
 * MEASURED, production turn 2026-08-19T01:21:03.9Z: `synthesisMs: 37402` for
 * 587 completion tokens — 15.7 tok/s, against 104 tok/s on the same model out
 * of band — from ONE stream, HTTP 200, zero retries, zero fallback rungs, zero
 * 429s. Every one of those 37.4 seconds was body consumption, and an attempt
 * row would have reported a few hundred milliseconds and explained none of it.
 *
 * THE THREE BOUNDARIES ARE NOT INTERCHANGEABLE:
 *   streamOpenMs  request start -> response handed off
 *   streamBodyMs  handoff       -> stream fully consumed or aborted
 *   streamTotalMs request start -> final completion  (open + body)
 * and `msToFirstToken` splits the body again, because a provider that queues
 * for 36s and then generates fast has the same total as one that crawls
 * throughout, and they have opposite fixes.
 *
 * Watched fail before the fix: `streamTimings` undefined. */
test('a streamed generation is timed past the handshake, not just to it', () => {
  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  t.recordStreamTiming({
    phase: 'synthesis', provider: 'openrouter', model: 'head', attempt: 1,
    status: 200, outcome: 'ok',
    streamOpenMs: 412, msToFirstToken: 35980, streamBodyMs: 36990, streamTotalMs: 37402,
    completed: true, aborted: false,
  });
  const snap = t.snapshot({});
  assert.equal(snap.streamTimings.length, 1);
  assert.deepEqual(snap.streamTimings[0], {
    phase: 'synthesis', provider: 'openrouter', model: 'head', attempt: 1,
    status: 200, outcome: 'ok',
    streamOpenMs: 412, msToFirstToken: 35980, streamBodyMs: 36990, streamTotalMs: 37402,
    completed: true, aborted: false, abortReason: null,
  });
  /* The whole point of the row: the body dwarfs the handshake, and until now
   * only the handshake had a number. */
  assert.ok(snap.streamTimings[0].streamBodyMs > snap.streamTimings[0].streamOpenMs * 10);
});

/* The three boundaries must reconcile, or the row is three numbers that cannot
 * all be true. Total is open plus body, by construction and not by coincidence. */
test('open plus body equals total', () => {
  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  t.recordStreamTiming({ model: 'head', streamOpenMs: 412, streamBodyMs: 36990, streamTotalMs: 37402 });
  const [row] = t.snapshot({}).streamTimings;
  assert.equal(row.streamOpenMs + row.streamBodyMs, row.streamTotalMs);
});

/* A stream cut by the turn signal is the case the whole budget question turns
 * on, and it must be distinguishable from one that finished. */
test('a stream aborted by the turn signal says so, and is not marked complete', () => {
  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  t.recordStreamTiming({
    phase: 'synthesis', model: 'head', streamOpenMs: 300, msToFirstToken: 1000,
    streamBodyMs: 74700, streamTotalMs: 75000, completed: false, aborted: true,
  });
  const [row] = t.snapshot({}).streamTimings;
  assert.equal(row.aborted, true);
  assert.equal(row.completed, false);
});

/* A stream that ended having emitted nothing has no first token, and null is
 * the honest value — 0 reads as "it answered instantly", which is the opposite
 * of what happened, and it would drag a percentile down with it. */
test('a stream that emitted no content records a null first-token time', () => {
  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  t.recordStreamTiming({ phase: 'synthesis', model: 'head', streamOpenMs: 300, msToFirstToken: null, streamTotalMs: 5000 });
  assert.equal(t.snapshot({}).streamTimings[0].msToFirstToken, null);
});

/* Same allow-list rule as the attempt rows: `audit_owner_read` makes this bag
 * user-visible, so no answer text, no prompt, no token contents, no key. */
test('a stream timing row carries only non-sensitive scalars', () => {
  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  t.recordStreamTiming({
    phase: 'synthesis', model: 'head', streamOpenMs: 1, msToFirstToken: 2, streamBodyMs: 2, streamTotalMs: 3,
    text: 'the answer', prompt: 'the question', apiKey: 'sk-secret', completion: 'tokens',
  });
  assert.deepEqual(
    Object.keys(t.snapshot({}).streamTimings[0]).sort(),
    ['abortReason', 'aborted', 'attempt', 'completed', 'model', 'msToFirstToken', 'outcome',
      'phase', 'provider', 'status', 'streamBodyMs', 'streamOpenMs', 'streamTotalMs'],
  );
});

test('a turn that streamed nothing carries an empty list, not a missing field', () => {
  assert.deepEqual(createTurnTelemetry({ now: () => 0, startedAt: 0 }).snapshot({}).streamTimings, []);
});

/* A DEADLINE IS NOT A CRASH AND NOT A USER LEAVING, AND THE ROW MUST SAY WHICH.
 *
 * The turn deadline now aborts the body (lib/stream-deadline.js). That abort
 * surfaces as an Error carrying `code: OPENROUTER_DEADLINE` while the TURN
 * signal is untouched — so the naive classification calls it `failed`, which is
 * the one label that would hide the very behaviour the fix introduced. Three
 * outcomes, three different actions: `failed` means look at the provider,
 * `aborted`/client means the user left and nothing is wrong, `aborted`/
 * turn_deadline means the budget is now binding and the model is too slow. */
test('a stream cut by the turn deadline is distinguishable from a crash and from a user leaving', () => {
  const t = createTurnTelemetry({ now: () => 0, startedAt: 0 });
  t.recordStreamTiming({ phase: 'synthesis', model: 'head', outcome: 'aborted', aborted: true, abortReason: 'turn_deadline', streamOpenMs: 400, streamBodyMs: 74600 });
  t.recordStreamTiming({ phase: 'synthesis', model: 'head', outcome: 'aborted', aborted: true, abortReason: 'client', streamOpenMs: 400, streamBodyMs: 1200 });
  t.recordStreamTiming({ phase: 'synthesis', model: 'head', outcome: 'failed', aborted: false, streamOpenMs: 400, streamBodyMs: 30 });
  const rows = t.snapshot({}).streamTimings;
  assert.deepEqual(rows.map((r) => r.abortReason), ['turn_deadline', 'client', null]);
  assert.deepEqual(rows.map((r) => r.outcome), ['aborted', 'aborted', 'failed']);
});
