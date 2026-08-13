'use strict';

const { assertSafeUrl: defaultAssertSafeUrl } = require('./url-guard');
const { pinnedFetch: defaultPinnedFetch } = require('./pinned-fetch');

const DEFAULT_MAX_CHARS = 16_000;
const DEFAULT_MAX_REDIRECTS = 5;

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
  signal,
  headers = {},
} = {}) {
  if (typeof assertSafeUrl !== 'function') throw new TypeError('readUrl: assertSafeUrl must be a function');
  if (typeof pinnedFetch !== 'function') throw new TypeError('readUrl: pinnedFetch must be a function');

  const charLimit = positiveInt(maxChars, DEFAULT_MAX_CHARS);
  const redirectLimit = positiveInt(maxRedirects, DEFAULT_MAX_REDIRECTS);
  let vetted = isVettedTarget(target) ? target : await assertSafeUrl(target, { signal });
  let redirects = 0;

  while (true) {
    if (!isVettedTarget(vetted)) throw new Error('readUrl: safety check did not return a pinned address');
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
      if (redirects >= redirectLimit) {
        throw new Error(`readUrl: more than ${redirectLimit} redirects`);
      }
      const nextUrl = new URL(location, vetted.url).toString();
      vetted = await assertSafeUrl(nextUrl, { signal });
      redirects += 1;
      continue;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return { body: '', finalUrl: vetted.url.toString(), status: response.status, truncated: false };
    }

    const decoder = new TextDecoder();
    let body = '';
    let truncated = false;
    try {
      while (body.length < charLimit) {
        const { done, value } = await reader.read();
        if (done) {
          body += decoder.decode();
          break;
        }
        body += decoder.decode(value, { stream: true });
        if (body.length >= charLimit) {
          truncated = true;
          body = body.slice(0, charLimit);
          await reader.cancel('read_url character limit reached').catch(() => {});
          break;
        }
      }
    } finally {
      if (body.length >= charLimit) await reader.cancel().catch(() => {});
    }

    return {
      body,
      finalUrl: vetted.url.toString(),
      status: response.status,
      truncated,
    };
  }
}

module.exports = { readUrl, DEFAULT_MAX_CHARS, DEFAULT_MAX_REDIRECTS };
