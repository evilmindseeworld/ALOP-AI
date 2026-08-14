'use strict';

/**
 * The seat is proved by `native-tool-seat.test.js`. This file proves it is
 * WIRED — the half that regresses silently, because a state machine nothing
 * calls passes all of its own tests forever.
 *
 * server.js calls `process.exit(1)` at import time on a missing env var, so it
 * cannot be required here. It is read as text and asserted on proximity rather
 * than exact escaped strings; see AGENTS.md.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SERVER = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
const ROUTE = SERVER.slice(SERVER.indexOf("app.post('/api/council'"));

test('the seat is configurable and defaults to the model that was measured', () => {
  assert.match(SERVER, /COUNCIL_TOOL_SEAT_MODEL \|\| 'openai\/gpt-5\.6-luna'/);
  assert.match(SERVER, /COUNCIL_TOOL_SEAT_EFFORT \|\| 'high'/);
  assert.match(SERVER, /const TOOL_SEAT_ENABLED = /, 'it must be possible to turn the seat off entirely');
});

test('THE SEAT IS NOT IN THE COUNCIL ROSTER, and must not be', () => {
  // Every seat in COUNCIL is a `:free` id eligible for temperature-band
  // narrowing. This one is metered and is added by policy. Putting it in the
  // array would make it a substitute for a free seat on turns that never asked
  // for it — a metered request on a lookup.
  const roster = SERVER.slice(SERVER.indexOf('const COUNCIL = ['), SERVER.indexOf('const FREE_COUNCIL'));
  const arrayLiteral = roster.slice(0, roster.indexOf('];'));
  assert.equal(/gpt-5\.6-luna/.test(arrayLiteral), false);
});

test('the plan gate is applied by the caller, not inside the router', () => {
  // Same rule narrowRoster and escalateForResearch both carry a warning about,
  // and it matters more here: this seat is metered, so a leak is somebody
  // else's bill rather than somebody else's latency.
  assert.match(ROUTE, /const toolSeat = TOOL_SEAT && \(userPlan === 'pro' \|\| TOOL_SEAT_FREE_PLAN\) \? TOOL_SEAT : null/);
});

test('both halves of the policy are applied, and in the order that survives', () => {
  const complexityCall = ROUTE.indexOf('selection = withToolSeat(selection, toolSeat);');
  const escalate = ROUTE.indexOf('escalateForResearch(selection, planRoster)');
  const searchCall = ROUTE.indexOf("withToolSeat(selection, toolSeat, { needsTools: true })");

  assert.ok(complexityCall > 0, 'the complexity half is missing');
  assert.ok(searchCall > 0, 'the search half is missing');
  assert.ok(complexityCall < escalate, 'complexity must be decided before the reservation, which sits between them');
  assert.ok(escalate < searchCall,
    'escalateForResearch rebuilds members from planRoster, which the tool seat is not part of — adding it first drops it again');
});

test('the reservation covers the metered seat before anything is spent', () => {
  assert.match(ROUTE, /const mayAddToolSeat = Boolean\(toolSeat\) && mayEscalate/);
  assert.match(ROUTE, /reservationCents\(maxSeats, 12, 4, toolSeatCount\)/);
  assert.ok(
    ROUTE.indexOf('const toolSeatCount') < ROUTE.indexOf('reservationCents('),
    'the count has to exist before the reservation reads it',
  );
});

test('the native seat is created ONCE per turn, outside askMember', () => {
  // It is state: the assistant turn carrying tool_calls and the tool messages
  // answering them accumulate across rounds. A fresh object per round sends the
  // model a first round every time — it re-requests the same tool forever and
  // never sees a result.
  const loopStart = ROUTE.indexOf('const loop = await runAgentLoop(');
  const create = ROUTE.indexOf('createNativeToolSeat(');
  const ask = ROUTE.indexOf('askMember: async (model, ctx, signal)');
  assert.ok(create > 0 && loopStart > 0 && ask > 0);
  assert.ok(create < loopStart, 'created before the loop, not inside a per-round callback');
  assert.ok(create < ask);
});

test('the native seat gets the native prompt and every other seat does not', () => {
  assert.match(ROUTE, /if \(nativeSeat && model === nativeSeat\.model\)/);
  assert.match(ROUTE, /toolMessages\(councilMsgs, registry, \{ \.\.\.ctx, attachedFiles: attached, native: true \}\)/);
  // The ordinary seats keep the byte-identical prompt they have always had.
  assert.match(ROUTE, /toolMessages\(councilMsgs, registry, \{ \.\.\.ctx, attachedFiles: attached \}\)/);
});

test('call provenance is logged and counted', () => {
  // A native seat quietly degrading to the text fence produces identical
  // answers, identical timings and identical costs. This word is the only
  // difference, so it is the only way adoption can be measured.
  assert.match(ROUTE, /const via = e\.seeded \? 'seeded' : \(e\.sources \|\| \[\]\)\.join\('\+'\) \|\| 'fence'/);
  assert.match(ROUTE, /toolCallsBySource\[via\] = \(toolCallsBySource\[via\] \|\| 0\) \+ 1/);
  assert.match(ROUTE, /call sources:/);
  assert.match(ROUTE, /nativeToolSeat: \{ model: nativeSeat\.model/);
});

test('provenance is kept OUT of the client stream', () => {
  // The seat progress events deliberately never name models to the client;
  // which protocol a seat spoke is the same class of detail.
  assert.match(ROUTE, /const \{ sources, \.\.\.clientEvent \} = e;/);
  assert.match(ROUTE, /sendEvent\(res, clientEvent\)/);
});

test('the seeded search and the text fence are still there', () => {
  // The native path is an addition, not a replacement. Every other seat still
  // speaks the fence protocol, and the server-side seeded search is untouched.
  assert.match(ROUTE, /seededSearch: searchQueries\[0\]/);
  assert.match(SERVER, /parseToolRequests/);
});
