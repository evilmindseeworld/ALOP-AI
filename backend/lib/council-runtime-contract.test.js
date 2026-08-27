const { deadlineSignal } = require('./stream-deadline');
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// server.js exits during import when deployment configuration is absent. Keep
// this contract at the route seam so the request-level wiring is still tested.
const SOURCE = readFileSync(join(__dirname, "..", "server.js"), "utf8");
const ROUTE = SOURCE.slice(SOURCE.indexOf("app.post('/api/council'"), SOURCE.indexOf("// ===== OVERLAY"));
const LOOP = readFileSync(join(__dirname, "agent-loop.js"), "utf8");
// Half the stream-setup contract now lives here: opening the stream moved into
// the helper so a pre-body 429 could be retried where it is cheap.
const OPENROUTER = readFileSync(join(__dirname, "openrouter.js"), "utf8");
const { fetchOpenRouterStream } = require("./openrouter");
// The protocol loop, which lives in `streamOnce` since the orchestrator
// fallback split the retry decision out of it.
const STREAM_MODEL = SOURCE.slice(SOURCE.indexOf("const streamOnce"), SOURCE.indexOf("const callGeminiVision"));

test("a seeded search reaches the tool loop instead of the Wikipedia shortcut", () => {
  const searchGate = ROUTE.indexOf("if (searchQueries && !SEEDED_SEARCH)");
  const wikiGate = ROUTE.indexOf("if (shouldCheckWiki && !(SEEDED_SEARCH && searchQueries?.length))");
  const loop = ROUTE.indexOf("runAgentLoop({");
  assert.ok(searchGate > 0 && wikiGate > searchGate && loop > wikiGate, "search, Wikipedia, and loop order changed");
});

test("only router-approved current-info turns enter the tool loop", () => {
  const gate = ROUTE.indexOf("if (TOOLS_ENABLED && SEEDED_SEARCH && searchQueries?.length && !imageContext)");
  const loop = ROUTE.indexOf("runAgentLoop({", gate);
  const plainCouncil = ROUTE.indexOf("} else {", loop);
  const catalogue = ROUTE.indexOf("toolMessages(councilMsgs", gate);

  assert.ok(gate > 0, "the tool loop must require a router-produced search query");
  assert.ok(loop > gate && catalogue > gate, "current-info turns must retain the seeded tool path");
  assert.ok(plainCouncil > loop, "no-search turns must retain the direct plain-council branch");
  assert.doesNotMatch(
    ROUTE.slice(plainCouncil, ROUTE.indexOf("// 5. FALLBACK", plainCouncil)),
    /toolMessages\(/,
    "the plain council must not receive the tool catalogue",
  );
});

test("council turns write one structured telemetry row through auditLog", () => {
  assert.match(ROUTE, /createTurnTelemetry\(\{ startedAt: t0, context: turnContext \}\)/);
  /* The two ids are minted BEFORE the telemetry that carries them, or the row
   * is written without the handles that make it findable. */
  assert.match(ROUTE, /const turnContext = createTurnContext\(\{/);
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
  assert.match(ROUTE, /meteredCallModel\(\s*model,\s*toolMessages\([\s\S]*?signal,/);
  /* `turnSignal` must be the FIFTH argument — that is the whole assertion, and
   * the position is the part that matters, because streamModel takes the signal
   * positionally and a shifted argument would silently pass `undefined` as the
   * signal while still looking like it threads one.
   *
   * The trailing `[,)]` allows a sixth argument (the per-tier token cap) without
   * allowing the signal to move. The original pinned the call's exact arity,
   * which made adding any later parameter look like removing the abort. */
  assert.match(ROUTE, /streamModel\(res, synthesis\.model, synthMsgs, 0\.0, turnSignal[,)]/);
});

test('the head model owns complex/tool synthesis and its production identity is logged', () => {
  assert.match(SOURCE, /COUNCIL_SYNTHESIS_MODEL/);
  assert.match(SOURCE, /DEFAULT_SYNTHESIS_MODEL/);
  /* The route calls `planSynthesis`, which is the ONE place the head decision
   * is made: `chooseSynthesis` for head-vs-fast, `chooseEmphasis` for what the
   * turn is judged on, `chooseHead` for the order. Three branches used to build
   * this by hand, which is three chances for two of them to differ. */
  assert.match(SOURCE, /function planSynthesis\(/);
  assert.match(SOURCE, /chooseSynthesis\(/);
  assert.doesNotMatch(ROUTE, /chooseSynthesis\(/, 'a branch is building the head decision by hand again');
  for (const branch of ['searchSynthesis', 'wikiSynthesis', 'synthesis']) {
    assert.ok(ROUTE.includes(`const ${branch} = planSynthesis({`), `${branch} bypasses planSynthesis`);
  }
  assert.match(ROUTE, /toolQuestion/);
  assert.match(ROUTE, /\[SYNTHESIS\].*model=\$\{/);
  assert.match(ROUTE, /synthesisModel: synthesisModelUsed/);
  /* The effort is read from the model now, not written here as a literal:
   * `high` was established for Luna and the default head is free. `exclude` is
   * still absolute — a chain of thought must never reach the socket. */
  assert.match(SOURCE, /reasoning: \{ effort: head\.effort, exclude: true \}/);
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
  assert.match(ROUTE, /fail\(res, 503,/);
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
  for (const category of ["memory", "greeting", "no_results", "wiki"]) {
    assert.match(ROUTE, new RegExp(`auditBranch\\(\\{[\\s\\S]{0,180}?category: '${category}'`), category);
  }
  assert.match(ROUTE, /auditTelemetry\('council\.search', 'search'/, 'search');
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

test("every seat-answer boundary rejects whole protocol replies before use", () => {
  /* Proximity rather than one exact line: answerOptions grew an `onUsage` sink
   * when token accounting arrived, and a literal match on the old single-line
   * form failed on a change that altered nothing this test is about. */
  assert.match(ROUTE, /const answerOptions = \{[\s\S]{0,240}?allowProtocolJson: userRequestedProtocolJson\(truncatedPrompt\)/);
  assert.match(ROUTE, /const parsed = parseToolRequests\(reply, answerOptions\)/,
    "the tool loop must reject protocol blobs before they count toward quorum");
  /* `sanitizeAnswerText(reply.content, ...)` since the seat call became
   * structured — the text is the same string the default contract returned,
   * and the reply now also carries the `textSource` label that the synthesis
   * recovery and the solo branch judge a draft on. NOT `String(reply)`, which
   * is "[object Object]" and always truthy. */
  assert.match(ROUTE, /sanitizeAnswerText\(reply\.content, answerOptions\)\.text/,
    "the plain fallback council must reject protocol blobs before quorum");
  assert.match(ROUTE, /[cC]allModel[\s\S]{0,200}?answerOptions\)\.text/,
    "the plain council must reject protocol blobs before quorum");
  assert.match(ROUTE, /const searchAnswer = await streamModel\([^\n]+answerOptions/,
    "the observed search answer path must use the stream guard");
  assert.match(ROUTE, /const wikiAnswer = await streamModel\([^\n]+answerOptions/);
  /* Not `const synthAnswer = …`: the call is wrapped in a try so a synthesiser
   * that writes nothing can degrade to a council draft (lib/synthesis-degrade.js),
   * which moved the declaration a line up. What this test is about — that the
   * synthesis stream is sanitised through answerOptions — is unchanged. */
  assert.match(ROUTE, /synthAnswer = await streamModel\([^\n]+answerOptions/);
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

test('a one-seat draft must pass the general answer contract before it bypasses synthesis', () => {
  const solo = ROUTE.indexOf('const soleDraft');
  const synth = ROUTE.indexOf('// 6. SYNTHESIS', solo);
  assert.ok(solo > 0 && synth > solo, 'one-seat branch not found');
  const branch = ROUTE.slice(solo, synth);
  assert.match(branch, /assessAnswer\(/,
    'a non-empty draft is not enough to become a clean final answer');
  assert.match(branch, /answerContract/,
    'the direct path must inspect the question/context contract');
  assert.match(branch, /finishReason/,
    'provider truncation metadata must be available at the direct-answer boundary');
  assert.match(branch, /soloAssessment\??\.ok/,
    'the direct path must bypass synthesis only after the answer contract passes');
});

test('synthesis receives bounded context and a general completeness contract', () => {
  const synth = ROUTE.indexOf('// 6. SYNTHESIS');
  const call = ROUTE.slice(synth, synth + 7000);
  assert.match(call, /COMPLETENESS_CONTRACT/);
  assert.match(call, /\.\.\.contextMsgs/,
    'the head cannot recover omitted context if only seat drafts are sent');
  assert.match(call, /\.\.\.promptHistory/,
    'the head must receive the same bounded transcript the seats saw');
  assert.match(call, /every explicit part/i);
});

/**
 * THE ORCHESTRATOR'S FALLBACK. A throw at the streaming step is the most
 * expensive failure in the route: the council has already deliberated and the
 * requests are already spent. The caller-selected recovery model writes the
 * answer instead.
 *
 * Every assertion here is a refusal, because the danger is the fallback firing
 * when it should not — a second attempt appended to half an answer reads as one
 * reply that changes its mind mid-sentence.
 */
test("the orchestrator falls back to its configured recovery model, and refuses three ways", () => {
  const wrapper = SOURCE.slice(SOURCE.indexOf("const streamModel = async"), SOURCE.indexOf("const callGeminiVision"));
  assert.ok(wrapper, "streamModel is gone; the orchestrator fallback has no home");
  assert.match(wrapper, /for \(const entry of fallbackChain\)/, "a fallback must be dispatched when the selected model fails before output");
  assert.match(wrapper, /streamOnce\(\s*res,\s*entry\.model/, "the fallback attempt must stream from the rung it selected");
  assert.match(wrapper, /entry\.model !== modelName/,
    "the ladder must not retry the model that just failed as its own fallback");
  assert.match(wrapper, /!fallbackModel/,
    "with no fallback named and none on the ladder, the failure must escape rather than be retried blindly");
  assert.match(wrapper, /signal\?\.aborted/, "a cancelled turn must not be re-dispatched");
  assert.match(wrapper, /wrote > 0/, "a partial answer must never be retried into a second, different one");

  // And the strong model must not have quietly become the default.
  assert.match(SOURCE, /const PRIMARY_MODEL = 'google\/gemma-4-26b-a4b-it:free'/,
    "PRIMARY_MODEL changed; the fallback model is ~10x slower and must not become the default orchestrator");
});

test("stream setup failures preserve the upstream cause in one bounded log line", () => {
  const setup = SOURCE.slice(SOURCE.indexOf("const streamOnce = async"), SOURCE.indexOf("const reader = response.body.getReader()"));

  assert.match(setup, /fetchOpenRouterStream\(/, "the open must go through the helper that retries a pre-body 429");
  assert.match(OPENROUTER, /error\.status = response\.status/, "an HTTP failure must report its status");
  assert.match(OPENROUTER, /await response\.text\(\)/, "an HTTP failure must retain OpenRouter's error detail");
  assert.match(OPENROUTER, /replace\(\/\\s\+\/g/, "upstream detail must be collapsed onto one log line");
  assert.match(OPENROUTER, /slice\(0,\s*300\)/, "upstream detail must be bounded before it reaches logs");
  assert.match(setup, /missing stream body/i, "an HTTP-success response without a body must be distinguishable from a non-2xx response");
});

test("account-wide per-minute stream limits wait for reset and retry the same model only", () => {
  const setup = SOURCE.slice(SOURCE.indexOf("const streamOnce = async"), SOURCE.indexOf("const reader = response.body.getReader()"));
  const wrapper = SOURCE.slice(SOURCE.indexOf("const streamModel = async"), SOURCE.indexOf("const callGeminiVision"));

  assert.match(OPENROUTER, /limit_source/, "the 429 policy must read OpenRouter's structured limit source");
  assert.match(OPENROUTER, /X-RateLimit-Reset/i, "the 429 policy must read the reset from body metadata or response headers");
  assert.match(OPENROUTER, /X-RateLimit-(?:Limit-)?Source/i, "a response-header limit source must be accepted too");
  assert.match(setup, /normaliseResetEpoch\(err\.resetAt\)/,
    "the helper reports the reset in the unit the wire used; the consumer that reads it as milliseconds must normalise it");
  assert.match(SOURCE, /epoch \* 1_000/, "second epochs must be normalised rather than mistaken for millisecond epochs");
  assert.match(wrapper, /openrouter_free_tier_per_minute/, "the account-wide minute limit must be distinguished from provider and daily limits");
  assert.match(wrapper, /await abortableDelay\(/, "the reset wait must be abortable");
  assert.match(wrapper, /streamOnce\(res, modelName/, "the post-reset attempt must retry the same model");
  assert.doesNotMatch(wrapper, /streamOnce\(res, modelName[\s\S]+streamOnce\(res, SMART_MODEL[\s\S]+streamOnce\(res, SMART_MODEL/,
    "a same-model retry must never be followed by a third fallback request");
});

test("an account-minute reset outside the turn deadline makes no second request", () => {
  const wrapper = SOURCE.slice(SOURCE.indexOf("const streamModel = async"), SOURCE.indexOf("const callGeminiVision"));

  assert.match(wrapper, /resetAt\s*>\s*turnDeadlineAt|resetAt\s*>=\s*turnDeadlineAt/,
    "the deadline check must happen before either retry or fallback dispatches");
  assert.match(wrapper, /throw err;[\s\S]*await abortableDelay/,
    "a reset that cannot fit must throw before starting the timer or making another request");
});

const loadStreamPolicy = (fetchImpl) => {
  const policy = SOURCE.slice(SOURCE.indexOf("const normaliseResetEpoch"), SOURCE.indexOf("const callGeminiVision"));
  /* The REAL helper, driven by the harness's fake fetch. A stub would test the
   * harness: the policy deciding whether a second request happens at all now
   * lives inside the helper, and every assertion below counts requests. */
  const stream = async (...args) => {
    const realFetch = global.fetch;
    global.fetch = fetchImpl;
    try { return await fetchOpenRouterStream(...args); }
    finally { global.fetch = realFetch; }
  };
  return Function(
    "fetch", "fetchOpenRouterStream", "OPENROUTER_HOST", "OPENROUTER_API_KEY", "PRIMARY_MODEL", "SMART_MODEL",
    "parseOpenRouterSseLine", "looksLikeProtocolOpening", "sanitizeAnswerText",
    /* Declared above the slice, read inside it. Injected rather than widening
     * the slice: the parameter list is the honest statement of what this policy
     * depends on from the rest of server.js, and `false` is the shipped default. */
    "STREAM_USAGE_ACCOUNTING",
    /* The turn deadline is now enforced for the whole stream rather than only
     * its handshake, so the policy depends on the real composer. Injected, not
     * stubbed: a stub here would let the deadline stop reaching the body again
     * without a single test noticing. See lib/stream-deadline.js. */
    "deadlineSignal",
    `${policy}\nreturn { streamModel, normaliseResetEpoch };`,
  )(
    fetchImpl, stream, "https://openrouter.test", "secret", "primary:free", "smart:free",
    () => ({ skip: true }), () => false, (text) => ({ text, rejected: false }),
    false,
    deadlineSignal,
  );
};

const minute429 = (reset) => ({
  ok: false,
  status: 429,
  statusText: "Too Many Requests",
  headers: { get: () => null },
  text: async () => JSON.stringify({
    error: {
      message: "Rate limit exceeded: free-models-per-min.",
      metadata: {
        limit_source: "openrouter_free_tier_per_minute",
        headers: { "X-RateLimit-Reset": String(reset) },
      },
    },
  }),
});

test("a reset beyond the deadline performs exactly one fetch", async () => {
  let requests = 0;
  const { streamModel } = loadStreamPolicy(async () => { requests++; return minute429(Date.now() + 10_000); });

  await assert.rejects(streamModel({}, "primary:free", [], 0, undefined, null, {}, Date.now() + 100), /Stream HTTP 429/);
  assert.equal(requests, 1, "a wait that cannot fit must not dispatch a retry or fallback");
});

test("a fitting reset retries the same model once and never falls back afterward", async () => {
  const requestedModels = [];
  const { streamModel, normaliseResetEpoch } = loadStreamPolicy(async (_url, options) => {
    requestedModels.push(JSON.parse(options.body).model);
    return minute429(Date.now());
  });

  assert.equal(normaliseResetEpoch(1_786_650_480_000), 1_786_650_480_000, "the observed reset is already milliseconds");
  assert.equal(normaliseResetEpoch(1_786_650_480), 1_786_650_480_000, "a seconds header is converted to milliseconds");
  await assert.rejects(streamModel({}, "primary:free", [], 0, undefined, null, {}, Date.now() + 5_000), /Stream HTTP 429/);
  assert.deepEqual(requestedModels, ["primary:free", "primary:free"], "the second failure must escape without a third smart-model request");
});

test("aborting during the reset wait cancels the timer without another fetch", async () => {
  let requests = 0;
  const controller = new AbortController();
  const { streamModel } = loadStreamPolicy(async () => { requests++; return minute429(Date.now() + 1_000); });
  const pending = streamModel({}, "primary:free", [], 0, controller.signal, null, {}, Date.now() + 5_000);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new DOMException("Client disconnected", "AbortError"));

  await assert.rejects(pending, (err) => err?.name === "AbortError");
  assert.equal(requests, 1, "an abandoned turn must not remain waiting or dispatch the retry");
});

test("every cached answer's shelf life is decided by the router's search flag", () => {
  // Four write sites, one rule. The council branch is the trap: with seeded
  // tools on it is reached WITH a search decision in hand and searches from
  // inside the agent loop, so keying the TTL on the branch name would have kept
  // a tool-loop answer about a price for ninety days.
  const writes = [...ROUTE.matchAll(/cacheAnswer\((?!text)[^\n]*\)/g)].map((m) => m[0]);
  assert.ok(writes.length >= 4, `expected the four cache writes, found ${writes.length}`);
  for (const write of writes) {
    assert.match(write, /\{ searched:/, `a cache write did not declare its provenance: ${write}`);
    assert.doesNotMatch(write, /ttlFor\(/,
      `a call site computed its own shelf life: ${write} — that is what cacheAnswer exists to prevent`);
  }
  /* The row carries the inputs a refresh needs to re-ask the question, and they
   * must be the same values the KEY was built from. Two lists that have to stay
   * identical eventually do not, so there is one list: the write closure derives
   * both from the same locals. */
  const closure = ROUTE.slice(ROUTE.indexOf('const cacheAnswer ='), ROUTE.indexOf('const cacheAnswer =') + 900);
  assert.match(closure, /ttlFor\(\{ searched, fresh \}\)/, 'the single write site must set the shelf life');
  for (const field of ['question:', 'lang', 'country:', 'plan:', 'detailed:', 'branch:', 'usedLiveWeb:']) {
    assert.ok(closure.includes(field), `the cached row cannot be refreshed without ${field}`);
  }
  assert.match(ROUTE, /const usedLiveWeb = Boolean\(searchQueries\?\.length\)/,
    "the council branch must read the router's decision, not its own branch name");
});

test("the direct search path asks the full selected council before synthesis", () => {
  const direct = SOURCE.indexOf('if (searchQueries && !SEEDED_SEARCH)');
  const end = SOURCE.indexOf('// 3. WIKIPEDIA', direct);
  assert.ok(direct > 0 && end > direct, 'direct search branch not found');
  const branch = SOURCE.slice(direct, end);
  assert.match(branch, /runCouncilWithWhip\([\s\S]*selection\.members/);
  assert.match(branch, /searchSynthMsgs/);
  assert.match(branch, /streamModel\(res, searchSynthesis\.model, searchSynthMsgs/);
  assert.match(branch, /telemetry\.recordSynthesis\(Date\.now\(\) - searchSynthesisStartedAt, searchSynthesisModelUsed\)/);
  assert.match(branch, /auditTelemetry\('council\.search', 'search'/);
});

test("the Wikipedia tool path also uses the configurable head synthesizer", () => {
  const wiki = SOURCE.indexOf("if (shouldCheckWiki && !(SEEDED_SEARCH && searchQueries?.length))");
  const end = SOURCE.indexOf('// 4. COUNCIL', wiki);
  assert.ok(wiki > 0 && end > wiki, 'Wikipedia branch not found');
  const branch = SOURCE.slice(wiki, end);
  assert.match(branch, /toolQuestion: true/);
  assert.match(branch, /streamModel\(res, wikiSynthesis\.model, wikiMsgs/);
  assert.match(branch, /telemetry\.recordSynthesis\(Date\.now\(\) - wikiSynthesisStartedAt, wikiSynthesisModelUsed\)/);
  assert.match(branch, /synthesisModel: wikiSynthesisModelUsed/);
});

test("the background brain is wired to the same cache identity and stopped on shutdown", () => {
  /* The branch carries the build fingerprint after the execution mode now (see
   * the semantic-tier tests in answer-cache.test.js), so this matches the mode
   * being interpolated rather than the whole literal. The property under test
   * is unchanged: ONE branch constant, shared by request turns and the brain. */
  assert.match(SOURCE, /const ANSWER_CACHE_BRANCH = `turn:\$\{ANSWER_EXECUTION_MODE\}/,
    "request turns and background turns need one shared execution-mode identity");
  assert.match(SOURCE, /createBrainQuestions\(\{ branch: ANSWER_CACHE_BRANCH \}\)/,
    "curated questions must use the exact branch used by foreground cache keys");
  assert.match(SOURCE, /refreshBranch: ANSWER_CACHE_BRANCH/,
    "refresh selection must exclude durable rows written under an old execution mode");
  assert.match(SOURCE, /const brain = createBrain\(\{[\s\S]*cache: answerCache,[\s\S]*runQuestion/,
    "the scheduler must be instantiated against the production cache and council seam");
  assert.match(SOURCE, /const stopBrain = brain\.start\(\)/,
    "COUNCIL_BRAIN=1 must start the scheduler rather than only documenting it");
  assert.match(SOURCE, /const shutdown = \(\) => \{[\s\S]*stopBrain\(\);[\s\S]*server\.close/,
    "shutdown must stop background timers and abort active brain work before closing the server");
  assert.match(SOURCE, /signal\?\.addEventListener\('abort', abort/,
    "a stopped brain must cancel the real council turn it started");
});
