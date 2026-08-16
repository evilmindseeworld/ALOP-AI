'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * NOTHING WAS STOPPING THE LEAK FROM COMING BACK.
 *
 * `error-envelope.js` exists because roughly thirty routes ended in
 * `res.status(500).json({ error: err.message })` — a Supabase failure's prose, a
 * `fetch` failure naming the host it could not reach, a Postgres error carrying
 * the constraint name, all returned to the browser, and masked only when
 * `NODE_ENV === 'production'` happened to be set. Every one of those call sites
 * was converted, and its own unit tests prove the envelope is safe.
 *
 * They prove nothing about the NEXT route. The conversion was a one-time sweep
 * over a 6,800-line file, and the shape it removed is the shape anybody would
 * write by hand the next time — including this one:
 *
 *     } catch (err) { res.status(500).json({ error: err.message }); }
 *
 * The envelope's tests stay green while that line ships. This file is the guard
 * that does not: it reads server.js and refuses the shapes that bypass it.
 *
 * Same class as `lib/upload-wiring.test.js` (an extractor with no caller) and
 * `lib/census-wiring.test.js` (a census in the branch it exists to watch): a
 * unit-tested module is not a wired one.
 */
const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

test('the guard can see the file it is guarding', () => {
  // A guard on the guard. If server.js moves or the helpers are renamed, every
  // assertion below passes vacuously.
  assert.ok(SOURCE.length > 100_000, 'server.js did not read');
  assert.match(SOURCE, /const \{ errorEnvelope, sendError, fail \} = require\('\.\/lib\/error-envelope'\)/);
  assert.ok(SOURCE.split('sendError(').length - 1 > 20, 'sendError is barely used; the sweep may have been reverted');
});

test('no route answers with res.status(...).json(...) — that is the shape that leaked', () => {
  const offenders = [...SOURCE.matchAll(/res\s*\.\s*status\(\s*\d{3}\s*\)\s*\.\s*json\(/g)].map(
    (m) => SOURCE.slice(0, m.index).split('\n').length,
  );
  assert.deepEqual(
    offenders,
    [],
    `server.js line(s) ${offenders.join(', ')} answer with a hand-built status+json. ` +
      'Use fail(res, status, message) for a message you wrote, or sendError(res, err) for a thrown one.',
  );
});

/**
 * The Stripe webhook is the one documented exception, and it is a protocol
 * requirement rather than a preference: Stripe reads a plain-text body and the
 * recipient is Stripe's servers, not a browser. It is pinned by line so that
 * adding a second raw `res.send` anywhere else fails here.
 */
test('the only raw res.send is the Stripe webhook, which Stripe requires', () => {
  /* By the route's actual SPAN, not by a lookback window. A window wide enough
   * to reach the webhook's last send (fifty lines down) is also wide enough to
   * bless an unrelated route that happens to sit near it. */
  const start = SOURCE.indexOf("app.post('/api/stripe/webhook'");
  assert.notEqual(start, -1, 'the Stripe webhook route moved; this test needs rewriting');
  /* The handler body, not the first brace after the route path — that one
   * belongs to `express.raw({ type: 'application/json' })` and closes four
   * words later, which put the whole route "outside itself". */
  const body = SOURCE.indexOf('=> {', start);
  assert.notEqual(body, -1, 'the webhook handler is no longer an arrow function; this test needs rewriting');
  let end = -1;
  let depth = 0;
  for (let i = SOURCE.indexOf('{', body); i < SOURCE.length; i++) {
    if (SOURCE[i] === '{') depth++;
    else if (SOURCE[i] === '}' && --depth === 0) { end = i; break; }
  }
  assert.notEqual(end, -1, 'unbalanced braces reading the webhook route');

  const outside = [...SOURCE.matchAll(/res\s*\.\s*status\(\s*\d{3}\s*\)\s*\.\s*send\(/g)]
    .filter((m) => m.index < start || m.index > end)
    .map((m) => SOURCE.slice(0, m.index).split('\n').length);
  assert.deepEqual(
    outside,
    [],
    `res.status().send() at line(s) ${outside.join(', ')} is outside the Stripe webhook; every other response goes through the envelope`,
  );
});

test('a thrown message is never interpolated into a response body', () => {
  /* `res.json({ ... err.message ... })` in any form. The envelope decides
   * whether a thrown message may be shown — 4xx yes, 5xx never — and a route
   * that interpolates one has taken that decision away from it. */
  const offenders = [...SOURCE.matchAll(/res\s*\.\s*json\(([^;]{0,300}?)\)/g)]
    .filter((m) => /\b(err|error|e)\.message\b/.test(m[1]))
    .map((m) => SOURCE.slice(0, m.index).split('\n').length);
  assert.deepEqual(offenders, [], `server.js line(s) ${offenders.join(', ')} put a thrown message in a response body`);
});

/**
 * ONE 5xx IS ALLOWED TO CARRY A THROWN MESSAGE, and it is named here rather
 * than left to be discovered.
 *
 * `POST /api/image` returns 502 with the model's own refusal ("I can't create
 * that image"), which is a Google-side sentence about the user's own prompt and
 * the single most useful thing they can be told. The rule it bends is real, so
 * it is pinned: if a second one appears, this fails and the exception has to be
 * argued rather than assumed.
 */
test('exactly one 5xx passes a thrown message through, and it is the image refusal', () => {
  const withMessage = [...SOURCE.matchAll(/fail\(\s*res\s*,\s*(\d{3})\s*,([^;]{0,300}?)\)\s*;/g)]
    .filter((m) => Number(m[1]) >= 500 && /\b(err|error|e)\.message\b/.test(m[2]))
    .map((m) => ({ line: SOURCE.slice(0, m.index).split('\n').length, text: m[2] }));

  assert.equal(withMessage.length, 1, `expected 1 documented exception, found ${withMessage.length}: ${withMessage.map((o) => o.line).join(', ')}`);
  assert.match(withMessage[0].text, /Couldn't make that image/, 'the one exception is no longer the image refusal');
});

test('every SSE error frame carries the code and the id, not just prose', () => {
  const frames = [...SOURCE.matchAll(/sendEvent\(\s*res\s*,\s*\{\s*type:\s*'error'([^}]*)\}/g)];
  assert.ok(frames.length >= 2, `expected the stream error frames, found ${frames.length}`);
  for (const frame of frames) {
    const line = SOURCE.slice(0, frame.index).split('\n').length;
    assert.match(frame[1], /\bcode:/, `the SSE error frame at line ${line} has no machine code to branch on`);
    assert.match(frame[1], /operationId/, `the SSE error frame at line ${line} carries no id the user can quote`);
  }
});

test('a streamed failure gets the SAME safe text a pre-stream failure would', () => {
  /* The stream path is the harder one to notice, because its error is rendered
   * INTO the chat: a Postgres or gateway message appears to the user as part of
   * the answer. It must build its text with the envelope, not from err.message. */
  const streamed = SOURCE.slice(SOURCE.indexOf('const streamed = errorEnvelope('), SOURCE.indexOf('const streamed = errorEnvelope(') + 400);
  assert.match(streamed, /errorEnvelope\(err, \{ operationId/);
  assert.match(streamed, /text: streamed\.body\.error/, 'the streamed error text is not the envelope\'s safe prose');
});
