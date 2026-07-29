'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildChatUpdate, sanitizeString } = require('./chat-update');

test('pinned and favorite are persisted as booleans', () => {
  const { payload } = buildChatUpdate({ pinned: true, favorite: false });
  assert.equal(payload.pinned, true);
  assert.equal(payload.favorite, false);
});

test('pinned coerces truthy/falsy input rather than storing it raw', () => {
  assert.equal(buildChatUpdate({ pinned: 1 }).payload.pinned, true);
  assert.equal(buildChatUpdate({ pinned: 0 }).payload.pinned, false);
  assert.equal(buildChatUpdate({ pinned: 'no' }).payload.pinned, true); // non-empty string is truthy
});

// The regression this whole extraction exists for. The sidebar sorts on
// updated_at, so bumping it when only a pin changed would reorder the list as
// though the user had just posted in that chat.
test('a pin-only update does NOT touch updated_at', () => {
  const { payload } = buildChatUpdate({ pinned: true });
  assert.equal('updated_at' in payload, false);
});

test('a favorite-only update does NOT touch updated_at', () => {
  const { payload } = buildChatUpdate({ favorite: true });
  assert.equal('updated_at' in payload, false);
});

test('a title-only rename does NOT touch updated_at', () => {
  const { payload } = buildChatUpdate({ title: 'Renamed' });
  assert.equal('updated_at' in payload, false);
  assert.equal(payload.title, 'Renamed');
});

test('a messages update DOES set updated_at', () => {
  const { payload } = buildChatUpdate({ messages: [{ role: 'user', content: 'hi' }] });
  assert.ok(payload.updated_at, 'expected updated_at to be set');
  assert.ok(!Number.isNaN(Date.parse(payload.updated_at)), 'expected a parseable ISO date');
});

test('non-array messages are rejected as a 400, not written', () => {
  const result = buildChatUpdate({ messages: 'nope' });
  assert.equal(result.error, 'Must be array');
  assert.equal(result.payload, undefined);
});

test('an empty body yields an empty payload so the route can 400', () => {
  const { payload } = buildChatUpdate({});
  assert.deepEqual(payload, {});
  assert.equal(Object.keys(payload).length, 0);
});

test('undefined body does not throw', () => {
  const { payload } = buildChatUpdate(undefined);
  assert.deepEqual(payload, {});
});

test('messages are clamped to 200 entries', () => {
  const many = Array.from({ length: 250 }, (_, i) => ({ role: 'user', content: `m${i}` }));
  const { payload } = buildChatUpdate({ messages: many });
  assert.equal(payload.messages.length, 200);
});

test('message content is clamped and unknown fields are stripped', () => {
  const { payload } = buildChatUpdate({
    messages: [{ role: 'user', content: 'x'.repeat(200000), id: 'a', ts: '1', evil: 'drop me' }],
  });
  assert.equal(payload.messages[0].content.length, 100000);
  assert.equal('evil' in payload.messages[0], false);
});

// A data URL runs to megabytes and a row holds up to 200 messages, so the
// attachment is never persisted — only the flag that one existed.
test('hasImage is kept as a flag; raw attachment data is never persisted', () => {
  const { payload } = buildChatUpdate({
    messages: [{ role: 'user', content: 'look', hasImage: true, image: 'data:image/png;base64,AAAA' }],
  });
  assert.equal(payload.messages[0].hasImage, true);
  assert.equal('image' in payload.messages[0], false);
});

test('hasImage is omitted entirely when falsy', () => {
  const { payload } = buildChatUpdate({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal('hasImage' in payload.messages[0], false);
});

test('title is trimmed and clamped to 120 chars', () => {
  const { payload } = buildChatUpdate({ title: '  ' + 'z'.repeat(300) + '  ' });
  assert.equal(payload.title.length, 120);
});

test('sanitizeString returns empty string for non-strings', () => {
  assert.equal(sanitizeString(null), '');
  assert.equal(sanitizeString(42), '');
  assert.equal(sanitizeString(undefined), '');
});
