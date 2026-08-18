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
