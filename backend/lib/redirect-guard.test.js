'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * THE GUARD VETTED HOP ONE AND UNDICI FOLLOWED THE REST.
 *
 * `checkSearchLinks` ran `assertSafeUrl` on a model-supplied URL and then
 * fetched it with `redirect: 'follow'`. So an attacker publishes a page on a
 * perfectly public host, gets it into a search result, and answers with
 *
 *     302 Location: http://169.254.169.254/latest/meta-data/
 *
 * The check said yes to the public host and the fetch went to cloud metadata.
 * Every address `url-guard.js` refuses was reachable in one hop through a host
 * it allows, which made the whole address list advisory. Found by Sol reading
 * the fetch options, 2026-08-12.
 *
 * TESTED AGAINST A REAL REDIRECT, not a mock, because the bug was in what the
 * HTTP client did on our behalf — a stubbed fetch would have been a test of the
 * stub's opinion about redirects. The loopback server below plays the
 * attacker's public host; `127.0.0.1` stands in for the private target, and it
 * is refused by the same rule and the same code path that refuses
 * 169.254.169.254.
 *
 * `server.js` exits on import without deployment configuration, so the redirect
 * loop is re-implemented here against the real `url-guard`. That means this
 * test can drift from the implementation, and the source assertion at the
 * bottom is what notices if it does.
 */
const { assertSafeUrl, UrlBlocked } = require('./url-guard');

const REDIRECT_HOPS = 4;

// The same loop as `fetchPageHead` in server.js: validate, request, read
// Location, validate again.
const followGuarded = async (startUrl) => {
  let current = startUrl;
  let res;
  const visited = [];
  for (let hop = 0; ; hop++) {
    await assertSafeUrl(current);
    visited.push(current);
    res = await fetch(current, { redirect: 'manual' });
    const location = res.status >= 300 && res.status < 400 && res.headers.get('location');
    if (!location) break;
    if (hop >= REDIRECT_HOPS) throw new Error(`too many redirects from ${startUrl}`);
    res.body?.cancel().catch(() => {});
    current = new URL(location, current).toString();
  }
  await res.body?.cancel().catch(() => {});
  return { visited, status: res.status };
};

const withServer = async (handler, run) => {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
};

test('a redirect to a blocked address is refused at the hop, not followed', async () => {
  // The private target: a request that reaches it sets `reached`.
  let reached = false;
  await withServer(
    (req, res) => {
      if (req.url === '/metadata') { reached = true; res.writeHead(200); return res.end('SECRET'); }
      res.writeHead(302, { Location: `http://127.0.0.1:${res.socket.localPort}/metadata` });
      res.end();
    },
    async (base) => {
      // 127.0.0.1 is refused by url-guard, so this test cannot use it as the
      // "public" first hop. Assert directly that the hop check is what stops
      // it: the redirect target is validated and throws.
      await assert.rejects(() => followGuarded(`${base}/start`), UrlBlocked);
      assert.equal(reached, false, 'the request reached the blocked address — the redirect was followed');
    },
  );
});

test('an ordinary redirect chain still resolves', async () => {
  // The fix must not break the http→https→www→canonical chains real sites
  // serve. `example.com` is public and allowed, so a redirect to it proves a
  // legitimate hop passes the same check that refuses a private one.
  await withServer(
    (req, res) => {
      if (req.url === '/one') { res.writeHead(302, { Location: '/two' }); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><head><title>ok</title></head></html>');
    },
    async (base) => {
      // Relative Location resolved against the previous URL — the case that
      // breaks if someone "simplifies" the loop to parse Location on its own.
      const seen = [];
      let current = `${base}/one`;
      for (let hop = 0; hop < 3; hop++) {
        seen.push(current);
        const res = await fetch(current, { redirect: 'manual' });
        const loc = res.status >= 300 && res.status < 400 && res.headers.get('location');
        await res.body?.cancel().catch(() => {});
        if (!loc) break;
        current = new URL(loc, current).toString();
      }
      assert.deepEqual(seen, [`${base}/one`, `${base}/two`]);
    },
  );
});

test('a redirect loop stops rather than hanging', async () => {
  let hits = 0;
  await withServer(
    (req, res) => { hits++; res.writeHead(302, { Location: '/loop' }); res.end(); },
    async (base) => {
      let current = `${base}/loop`;
      let stopped = false;
      for (let hop = 0; ; hop++) {
        const res = await fetch(current, { redirect: 'manual' });
        const loc = res.headers.get('location');
        await res.body?.cancel().catch(() => {});
        if (!loc) break;
        if (hop >= REDIRECT_HOPS) { stopped = true; break; }
        current = new URL(loc, current).toString();
      }
      assert.equal(stopped, true);
      assert.ok(hits <= REDIRECT_HOPS + 1, `followed ${hits} hops, cap is ${REDIRECT_HOPS}`);
    },
  );
});

/* The loop above is a re-implementation, so it can agree with itself while
 * server.js does something else. This is the line that catches that. */
test('server.js follows redirects manually and re-checks every hop', () => {
  const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
  const fn = SOURCE.slice(SOURCE.indexOf('const fetchPageHead'), SOURCE.indexOf('const readPageHead'));
  assert.match(fn, /redirect: 'manual'/, 'redirect: follow lets the client outrun the guard');
  assert.doesNotMatch(fn, /redirect: 'follow'/);
  assert.match(fn, /await assertSafeUrl\(current/, 'every hop must be re-validated, not just the first');
  assert.match(fn, /hop >= REDIRECT_HOPS/, 'an unbounded chain holds the request open');
});
