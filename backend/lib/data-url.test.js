'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDataUrl, MAX_IMAGE_MB } = require('./data-url');

// A 1x1 transparent PNG.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('parses a png data URL', () => {
  const r = parseDataUrl(`data:image/png;base64,${PNG_B64}`);
  assert.equal(r.mime, 'image/png');
  assert.equal(r.base64, PNG_B64);
  assert.ok(r.bytes > 0);
});

test('parses jpeg, webp and gif', () => {
  assert.equal(parseDataUrl(`data:image/jpeg;base64,${PNG_B64}`).mime, 'image/jpeg');
  assert.equal(parseDataUrl(`data:image/webp;base64,${PNG_B64}`).mime, 'image/webp');
  assert.equal(parseDataUrl(`data:image/gif;base64,${PNG_B64}`).mime, 'image/gif');
});

// The bug this module exists to prevent: the overlay hardcoded image/png, so a
// JPEG would have been described to Gemini under the wrong type.
test('the MIME comes from the payload, not a hardcoded default', () => {
  assert.equal(parseDataUrl(`data:image/webp;base64,${PNG_B64}`).mime, 'image/webp');
  assert.notEqual(parseDataUrl(`data:image/webp;base64,${PNG_B64}`).mime, 'image/png');
});

test('image/jpg is normalised to image/jpeg for Gemini', () => {
  assert.equal(parseDataUrl(`data:image/jpg;base64,${PNG_B64}`).mime, 'image/jpeg');
});

test('leading and trailing whitespace is tolerated', () => {
  assert.ok(parseDataUrl(`  data:image/png;base64,${PNG_B64}  `));
});

test('rejects non-strings', () => {
  for (const v of [null, undefined, 42, {}, [], true]) {
    assert.equal(parseDataUrl(v), null, `expected null for ${JSON.stringify(v)}`);
  }
});

test('rejects non-image data URLs', () => {
  assert.equal(parseDataUrl('data:application/pdf;base64,AAAA'), null);
  assert.equal(parseDataUrl('data:text/html;base64,AAAA'), null);
});

test('rejects a plain URL', () => {
  assert.equal(parseDataUrl('https://example.com/cat.png'), null);
});

test('rejects a data URL that is not base64-encoded', () => {
  assert.equal(parseDataUrl('data:image/png,notbase64'), null);
});

test('rejects an empty payload', () => {
  assert.equal(parseDataUrl('data:image/png;base64,'), null);
});

test('rejects base64 containing invalid characters', () => {
  assert.equal(parseDataUrl('data:image/png;base64,abc$def!'), null);
});

test('rejects a payload over the size limit', () => {
  // 9 MB of decoded data — 'A' repeated is valid base64.
  const oversized = 'A'.repeat(Math.ceil((9 * 1024 * 1024 * 4) / 3));
  assert.equal(parseDataUrl(`data:image/png;base64,${oversized}`), null);
});

test('accepts a payload just under the limit', () => {
  const bytes = (MAX_IMAGE_MB - 1) * 1024 * 1024;
  const b64 = 'A'.repeat(Math.ceil((bytes * 4) / 3 / 4) * 4);
  const r = parseDataUrl(`data:image/png;base64,${b64}`);
  assert.ok(r, 'expected a payload under the limit to parse');
  assert.ok(r.bytes <= MAX_IMAGE_MB * 1024 * 1024);
});

test('the size limit is configurable', () => {
  const url = `data:image/png;base64,${PNG_B64}`;
  assert.ok(parseDataUrl(url, 1));
  assert.equal(parseDataUrl(url, 0), null);
});
