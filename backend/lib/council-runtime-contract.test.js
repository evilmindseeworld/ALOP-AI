const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// server.js exits during import when deployment configuration is absent. Keep
// this contract at the route seam so the request-level wiring is still tested.
const SOURCE = readFileSync(join(__dirname, "..", "server.js"), "utf8");
const ROUTE = SOURCE.slice(SOURCE.indexOf("app.post('/api/council'"), SOURCE.indexOf("// ===== OVERLAY"));
const LOOP = readFileSync(join(__dirname, "agent-loop.js"), "utf8");
const STREAM_MODEL = SOURCE.slice(SOURCE.indexOf("const streamModel"), SOURCE.indexOf("const callGeminiVision"));

test("council turns write one structured telemetry row through auditLog", () => {
  assert.match(ROUTE, /createTurnTelemetry\(\{ startedAt: t0 \}\)/);
  assert.match(ROUTE, /measureContext\('summary'/);
  assert.match(ROUTE, /measureContext\('feedback'/);
  assert.match(ROUTE, /measureContext\('facts'/);
  assert.match(ROUTE, /measureRouter\('memory'/);
  assert.match(ROUTE, /measureRouter\('search'/);
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
  assert.match(ROUTE, /streamModel\(res, PRIMARY_MODEL, synthMsgs, 0\.0, turnSignal\)/);
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
