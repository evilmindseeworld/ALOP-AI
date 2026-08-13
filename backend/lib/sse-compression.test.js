'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const compression = require('compression');
const http = require('node:http');
const zlib = require('node:zlib');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { sseAwareFilter } = require('./sse-compression');

/**
 * The assertion that matters is TIMING, not headers: an SSE frame written
 * before the response ends must REACH the client before the response ends.
 * A test that only checked `content-encoding` would pass on a filter that
 * disabled gzip for the wrong reason, and would go on passing if someone
 * later re-enabled it behind a res.flush() that a new call site forgets.
 */
const listen = (app) => new Promise((resolve) => {
  const server = http.createServer(app).listen(0, () => resolve(server));
});

/** Frames as the client actually sees them, each stamped with its arrival. */
const readStream = (port) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const req = http.get({ port, path: '/sse', headers: { 'Accept-Encoding': 'gzip' } }, (res) => {
    const body = res.headers['content-encoding'] === 'gzip' ? res.pipe(zlib.createGunzip()) : res;
    const frames = [];
    body.on('data', (b) => frames.push({ at: Date.now() - t0, text: b.toString() }));
    body.on('end', () => resolve({ frames, endedAt: Date.now() - t0 }));
    body.on('error', reject);
  });
  req.on('error', reject);
});

const HOLD_MS = 300;

/** One early frame, a deliberate gap, then the close. */
const sseApp = (filter) => {
  const app = express();
  app.use(compression(filter ? { filter } : {}));
  app.get('/sse', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.flushHeaders?.();
    res.write('data: {"type":"stage","text":"Asking 7 seats"}\n\n');
    setTimeout(() => { res.write('data: {"type":"chunk","text":"hi"}\n\n'); res.end(); }, HOLD_MS);
  });
  return app;
};

test('a stage frame reaches the client before the answer, not with it', async (t) => {
  const server = await listen(sseApp(sseAwareFilter));
  t.after(() => server.close());
  const { frames, endedAt } = await readStream(server.address().port);
  assert.ok(frames.length >= 2, `progress was coalesced into ${frames.length} delivery(ies): ${JSON.stringify(frames)}`);
  assert.match(frames[0].text, /Asking 7 seats/);
  assert.ok(
    frames[0].at < endedAt - HOLD_MS / 2,
    `stage frame arrived at ${frames[0].at}ms, stream ended at ${endedAt}ms — it was buffered to the end`,
  );
});

test('the unfiltered mount is what broke it — same route, frames held to the end', async (t) => {
  // Guards the claim in sse-compression.js rather than trusting it: if a
  // compression upgrade ever stops buffering SSE, this fails and the filter
  // (and its comment) can be revisited instead of cargo-culted forever.
  const server = await listen(sseApp(null));
  t.after(() => server.close());
  const { frames, endedAt } = await readStream(server.address().port);
  assert.ok(
    frames.length === 1 && frames[0].at >= endedAt - 5,
    `expected plain compression() to hold every frame to the end, got ${JSON.stringify(frames)}`,
  );
});

test('ordinary JSON responses are still compressed', async (t) => {
  const app = express();
  app.use(compression({ filter: sseAwareFilter, threshold: 0 }));
  app.get('/sse', (req, res) => res.json({ pad: 'x'.repeat(2048) }));
  const server = await listen(app);
  t.after(() => server.close());
  const gzipped = await new Promise((resolve) => {
    http.get(
      { port: server.address().port, path: '/sse', headers: { 'Accept-Encoding': 'gzip' } },
      (res) => { res.resume(); resolve(res.headers['content-encoding']); },
    );
  });
  assert.equal(gzipped, 'gzip', 'the filter must only exempt event streams, not switch compression off');
});

test('server.js mounts compression with the filter', () => {
  // The filter is only load-bearing if server.js passes it; a bare
  // compression() mount is the original bug and this file would still pass.
  const source = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /app\.use\(compression\(\{ filter: sseAwareFilter \}\)\)/);
  assert.doesNotMatch(source, /app\.use\(compression\(\)\)/);
});
