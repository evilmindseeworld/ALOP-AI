'use strict';

/* A URL token may contain punctuation that is legal inside the URL, so the
 * extractor is deliberately broad and the terminal cleanup is structural.
 * This keeps balanced path/query delimiters while removing punctuation added by
 * Markdown, prose, or a Unicode citation marker. */
const URL_RE = /https?:\/\/[^\s<>"']+/giu;
const TRAILING_PUNCTUATION_RE = /[.,;:!?…]+$/u;
const ASCII_CLOSERS = new Map([
  [')', '('],
  [']', '['],
  ['}', '{'],
]);
const UNICODE_CLOSERS = new Set(['】', '）', '］', '｝']);

const count = (text, character) => [...text].filter((item) => item === character).length;

function trimCitationUrl(raw) {
  let value = String(raw ?? '').trim();
  let previous;
  do {
    previous = value;
    value = value.replace(/\s+$/u, '');
    value = value.replace(TRAILING_PUNCTUATION_RE, '');
    const characters = [...value];
    const last = characters[characters.length - 1];
    if (UNICODE_CLOSERS.has(last)) {
      value = characters.slice(0, -1).join('');
      continue;
    }
    const opener = ASCII_CLOSERS.get(last);
    if (opener && count(value, last) > count(value, opener)) {
      value = characters.slice(0, -1).join('');
    }
  } while (value !== previous);
  return value;
}

function extractUrls(text) {
  return [...String(text ?? '').matchAll(URL_RE)]
    .map((match) => trimCitationUrl(match[0]))
    .filter(Boolean);
}

function canonicalUrl(value) {
  const candidate = trimCitationUrl(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

module.exports = { URL_RE, extractUrls, trimCitationUrl, canonicalUrl };
