'use strict';

// SSRF guard for the council's read_url tool.
//
// read_url no longer lets a model author a URL — it takes an opaque per-turn
// id minted by the registry from a search result (`d7cf174`) — so the URLs
// reaching this guard come from a search provider rather than from a seat.
// That narrows the source; it does not make the guard optional. A provider can
// return anything, `fetchPageHead` and the link checker call this on URLs from
// elsewhere, and the address a hostname resolves to is nobody's choice at all.
// This process can reach things
// the internet cannot: the Render metadata endpoint, anything else bound on
// localhost, and whatever else shares the private network. `169.254.169.254`
// is one GET away from instance credentials.
//
// TWO PROPERTIES, and the second is the one that is usually missed.
//
//   1. Resolve the hostname and refuse if ANY resulting address is private.
//   2. RETURN the address that was validated, so the caller connects to THAT
//      rather than re-resolving the name.
//
// Without (2) the check proves nothing: an attacker's DNS server answers with
// a public address for the check and a private one for the connection a
// millisecond later. That is DNS rebinding, and no amount of hostname
// inspection fixes it — only connecting to the address you actually vetted.
//
// Everything here fails CLOSED. An address shape this does not understand is
// refused, because "I could not classify it" is not "it is safe".

const dns = require('node:dns').promises;

/** A URL longer than this is not a document reference, it is a payload. */
const MAX_URL_LENGTH = 2048;
const MODEL_URL_REFUSAL = 'That host is refused by network safety checks. Do not retry this URL.';
const MODEL_URL_UNRESOLVED = 'That host could not be resolved. Do not retry this URL.';

class UrlBlocked extends Error {
  constructor(message, modelMessage = MODEL_URL_REFUSAL) {
    super(message);
    this.name = 'UrlBlocked';
    // `message` is the server-side diagnostic. The registry uses this separate
    // value for the council, so resolver details and resolved addresses never
    // cross into a model prompt.
    this.modelMessage = modelMessage;
  }
}

/** IPv4 as a 32-bit integer, or null if it is not a dotted quad. */
const toIPv4 = (text) => {
  const parts = String(text).split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // Reject "01", "1e2", "" and anything else Number() would be generous
    // about. Only plain decimal, only 0-255.
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
};

const inRange = (value, cidrBase, bits) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) >>> 0 === (toIPv4(cidrBase) & mask) >>> 0;
};

/** Every IPv4 block that is not "somewhere on the public internet". */
const BLOCKED_V4 = [
  ['0.0.0.0', 8],        // this host
  ['10.0.0.0', 8],       // RFC1918
  ['100.64.0.0', 10],    // carrier-grade NAT
  ['127.0.0.0', 8],      // loopback — the WHOLE /8, not just 127.0.0.1
  ['169.254.0.0', 16],   // link-local, which is where cloud metadata lives
  ['172.16.0.0', 12],    // RFC1918 — 172.16 to 172.31, NOT all of 172.x
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // TEST-NET-1
  ['192.168.0.0', 16],   // RFC1918
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // TEST-NET-2
  ['203.0.113.0', 24],   // TEST-NET-3
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved, and 255.255.255.255 with it
];

/**
 * Pull the embedded IPv4 out of the two v6 forms that carry one.
 *
 * `::ffff:127.0.0.1` IS loopback. A check that only compares v6 prefixes sees
 * an address matching none of them and waves it through, which is how an
 * IPv4-mapped address becomes a bypass for every rule above.
 */
const embeddedV4 = (text) => {
  const lower = text.toLowerCase();

  // Dotted tail: ::ffff:127.0.0.1 or 64:ff9b::127.0.0.1
  const dotted = lower.match(/:((?:\d{1,3}\.){3}\d{1,3})$/);
  if (dotted) return toIPv4(dotted[1]);

  // Hex tail: ::ffff:7f00:1 and 64:ff9b::a00:1 are the same addresses written
  // the other way, and a guard that only handles the dotted form is a guard
  // with a documented bypass.
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) return ((parseInt(hex[1], 16) << 16) >>> 0) + parseInt(hex[2], 16);

  return null;
};

/**
 * Is this address one we refuse to connect to?
 *
 * Returns TRUE for anything unparseable. Fail closed.
 */
const isBlockedAddress = (address) => {
  if (typeof address !== 'string' || address === '') return true;

  const v4 = toIPv4(address);
  if (v4 !== null) return BLOCKED_V4.some(([base, bits]) => inRange(v4, base, bits));

  if (!address.includes(':')) return true; // not v4, not v6 — not understood

  const mapped = embeddedV4(address);
  if (mapped !== null) return BLOCKED_V4.some(([base, bits]) => inRange(mapped, base, bits));

  const lower = address.toLowerCase();
  if (lower === '::' || lower === '::1') return true;              // unspecified, loopback
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;               // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;               // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}:/.test(lower)) return true;                  // ff00::/8 multicast

  // Must at least look like a v6 address before it is allowed through.
  if (!/^[0-9a-f:]+$/.test(lower)) return true;

  return false;
};

/**
 * Validate a model-supplied URL and resolve it exactly once.
 *
 * @returns {Promise<{url: URL, address: string, family: number}>} `url` has any
 *   credentials stripped; `address` is what the caller must connect to.
 * @throws {UrlBlocked}
 */
const assertSafeUrl = async (raw, { lookup = dns.lookup } = {}) => {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new UrlBlocked('No URL given.', 'That URL is missing. Provide an absolute http(s) URL.');
  }
  if (raw.length > MAX_URL_LENGTH) {
    throw new UrlBlocked(`URL longer than ${MAX_URL_LENGTH} characters.`, `That URL is too long. Keep it under ${MAX_URL_LENGTH} characters.`);
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlBlocked('Not a valid URL.', 'That URL is invalid. Provide an absolute http(s) URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlBlocked(`Unsupported scheme "${url.protocol}" — only http and https are fetched.`, 'That URL uses an unsupported scheme. Use http or https.');
  }

  // Nothing here has any business forwarding credentials, and user:pass@host
  // is a way to smuggle a payload past a log or a naive allowlist.
  url.username = '';
  url.password = '';

  // Strip the brackets IPv6 literals carry in a URL: new URL('http://[::1]/')
  // gives hostname '[::1]', which matches no address pattern.
  const host = url.hostname.replace(/^\[|\]$/g, '');

  let results;
  try {
    results = await lookup(host, { all: true });
  } catch (err) {
    // A resolver failure is not permission to proceed.
    throw new UrlBlocked(`Could not resolve "${host}": ${err.message}`, MODEL_URL_UNRESOLVED);
  }

  const addresses = (Array.isArray(results) ? results : [results]).filter(Boolean);
  if (addresses.length === 0) throw new UrlBlocked(`"${host}" resolved to no addresses.`, MODEL_URL_UNRESOLVED);

  // EVERY address, not just the first. A name with several A records, one of
  // them internal, would otherwise be blocked or allowed depending on resolver
  // ordering — which rotates.
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new UrlBlocked(`"${host}" resolves to ${address}, which is a private or reserved address.`);
    }
  }

  return { url, address: addresses[0].address, family: addresses[0].family };
};

module.exports = { isBlockedAddress, assertSafeUrl, UrlBlocked, MAX_URL_LENGTH };
