'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isBlockedAddress, assertSafeUrl, UrlBlocked } = require('./url-guard');

/** A lookup stub, so none of this touches DNS. */
const resolvesTo = (...addresses) => async () =>
  addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

const blocked = (promise) => promise.then(
  () => { throw new Error('expected the URL to be blocked, but it was allowed'); },
  (err) => {
    assert.ok(err instanceof UrlBlocked, `expected UrlBlocked, got ${err.constructor.name}: ${err.message}`);
    return err;
  }
);

// ===== ADDRESS CLASSIFICATION =====

test('blocks the cloud metadata address', () => {
  // The single most valuable target for an SSRF on a hosted backend: it hands
  // back instance credentials to anything that can make it issue a GET.
  assert.equal(isBlockedAddress('169.254.169.254'), true);
});

test('blocks loopback', () => {
  assert.equal(isBlockedAddress('127.0.0.1'), true);
  assert.equal(isBlockedAddress('127.1.2.3'), true, 'the whole 127/8 block, not just .0.1');
  assert.equal(isBlockedAddress('::1'), true);
});

test('blocks the RFC1918 private ranges', () => {
  assert.equal(isBlockedAddress('10.0.0.1'), true);
  assert.equal(isBlockedAddress('172.16.0.1'), true);
  assert.equal(isBlockedAddress('172.31.255.255'), true);
  assert.equal(isBlockedAddress('192.168.1.1'), true);
});

test('does NOT block the public addresses adjacent to 172.16/12', () => {
  // 172.16.0.0/12 is 172.16 through 172.31. A naive "starts with 172." check
  // blocks 172.32 and 172.15, which are ordinary public addresses.
  assert.equal(isBlockedAddress('172.15.255.255'), false);
  assert.equal(isBlockedAddress('172.32.0.1'), false);
});

test('blocks link-local, CGNAT, multicast, reserved and broadcast', () => {
  assert.equal(isBlockedAddress('169.254.1.1'), true, 'link-local');
  assert.equal(isBlockedAddress('100.64.0.1'), true, 'carrier-grade NAT');
  assert.equal(isBlockedAddress('224.0.0.1'), true, 'multicast');
  assert.equal(isBlockedAddress('240.0.0.1'), true, 'reserved');
  assert.equal(isBlockedAddress('255.255.255.255'), true, 'broadcast');
  assert.equal(isBlockedAddress('0.0.0.0'), true, 'this host');
});

test('blocks IPv6 loopback, unspecified, unique-local and link-local', () => {
  assert.equal(isBlockedAddress('::'), true);
  assert.equal(isBlockedAddress('fc00::1'), true);
  assert.equal(isBlockedAddress('fd12:3456::1'), true);
  assert.equal(isBlockedAddress('fe80::1'), true);
});

test('sees through an IPv4-mapped IPv6 address', () => {
  // ::ffff:127.0.0.1 IS loopback. A check that only reads the textual form
  // sees a v6 address that matches none of the v6 prefixes and lets it past.
  assert.equal(isBlockedAddress('::ffff:127.0.0.1'), true);
  assert.equal(isBlockedAddress('::ffff:169.254.169.254'), true);
  assert.equal(isBlockedAddress('::ffff:10.0.0.1'), true);
  assert.equal(isBlockedAddress('::ffff:93.184.216.34'), false, 'a mapped PUBLIC v4 is still fine');
});

test('sees through a NAT64 address', () => {
  assert.equal(isBlockedAddress('64:ff9b::127.0.0.1'), true);
  assert.equal(isBlockedAddress('64:ff9b::a00:1'), true, '10.0.0.1 in hex');
});

test('allows ordinary public addresses', () => {
  assert.equal(isBlockedAddress('93.184.216.34'), false);
  assert.equal(isBlockedAddress('8.8.8.8'), false);
  assert.equal(isBlockedAddress('2606:2800:220:1:248:1893:25c8:1946'), false);
});

test('blocks anything it cannot parse', () => {
  // Fail closed. An address shape this does not understand is not a licence
  // to connect to it.
  assert.equal(isBlockedAddress('not-an-ip'), true);
  assert.equal(isBlockedAddress(''), true);
  assert.equal(isBlockedAddress(null), true);
  assert.equal(isBlockedAddress('999.1.1.1'), true);
});

// ===== URL VALIDATION =====

test('allows a public https URL and returns the resolved address', async () => {
  const { url, address } = await assertSafeUrl('https://example.com/page', {
    lookup: resolvesTo('93.184.216.34'),
  });
  assert.equal(url.hostname, 'example.com');
  assert.equal(address, '93.184.216.34');
});

test('rejects non-http schemes', async () => {
  for (const raw of [
    'file:///etc/passwd',
    'ftp://example.com',
    'gopher://example.com',
    'data:text/plain,hello',
  ]) {
    const err = await blocked(assertSafeUrl(raw, { lookup: resolvesTo('93.184.216.34') }));
    assert.match(err.message, /scheme/i, `${raw} should be refused for its scheme`);
  }
});

test('rejects a URL that is not a URL at all', async () => {
  await blocked(assertSafeUrl('not a url', { lookup: resolvesTo('93.184.216.34') }));
  await blocked(assertSafeUrl('', { lookup: resolvesTo('93.184.216.34') }));
});

test('rejects a hostname that resolves to a private address', async () => {
  // The attack this is really for: a public name whose A record points inside.
  const err = await blocked(
    assertSafeUrl('http://internal.example.com/', { lookup: resolvesTo('10.1.2.3') })
  );
  assert.match(err.message, /private|blocked|internal/i);
  assert.equal(err.modelMessage, 'That host is refused by network safety checks. Do not retry this URL.');
});

test('rejects when ANY resolved address is private, not just the first', async () => {
  // A name with several A records, one of them internal. Checking only the
  // first leaves the outcome up to resolver ordering, which rotates.
  await blocked(
    assertSafeUrl('http://mixed.example.com/', { lookup: resolvesTo('93.184.216.34', '127.0.0.1') })
  );
});

test('rejects a literal private IP in the URL', async () => {
  await blocked(assertSafeUrl('http://169.254.169.254/latest/meta-data/', { lookup: resolvesTo('169.254.169.254') }));
  await blocked(assertSafeUrl('http://127.0.0.1:8080/', { lookup: resolvesTo('127.0.0.1') }));
  await blocked(assertSafeUrl('http://[::1]:3000/', { lookup: resolvesTo('::1') }));
});

test('rejects localhost by name', async () => {
  await blocked(assertSafeUrl('http://localhost:5432/', { lookup: resolvesTo('127.0.0.1') }));
});

test('rejects a name that resolves to nothing', async () => {
  await blocked(assertSafeUrl('http://nowhere.example/', { lookup: async () => [] }));
});

test('rejects when the resolver itself fails, rather than proceeding', async () => {
  const err = await blocked(
    assertSafeUrl('http://broken.example/', {
      lookup: async () => { throw new Error('ENOTFOUND'); },
    })
  );
  assert.match(err.message, /ENOTFOUND/);
  assert.equal(err.modelMessage, 'That host could not be resolved. Do not retry this URL.');
});

/**
 * The property that makes the return value load-bearing.
 *
 * Checking a hostname and then handing the HOSTNAME to fetch is a check that
 * proves nothing: the attacker's DNS server can answer "public" to the check
 * and "private" a millisecond later to the connection. That is DNS rebinding,
 * and the only fix is to connect to the address that was actually validated.
 */
test('returns the validated address so the caller need never re-resolve', async () => {
  const { address, url } = await assertSafeUrl('https://example.com/a/b?c=d', {
    lookup: resolvesTo('93.184.216.34'),
  });
  assert.equal(address, '93.184.216.34');
  assert.equal(url.pathname, '/a/b');
  assert.equal(url.search, '?c=d');
});

test('strips credentials rather than forwarding them', async () => {
  // http://user:pass@host is a way to smuggle a payload past a naive log or
  // allowlist, and nothing here has any business sending them on.
  const { url } = await assertSafeUrl('https://user:pass@example.com/', {
    lookup: resolvesTo('93.184.216.34'),
  });
  assert.equal(url.username, '');
  assert.equal(url.password, '');
});

test('defends against a very long URL', async () => {
  await blocked(
    assertSafeUrl(`https://example.com/${'a'.repeat(5000)}`, { lookup: resolvesTo('93.184.216.34') })
  );
});
