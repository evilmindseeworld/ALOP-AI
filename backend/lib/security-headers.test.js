'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const helmet = require('helmet');
const { helmetOptions } = require('./security-headers');

/**
 * Asserted at the WIRE, not in the source, and that distinction is the whole
 * reason this file exists.
 *
 * `xFrameOptions: 'DENY'` shipped for as long as anyone can tell. A grep for
 * "DENY" found it and agreed with it. Helmet 8 does not accept that shape, does
 * not warn, and falls through to its own SAMEORIGIN default — so the deployed
 * backend served SAMEORIGIN while every reading of the source said otherwise.
 * No source-level check could have caught that, because the source was not
 * wrong about its intent; it was wrong about the library.
 *
 * So: mount the real options on a real express app, make a real request, read
 * the real headers.
 */
const headersFrom = async (options = helmetOptions) => {
  const app = express();
  app.use(helmet(options));
  app.get('/probe', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/probe`);
    return Object.fromEntries([...res.headers.entries()]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

const directives = (csp) =>
  Object.fromEntries(
    csp.split(';').filter(Boolean).map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );

test('X-Frame-Options is DENY, and the string form that silently is not', async () => {
  const sent = await headersFrom();
  assert.equal(sent['x-frame-options'], 'DENY');

  // The regression itself, pinned. If someone "simplifies" the option back to a
  // string, this is the line that says why they must not.
  const withString = await headersFrom({ ...helmetOptions, xFrameOptions: 'DENY' });
  assert.equal(
    withString['x-frame-options'],
    'SAMEORIGIN',
    'helmet still ignores the string form — if this ever fails, helmet started honouring it and this guard can relax',
  );
});

test("script-src is 'none': this API serves no HTML and no scripts", async () => {
  const d = directives((await headersFrom())['content-security-policy']);
  assert.deepEqual(d['script-src'], ["'none'"]);
  assert.ok(
    !(d['script-src'] || []).includes("'unsafe-inline'"),
    "the backend CSP travels on JSON and SSE; 'unsafe-inline' here is permission for a route that does not exist, and becomes live the day one does",
  );
});

test('frame-ancestors and script-src agree with the X-Frame-Options header', async () => {
  const sent = await headersFrom();
  const d = directives(sent['content-security-policy']);
  // Deliberately redundant with the header above: the header is for anything
  // that does not implement frame-ancestors, and the two must not disagree —
  // they did, before this file, and the CSP was the one telling the truth.
  assert.deepEqual(d['frame-ancestors'], ["'none'"]);
  assert.equal(sent['x-frame-options'], 'DENY');
});

test('the transport and sniffing headers are still set', async () => {
  const sent = await headersFrom();
  assert.match(sent['strict-transport-security'], /max-age=31536000/);
  assert.match(sent['strict-transport-security'], /includeSubDomains/);
  assert.equal(sent['x-content-type-options'], 'nosniff');
  assert.equal(sent['referrer-policy'], 'strict-origin-when-cross-origin');
});

/* NOT ASSERTED HERE, on purpose: the DOCUMENT CSP, which is the one that
 * governs script execution in the browser. It is set by `frontend/vercel.json`
 * on the Vercel response and has nothing to do with this file — a fact that
 * cost a wrong diagnosis before it was checked. Measured on production it is
 * already free of 'unsafe-inline' and needs no nonce, because Clerk loads as an
 * external script from an allowlisted origin. `frontend/src/__tests__/
 * securityHeaders.test.js` is where that one is covered. */
