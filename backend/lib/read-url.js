'use strict';

const { assertSafeUrl: defaultAssertSafeUrl } = require('./url-guard');
const { pinnedFetch: defaultPinnedFetch } = require('./pinned-fetch');

const DEFAULT_MAX_CHARS = 16_000;
const DEFAULT_MAX_HOPS = 5;
// Backward-compatible name for callers that supplied this option before the
// contract was tightened: the value now caps all HTTP hops, initial included.
const DEFAULT_MAX_REDIRECTS = DEFAULT_MAX_HOPS;

const positiveInt = (value, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
};

const isVettedTarget = (value) => value
  && value.url instanceof URL
  && typeof value.address === 'string'
  && (value.family === 4 || value.family === 6);

/**
 * Read one HTTP(S) URL without reopening DNS-rebinding or redirect SSRF gaps.
 *
 * The caller may pass the result of an earlier `assertSafeUrl` call. That is
 * the registry path and is important: validating the initial URL twice would
 * create the exact validate-one-address/connect-to-another race this adapter
 * exists to close. Every redirect is separately resolved, validated and pinned.
 */
async function readUrl(target, {
  assertSafeUrl = defaultAssertSafeUrl,
  pinnedFetch = defaultPinnedFetch,
  maxChars = DEFAULT_MAX_CHARS,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  maxHops = maxRedirects,
  signal,
  headers = {},
} = {}) {
  if (typeof assertSafeUrl !== 'function') throw new TypeError('readUrl: assertSafeUrl must be a function');
  if (typeof pinnedFetch !== 'function') throw new TypeError('readUrl: pinnedFetch must be a function');

  const charLimit = positiveInt(maxChars, DEFAULT_MAX_CHARS);
  const hopLimit = positiveInt(maxHops, DEFAULT_MAX_HOPS);
  let vetted = isVettedTarget(target) ? target : await assertSafeUrl(target, { signal });
  let hops = 0;

  while (true) {
    if (!isVettedTarget(vetted)) throw new Error('readUrl: safety check did not return a pinned address');
    // The hop ceiling includes the initial request. Check before connecting so
    // a redirect response on the last allowed hop cannot open one more socket.
    if (hops >= hopLimit) throw new Error(`readUrl: more than ${hopLimit} HTTP hops`);
    hops += 1;
    const response = await pinnedFetch(vetted.url, {
      address: vetted.address,
      family: vetted.family,
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ALOP-AI read_url)',
        Accept: 'text/html,text/plain,application/json,*/*',
        // `pinnedFetch` is a deliberately small transport, not a fetch clone;
        // asking for identity avoids decoding compressed bytes as text here.
        'Accept-Encoding': 'identity',
        ...headers,
      },
    });

    const location = response.status >= 300 && response.status < 400
      ? response.headers.get('location')
      : null;
    if (location) {
      await response.body?.cancel().catch(() => {});
      const nextUrl = new URL(location, vetted.url).toString();
      vetted = await assertSafeUrl(nextUrl, { signal });
      continue;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return { body: '', finalUrl: vetted.url.toString(), status: response.status, truncated: false };
    }

    const decoder = new TextDecoder();
    const chars = [];
    let truncated = false;
    const append = (text) => {
      for (const char of text) {
        if (chars.length >= charLimit) {
          truncated = true;
          return;
        }
        chars.push(char);
      }
    };
    try {
      while (!truncated) {
        const { done, value } = await reader.read();
        if (done) {
          append(decoder.decode());
          break;
        }
        append(decoder.decode(value, { stream: true }));
        if (truncated) {
          await reader.cancel('read_url character limit reached').catch(() => {});
        }
      }
    } finally {
      if (truncated) await reader.cancel().catch(() => {});
    }

    return {
      body: chars.join(''),
      finalUrl: vetted.url.toString(),
      status: response.status,
      truncated,
    };
  }
}

module.exports = { readUrl, DEFAULT_MAX_CHARS, DEFAULT_MAX_HOPS, DEFAULT_MAX_REDIRECTS };
