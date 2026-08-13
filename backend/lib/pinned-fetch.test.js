'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { pinnedFetch } = require('./pinned-fetch');

/**
 * The property under test is that the CONNECTION goes to the vetted address
 * while the REQUEST still describes the hostname. A test that only checked the
 * body would pass on an implementation that resolved the name again, which is
 * the entire bug.
 */
const listen = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1', () => resolve(server));
});

test('connects to the pinned address and still sends the hostname as Host', async (t) => {
  let seenHost = null;
  const server = await listen((req, res) => {
    seenHost = req.headers.host;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><head><title>pinned</title></head></html>');
  });
  t.after(() => server.close());
  const { port } = server.address();

  // The name never resolves anywhere — if the implementation looked it up
  // instead of using `address`, this rejects with ENOTFOUND.
  const res = await pinnedFetch(`http://vhost.invalid:${port}/page`, { address: '127.0.0.1', family: 4 });

  assert.equal(res.status, 200);
  assert.equal(seenHost, `vhost.invalid:${port}`, 'Host must name the site, not the address');
  const body = await new Response(res.body).text();
  assert.match(body, /pinned/);
});

test('a redirect is returned rather than followed', async (t) => {
  // The caller re-validates every hop, so following one here would skip the
  // guard — the redirect is the classic way into a private address.
  const server = await listen((req, res) => {
    res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
    res.end();
  });
  t.after(() => server.close());
  const { port } = server.address();

  const res = await pinnedFetch(`http://vhost.invalid:${port}/`, { address: '127.0.0.1', family: 4 });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'http://169.254.169.254/latest/meta-data/');
  await res.body.cancel();
});

test('refuses to run without a vetted address', async () => {
  // Calling this without an address would silently fall back to ordinary DNS
  // in a naive implementation, which is the bug wearing a helmet.
  await assert.rejects(
    () => pinnedFetch('http://example.com/', {}),
    /no vetted address/,
  );
});

test('refuses a non-http scheme', async () => {
  await assert.rejects(
    () => pinnedFetch('file:///etc/passwd', { address: '127.0.0.1' }),
    /unsupported scheme/,
  );
});

test('an abort signal stops the request', async (t) => {
  const server = await listen(() => { /* never responds */ });
  t.after(() => server.close());
  const { port } = server.address();

  const controller = new AbortController();
  const pending = pinnedFetch(`http://vhost.invalid:${port}/`, { address: '127.0.0.1', family: 4, signal: controller.signal });
  controller.abort();
  await assert.rejects(() => pending);
});
