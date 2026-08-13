'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { readUrl } = require('./read-url');
const { assertSafeUrl } = require('./url-guard');
const { pinnedFetch } = require('./pinned-fetch');

const listen = (handler) => new Promise((resolve, reject) => {
  const server = http.createServer(handler);
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server));
});

const safeLocal = (port, path = '/') => ({
  url: new URL(`http://safe.test:${port}${path}`),
  address: '127.0.0.1',
  family: 4,
});

const localGuard = async (raw) => {
  const url = new URL(raw);
  return { url, address: '127.0.0.1', family: 4 };
};

test('normal fetch returns body, final URL and status', async (t) => {
  const server = await listen((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('hello from the pinned server');
  });
  t.after(() => server.close());

  const result = await readUrl(safeLocal(server.address().port));
  assert.equal(result.body, 'hello from the pinned server');
  assert.equal(result.status, 200);
  assert.equal(result.finalUrl, `http://safe.test:${server.address().port}/`);
  assert.equal(result.truncated, false);
});

for (const address of ['127.0.0.1', '169.254.169.254']) {
  test(`redirect to ${address} is rejected before it is followed`, async (t) => {
    let redirectBodyClosed = false;
    const server = await listen((_req, res) => {
      res.on('close', () => { redirectBodyClosed = true; });
      res.writeHead(302, { location: `http://${address}/private` });
      res.end();
    });
    t.after(() => server.close());

    await assert.rejects(
      () => readUrl(safeLocal(server.address().port)),
      /private or reserved address/,
    );
    assert.equal(redirectBodyClosed, true);
  });
}

test('DNS rebinding cannot replace the address selected by the first lookup', async (t) => {
  let guardCalls = 0;
  let hits = 0;
  let addressGivenToTransport = null;
  const server = await listen((_req, res) => {
    hits += 1;
    res.end('first address won');
  });
  t.after(() => server.close());

  const guard = async (raw) => {
    guardCalls += 1;
    return {
      url: new URL(raw),
      address: guardCalls === 1 ? '93.184.216.34' : '169.254.169.254',
      family: 4,
    };
  };
  const transport = (url, options) => {
    addressGivenToTransport = options.address;
    // The production transport uses `options.address` directly. This test-only
    // substitution makes the public fixture address reachable on localhost;
    // pinned-fetch.test.js independently proves the connector obeys its pin.
    return pinnedFetch(url, { ...options, address: '127.0.0.1' });
  };
  const result = await readUrl(`http://rebind.test:${server.address().port}/`, {
    assertSafeUrl: guard,
    pinnedFetch: transport,
  });

  assert.equal(result.body, 'first address won');
  assert.equal(hits, 1);
  assert.equal(addressGivenToTransport, '93.184.216.34');
  assert.equal(guardCalls, 1, 'the transport re-resolved the hostname after validation');
});

test('response larger than maxChars is truncated and the upstream stream is cancelled', async (t) => {
  const maxChars = 64;
  const fullChunks = 100;
  let chunksWritten = 0;
  let closedResolve;
  const closed = new Promise((resolve) => { closedResolve = resolve; });
  const server = await listen((_req, res) => {
    const timer = setInterval(() => {
      chunksWritten += 1;
      res.write('x'.repeat(16));
      if (chunksWritten >= fullChunks) {
        clearInterval(timer);
        res.end();
      }
    }, 3);
    res.on('close', () => {
      clearInterval(timer);
      closedResolve();
    });
  });
  t.after(() => server.close());

  const result = await readUrl(safeLocal(server.address().port), { maxChars });
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 100))]);
  assert.equal(result.body.length, maxChars);
  assert.equal(result.truncated, true);
  assert.ok(chunksWritten < fullChunks, `server wrote all ${chunksWritten} chunks before cancellation`);
});

test('private address in the initial DNS result is rejected before a connection', async () => {
  let connections = 0;
  const guard = (raw) => assertSafeUrl(raw, {
    lookup: async () => [{ address: '10.1.2.3', family: 4 }],
  });
  const fetcher = async () => {
    connections += 1;
    throw new Error('must not run');
  };

  await assert.rejects(
    () => readUrl('http://private.test/', { assertSafeUrl: guard, pinnedFetch: fetcher }),
    /private or reserved address/,
  );
  assert.equal(connections, 0);
});

test('file scheme is rejected', async () => {
  await assert.rejects(() => readUrl('file:///etc/passwd'), /Unsupported scheme/);
});

test('more than five redirects is rejected', async (t) => {
  let hits = 0;
  const server = await listen((req, res) => {
    hits += 1;
    const current = Number(new URL(req.url, 'http://safe.test').pathname.slice(1) || 0);
    res.writeHead(302, { location: `/${current + 1}` });
    res.end();
  });
  t.after(() => server.close());

  await assert.rejects(
    () => readUrl(safeLocal(server.address().port, '/0'), { assertSafeUrl: localGuard, maxRedirects: 5 }),
    /more than 5 redirects/,
  );
  assert.equal(hits, 6, 'the sixth redirect response must be rejected, not followed to a seventh request');
});

test('both council tool registries use readUrl and the live one reaches runAgentLoop', () => {
  const source = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /const \{ readUrl \} = require\('\.\/lib\/read-url'\)/);
  assert.doesNotMatch(source, /readUrl:\s*readPageContent/, 'the unpinned Jina reader was wired back into read_url');
  const bindings = source.match(/\breadUrl(?:,|\s*:)/g) || [];
  assert.ok(bindings.length >= 2, `expected shadow and live registry bindings, found ${bindings.length}`);

  const liveGate = source.indexOf('if (TOOLS_ENABLED && !imageContext)');
  const liveRegistry = source.indexOf('const registry = buildRegistry({', liveGate);
  const loop = source.indexOf('runAgentLoop({', liveRegistry);
  assert.ok(liveGate >= 0 && liveRegistry > liveGate && loop > liveRegistry,
    'COUNCIL_TOOLS live mode must build the pinned registry before entering the tool loop');
});
