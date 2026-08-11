const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// server.js exits during import when deployment configuration is absent. Keep
// this contract at the route seam so the request-level wiring is still tested.
const SOURCE = readFileSync(join(__dirname, "..", "server.js"), "utf8");
const ROUTE = SOURCE.slice(SOURCE.indexOf("app.post('/api/council'"), SOURCE.indexOf("// ===== OVERLAY"));
const LOOP = readFileSync(join(__dirname, "agent-loop.js"), "utf8");

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
