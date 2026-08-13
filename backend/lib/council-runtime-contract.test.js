const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// server.js exits during import when deployment configuration is absent. Keep
// this contract at the route seam so the request-level wiring is still tested.
const SOURCE = readFileSync(join(__dirname, "..", "server.js"), "utf8");
const ROUTE = SOURCE.slice(SOURCE.indexOf("app.post('/api/council'"), SOURCE.indexOf("// ===== OVERLAY"));
const LOOP = readFileSync(join(__dirname, "agent-loop.js"), "utf8");
// The protocol loop, which lives in `streamOnce` since the orchestrator
// fallback split the retry decision out of it.
const STREAM_MODEL = SOURCE.slice(SOURCE.indexOf("const streamOnce"), SOURCE.indexOf("const callGeminiVision"));

test("council turns write one structured telemetry row through auditLog", () => {
  assert.match(ROUTE, /createTurnTelemetry\(\{ startedAt: t0 \}\)/);
  assert.match(ROUTE, /measureContext\('summary'/);
  assert.match(ROUTE, /measureContext\('feedback'/);
  assert.match(ROUTE, /measureContext\('facts'/);
  /* ONE router read since 2026-08-13, not two. It was `measureRouter('memory')`
   * and `measureRouter('search')`; `planTurn` now returns both decisions from a
   * single model call, which is one OpenRouter request saved on every
   * non-greeting turn. The measurement still has to exist — without it the
   * settlement has no router time to reconcile and the reservation's refund is
   * computed from nothing. */
  assert.match(ROUTE, /measureRouter\('route'/);
  assert.doesNotMatch(
    ROUTE,
    /measureRouter\('(memory|search)'/,
    'the router split back into two calls; that is two requests per turn again',
  );
  assert.match(ROUTE, /onSeatTiming/);
  assert.match(ROUTE, /recordToolRound/);
  assert.match(ROUTE, /recordSynthesis/);
  assert.match(ROUTE, /recordFallback/);
  assert.match(ROUTE, /await auditTelemetry\(/);
  assert.match(ROUTE, /telemetry\.snapshot\(/);
});

test("the council request aborts every long-running layer on disconnect", () => {
  assert.match(ROUTE, /req\.once\('aborted', abortOnDisconnect\)/);
  assert.match(ROUTE, /res\.once\('close', abortOnDisconnect\)/);
  assert.match(ROUTE, /signal: turnSignal/);
  assert.match(LOOP, /registry\.execute\(call, \{ timeoutMs: perCall, signal: turnSignal \}\)/);
  assert.match(ROUTE, /callModel\(model, toolMessages\([\s\S]*?, signal\)/);
  /* `turnSignal` must be the FIFTH argument — that is the whole assertion, and
   * the position is the part that matters, because streamModel takes the signal
   * positionally and a shifted argument would silently pass `undefined` as the
   * signal while still looking like it threads one.
   *
   * The trailing `[,)]` allows a sixth argument (the per-tier token cap) without
   * allowing the signal to move. The original pinned the call's exact arity,
   * which made adding any later parameter look like removing the abort. */
  assert.match(ROUTE, /streamModel\(res, PRIMARY_MODEL, synthMsgs, 0\.0, turnSignal[,)]/);
});

test("the account's daily model cap refuses the turn before anything is spent", () => {
  // OpenRouter's free tier is 50 model requests per UTC day, per ACCOUNT rather
  // than per user. runCouncil turns a rejected seat into a FAILED seat — right
  // for one provider falling over, wrong here, because the cap gives the same
  // certain answer to all seven seats. Unguarded, a capped account dispatches 21
  // doomed requests, waits out the whip on each, and blames the council.
  //
  // The ORDER is the whole assertion: the refusal has to precede the telemetry
  // row and the spend reservation, or the turn pays for an answer that cannot
  // arrive. Checking only that the guard exists would pass with it sitting
  // uselessly at the bottom of the route.
  //
  // ONE EXEMPTION, added 2026-08-13 with the arithmetic fast path: the guard
  // now reads `dailyLimitActive() && !tryArithmetic(...)`. A sum is answered
  // in-process and spends no model request, so refusing it for want of model
  // quota refuses an answer that was already in hand. The ordering assertions
  // below are unchanged and still carry the point of this test; only the shape
  // of the condition moved.
  const guard = ROUTE.indexOf("if (dailyLimitActive()");
  assert.ok(guard !== -1, "the daily-cap guard is missing from the council route");
  assert.match(
    ROUTE.slice(guard, guard + 120),
    /!tryArithmetic/,
    "the daily-cap guard must let a locally-answerable sum through",
  );
  assert.ok(guard < ROUTE.indexOf("createTurnTelemetry("), "the daily-cap guard must precede the telemetry row");
  assert.match(ROUTE, /res\.status\(503\)/);
  assert.match(ROUTE, /Retry-After/);

  // And the latch has to be armed from the adapter's typed error, or the guard
  // is never true and the whole path is dead code.
  assert.match(SOURCE, /err\?\.code === 'OPENROUTER_DAILY_LIMIT'/);
  assert.match(SOURCE, /\.catch\(noteDailyLimit\)/);
});

test("aborted tool results are not cached", () => {
  const toolSearch = SOURCE.slice(SOURCE.indexOf("const toolSearch"), SOURCE.indexOf("// ===== COMPREHENSIVE SEARCH ====="));
  assert.match(toolSearch, /if \(results\.length && !signal\?\.aborted\) setCachedSearch/);
});

test("a provider stream must reach its completion frame before the turn can succeed", () => {
  // The invariant is unchanged by the OpenRouter migration — a turn may not
  // succeed unless the provider SAID it finished — but the frame that carries
  // that signal is completely different, so the guard had to move with it.
  //
  // Ollama sent line-delimited JSON with a `done: true` flag on the last
  // object. OpenRouter sends SSE: `data: {...}` frames, a literal `data:
  // [DONE]` terminator, and `: OPENROUTER PROCESSING` comment lines that are
  // not JSON at all. Parsing that with the old loop yields zero completions and
  // the throw below fires on every turn, so this assertion is what stops the
  // old shape being reintroduced by anyone copying an Ollama example.
  assert.match(STREAM_MODEL, /parseOpenRouterSseLine\(line\)/);
  assert.match(STREAM_MODEL, /if \(frame\.done && !completed\) \{ completed = true;/);
  assert.match(STREAM_MODEL, /if \(!completed\) throw new Error\('Stream ended before provider completion'\)/);
});

test("the completion sentinel is written exactly once", () => {
  // Completion arrives TWICE in SSE — a delta carrying finish_reason, then the
  // [DONE] terminator — where Ollama signalled it once. Without the `!completed`
  // guard the client receives two [DONE] frames and reads the second as a
  // second turn ending. There is no test that would catch that downstream, so
  // it is caught here.
  assert.match(STREAM_MODEL, /if \(frame\.done && !completed\)/);
  // Counts the WRITE, not the string. Counting `data: [DONE]` across the whole
  // source counted the comment above this function describing the terminator
  // too, so the guard failed on prose while the code was correct — a guard that
  // fires on a comment is one the next person deletes rather than reads.
  assert.equal(STREAM_MODEL.match(/res\.write\('data: \[DONE\]/g)?.length, 1);
});

// An abandoned turn used to write nothing at all: every abort path returns
// before the audit write, so the only turns in the telemetry were the ones that
// finished — the population that by definition excludes the slow ones.
test("an abandoned turn still writes its telemetry row, from the finally", () => {
  const tail = ROUTE.slice(ROUTE.lastIndexOf("} finally {"));
  assert.match(tail, /if \(turnSignal\.aborted && !turnAudited && auditUserId\)/);
  assert.match(tail, /telemetry\.snapshot\(/);
  assert.match(tail, /aborted: true/);
});

test("the abandoned-turn write does not block on a client that has already gone", () => {
  const tail = ROUTE.slice(ROUTE.lastIndexOf("} finally {"));
  // Not awaited — the client is gone, so there is nobody left to wait for it —
  // and caught, because an unhandled rejection from a `finally` ends the
  // process under Node's default policy.
  assert.doesNotMatch(tail, /await auditLog\(/);
  assert.match(tail, /\)\.catch\(\(\) => \{\}\);/);
});

// The guard used to sit on `auditTelemetry` alone while five branches called
// `auditLog` directly, so the flag read false on the exact paths that had
// already written. Harmless until the `finally` above started writing too.
test("one turn writes one audit row: every writer routes through the same flag", () => {
  assert.doesNotMatch(ROUTE, /auditLog\(user\.id, 'council'/);
  assert.match(ROUTE, /const auditBranch = async \(metadata\) => \{\s*\n\s*if \(!auditUserId \|\| turnAudited\) return;\s*\n\s*turnAudited = true;/);
  assert.match(ROUTE, /const auditTelemetry = async \([\s\S]{0,80}?if \(!auditUserId \|\| turnAudited\) return;\s*\n\s*turnAudited = true;/);
  for (const category of ["memory", "greeting", "no_results", "search", "wiki"]) {
    assert.match(ROUTE, new RegExp(`auditBranch\\(\\{ category: '${category}'`), category);
  }
});

// A 400 is not an abandoned turn. The `finally` runs for it too, and the
// aborted guard is the only thing keeping it from inventing a row.
test("only an aborted turn writes from the finally", () => {
  const tail = ROUTE.slice(ROUTE.lastIndexOf("} finally {"));
  assert.match(tail, /turnSignal\.aborted &&/);
});

/**
 * THE TWO REQUEST OPTIMISATIONS, 2026-08-13. Both were Sol's, both ranked as
 * safe wins, and both are about REQUESTS rather than latency — the account gets
 * a fixed number per UTC day, shared across every user, and two of every turn's
 * requests were the router's own before a seat was asked anything.
 *
 * Per tier, after both:
 *
 *   simple   1 router + 1 seat  + 0 synthesis = 2   (was 4)
 *   moderate 1 router + 3 seats + 1 synthesis = 5   (was 6)
 *   complex  1 router + 7 seats + 1 synthesis = 9   (was 10)
 *
 * These are source-shape assertions because server.js cannot be required in a
 * test — see AGENTS.md. They cannot prove the counts; they prove the two
 * structural facts the counts depend on, and each one is a fact that would
 * otherwise be silently undone by a refactor.
 */
test("one seat means no synthesis, and it is decided before synthesis runs", () => {
  const solo = ROUTE.indexOf("const soleDraft");
  const synth = ROUTE.indexOf("// 6. SYNTHESIS");
  assert.ok(solo > 0, "the one-seat branch is gone; the simple tier pays for a synthesis of one draft again");
  assert.ok(synth > 0, "the synthesis step moved; this test needs updating");
  assert.ok(solo < synth, "the one-seat branch must be decided before synthesis, or it saves nothing");

  /* THE FOUR GUARDS. Each is a way this could ship a worse answer than the
   * synthesis it replaces, so each is named rather than counted. */
  const branch = ROUTE.slice(solo, synth);
  assert.match(branch, /selection\.members\.length === 1/,
    "the ROSTER must be one seat — three seats of which two skipped is a council that disagreed");
  assert.match(branch, /validResponses\.length === 1/);
  assert.match(branch, /soleDraft &&/, "an empty draft must not stream as a blank answer");
  assert.match(branch, /!toolResearch/,
    "a tools turn must synthesise: the truncation block that tells the writer to hedge is appended to the SYNTHESIS prompt");
  assert.match(branch, /!toolTruncated/);
});

test("a one-seat roster inherits the synthesiser's rules", () => {
  /* The seat's draft IS the answer on that path, and the length rule, the
   * closing rule and the inference rule live in the synthesis prompt. Without
   * this the simple tier would silently lose all three — an answer that trails
   * off into "let me know if you need anything else" and states an inference as
   * a fact. It costs no request: it is text in a prompt already being sent. */
  const solo = ROUTE.indexOf("const soloRules");
  assert.ok(solo > 0, "soloRules is gone; a single seat now writes the final answer without the synthesiser's rules");
  const rules = ROUTE.slice(solo, solo + 900);
  assert.match(rules, /selection\.members\.length === 1/, "soloRules must apply ONLY to a one-seat roster");
  assert.match(rules, /LENGTH_RULE\[selection\.complexity\]/);
  assert.match(rules, /inferring rather than reporting/i);
  assert.match(ROUTE, /\$\{soloRules\}/, "soloRules is computed but never reaches the prompt");
});

/**
 * THE ORCHESTRATOR'S FALLBACK. A throw at the streaming step is the most
 * expensive failure in the route: the council has already deliberated and the
 * requests are already spent. The strongest seat writes the answer instead.
 *
 * Every assertion here is a refusal, because the danger is the fallback firing
 * when it should not — a second attempt appended to half an answer reads as one
 * reply that changes its mind mid-sentence.
 */
test("the orchestrator falls back to the strongest seat, and refuses three ways", () => {
  const wrapper = SOURCE.slice(SOURCE.indexOf("const streamModel = async"), SOURCE.indexOf("const callGeminiVision"));
  assert.ok(wrapper, "streamModel is gone; the orchestrator fallback has no home");
  assert.match(wrapper, /streamOnce\(res, SMART_MODEL/, "nothing ever retries with the strong model");
  assert.match(wrapper, /modelName !== PRIMARY_MODEL/,
    "a caller that named a model must get that model, and SMART_MODEL must not retry itself");
  assert.match(wrapper, /signal\?\.aborted/, "a cancelled turn must not be re-dispatched");
  assert.match(wrapper, /wrote > 0/, "a partial answer must never be retried into a second, different one");

  // And the strong model must not have quietly become the default.
  assert.match(SOURCE, /const PRIMARY_MODEL = 'google\/gemma-4-26b-a4b-it:free'/,
    "PRIMARY_MODEL changed; the fallback model is ~10x slower and must not become the default orchestrator");
});
