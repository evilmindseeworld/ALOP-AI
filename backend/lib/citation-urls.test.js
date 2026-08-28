'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractUrls, trimCitationUrl, canonicalUrl } = require('./citation-urls');

test('citation extraction removes terminal citation punctuation, including Unicode closers', () => {
  const url = 'https://example.com/report';
  assert.deepEqual(extractUrls(`${url}】])},.;`), [url]);
  assert.equal(trimCitationUrl(`${url}】 ] ) } , . ;`), url);
});

test('citation extraction keeps legal URL punctuation when it is part of the URL', () => {
  const url = 'https://example.com/path_(draft)[x]?q=a+b%2Fc;part,more';
  assert.deepEqual(extractUrls(url), [url]);
  assert.deepEqual(extractUrls(`${url}.`), [url]);
});

test('citation extraction stops at Markdown and prose delimiters around a URL', () => {
  const url = 'https://example.com/report';
  assert.deepEqual(extractUrls(`[Report](${url})】,`), [url]);
});

test('the live weather citation with corner brackets grades as the bare URL', () => {
  const url = 'https://www.bbc.com/weather/2643743';
  const answer = `London is cloudy【${url}】.`;
  assert.deepEqual(extractUrls(answer), [url]);
  assert.equal(canonicalUrl(`${url}】.`), url);
});

test('canonicalization matches URL-parser equivalents without following redirects', () => {
  assert.equal(
    canonicalUrl('HTTPS://WWW.Example.COM:443/report#today'),
    'https://www.example.com/report',
  );
  assert.equal(
    canonicalUrl('https://www.example.com/report#source-fragment'),
    'https://www.example.com/report',
  );
});
