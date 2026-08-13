'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * WHERE THE STREAM OPENS IS A LATENCY CONTRACT, AND NOTHING ELSE SEES IT.
 *
 * Measured against production on 2026-08-13 ("Name one colour of the sky"):
 * headers at 5244ms, first stage frame at 5245ms, answer at 6591ms. The stage
 * events were correct, tested, and shipped — and every one of them was written
 * after five seconds of silence, because `openStream` sat below the context
 * reads. The feature existed and the user could not see it.
 *
 * A unit test on `sendStage` passes either way; it is handed an open response.
 * The defect is the ORDER of two statements in `server.js`, so this asserts the
 * order, in the source, by position — the same seam `middleware-order.test.js`
 * and `arithmetic.test.js` use, and for the same reason: `server.js` calls
 * `process.exit(1)` at import when env vars are missing, so it cannot be
 * required in a test.
 */
const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

const at = (needle) => {
  const i = SOURCE.indexOf(needle);
  assert.notEqual(i, -1, `anchor vanished from server.js: ${needle}`);
  return i;
};

test('the council stream opens BEFORE the Supabase context reads', () => {
  const open = at("sendStage(res, 'context', 'Reading your conversation')");
  const contextReads = at('const contextReads = Promise.all([');
  assert.ok(
    open < contextReads,
    'openStream must run before the summary/feedback/facts reads, or the user waits in silence for all three',
  );
});

test('the early open is gated on there being no image, so the vision 502s stay reachable', () => {
  // An image turn keeps two real HTTP refusals ("couldn't analyse the attached
  // image"). Opening the stream above them would make both unsendable and the
  // client would render a blank answer instead of the error.
  const gate = SOURCE.indexOf("if (!image) {\n      openStream(res);");
  assert.notEqual(gate, -1, 'the early openStream must stay gated on `!image`');
  const vision502 = at("Couldn't analyse the attached image");
  assert.ok(gate < vision502, 'expected the gate above the vision failure branch');
});

test('every refusal that answers with an HTTP status still sits ABOVE the early open', () => {
  // The 402 ceilings and the 400/503 image checks cannot be sent once headers
  // are out. If someone adds a new `res.status(...).json(...)` below the open
  // on the text path, it silently becomes a no-op — this is the check that
  // makes that a red test instead of a support ticket.
  const open = at("if (!image) {\n      openStream(res);");
  const councilStart = at("app.post('/api/council'");
  const councilEnd = SOURCE.indexOf("app.post('/api/overlay'");
  const body = SOURCE.slice(open, councilEnd);
  assert.ok(councilStart < open && councilEnd > open, 'anchors must bracket the council route');

  const offenders = [...body.matchAll(/res\.status\((\d{3})\)\.json/g)]
    .map((m) => ({ code: m[1], context: body.slice(Math.max(0, m.index - 220), m.index + 60) }))
    // The image branch is the documented exception, and the 500 handler guards
    // itself with `!res.headersSent`.
    .filter((o) => !/image|headersSent/i.test(o.context));

  assert.deepEqual(
    offenders.map((o) => o.code),
    [],
    `a status refusal below the open cannot be delivered: ${JSON.stringify(offenders.map((o) => o.code))}`,
  );
});

test('a failure after the stream is open still tells the client', () => {
  // Opening earlier widens the window in which a throw lands on an open stream.
  // That path must emit an error frame and terminate, or the frontend saves an
  // empty accumulator as the answer.
  // Anchored on the council route's own catch — `} catch (err) {` alone matches
  // the streaming helper hundreds of lines above and tests the wrong handler.
  const councilCatch = at("console.error('Council error:', err.message);");
  const handler = SOURCE.slice(councilCatch, SOURCE.indexOf('} finally {', councilCatch));
  assert.match(handler, /sendEvent\(res, \{ type: 'error'/);
  assert.match(handler, /\[DONE\]/);
});
