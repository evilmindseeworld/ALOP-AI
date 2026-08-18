'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { BUCKET, isUuid, keyFor, ownerOf, belongsTo, UnsafeKey } = require('./storage-keys');

const U = '3f3dd23d-2187-475c-a6b8-e585709c9362';
const C = '39ce749c-fd47-41a4-be04-514ad2db87fb';
const F = '11111111-1111-4111-8111-111111111111';

test('the key is exactly three UUIDs, in owner order', () => {
  assert.equal(keyFor({ userId: U, chatId: C, fileId: F }), `${U}/${C}/${F}`);
  assert.equal(BUCKET, 'chat-files');
});

/* THE POINT OF THE WHOLE MODULE. Migration 003 refused a bucket because a key
 * namespace is a path namespace. Every one of these is a path that a key built
 * by string concatenation would have accepted. */
test('nothing that could be a path can become a key', () => {
  const attacks = [
    '../../etc/passwd',
    `${U}/../${U}`,
    '..',
    `${U}%2f${C}`,
    `${U}/${C}`,
    `${U}${String.fromCharCode(0)}`,
    `${U}\\${C}`,
    ` ${U}`,
    `${U} `,
    `${U}.`,
    'secrets.pdf',
    '',
  ];
  for (const bad of attacks) {
    assert.throws(() => keyFor({ userId: bad, chatId: C, fileId: F }), UnsafeKey, `userId accepted: ${JSON.stringify(bad)}`);
    assert.throws(() => keyFor({ userId: U, chatId: bad, fileId: F }), UnsafeKey, `chatId accepted: ${JSON.stringify(bad)}`);
    assert.throws(() => keyFor({ userId: U, chatId: C, fileId: bad }), UnsafeKey, `fileId accepted: ${JSON.stringify(bad)}`);
  }
});

test('a missing value throws rather than becoming the string undefined', () => {
  // The failure this prevents: `${undefined}/${undefined}/x` is a valid string
  // and a perfectly writable object key.
  assert.throws(() => keyFor({}), UnsafeKey);
  assert.throws(() => keyFor({ userId: U, chatId: C }), UnsafeKey);
  assert.throws(() => keyFor(), UnsafeKey);
  assert.throws(() => keyFor({ userId: U, chatId: C, fileId: null }), UnsafeKey);
  assert.throws(() => keyFor({ userId: U, chatId: C, fileId: 42 }), UnsafeKey);
});

test('the filename never reaches the key', () => {
  // A filename is the one part of an upload the user fully controls.
  const key = keyFor({ userId: U, chatId: C, fileId: F });
  assert.ok(!key.includes('.'));
  assert.equal(key.split('/').length, 3);
});

test('ownerOf reads the owner back out, and refuses anything else', () => {
  assert.equal(ownerOf(`${U}/${C}/${F}`), U);
  assert.equal(ownerOf(`${U}/${C}/${F}/extra`), null);
  assert.equal(ownerOf(`/${U}/${C}/${F}`), null);
  assert.equal(ownerOf(`${U}/${C}`), null);
  assert.equal(ownerOf('a/b/c'), null);
  assert.equal(ownerOf(null), null);
  assert.equal(ownerOf(42), null);
});

test('belongsTo does not take the caller word for who owns a key', () => {
  const other = '39ce749c-fd47-41a4-be04-514ad2db87fb';
  assert.equal(belongsTo(`${U}/${C}/${F}`, U), true);
  assert.equal(belongsTo(`${U}/${C}/${F}`, other), false);
  assert.equal(belongsTo(`${U}/${C}/${F}`, 'not-a-uuid'), false);
  assert.equal(belongsTo('rubbish', U), false);
});

test('isUuid is case-insensitive but shape-strict', () => {
  assert.equal(isUuid(U.toUpperCase()), true);
  assert.equal(isUuid(`${U}0`), false);
  assert.equal(isUuid(U.replace(/-/g, '')), false);
});
