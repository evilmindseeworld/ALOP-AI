'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractUrls, trimCitationUrl } = require('./citation-urls');

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
