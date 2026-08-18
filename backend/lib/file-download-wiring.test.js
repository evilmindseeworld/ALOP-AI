'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * MIGRATION 003 REFUSED A BUCKET FOR A SECURITY REASON, AND 028 ADDED ONE
 * ANYWAY. These are the properties that make that safe rather than a reversal,
 * asserted against the source because every one of them is a shape a later
 * "tidy" would remove without any unit test noticing.
 *
 *   > A bucket would reintroduce a key namespace to get wrong ... there is no
 *   > path to traverse because there is no path, and ownership is a predicate
 *   > rather than a convention.                                        — 003
 *
 * The three ways that could quietly stop being true:
 *
 *   1. The key gets built inline from a filename or a request parameter, rather
 *      than through `lib/storage-keys.js` from three resolved UUIDs.
 *   2. The download starts serving by key — resolving the object first and the
 *      row second, or not at all — so the key becomes the authorisation.
 *   3. The object deletion moves into the DELETE route, where a chat or user
 *      cascade never reaches it, and every object deleted the other way leaks.
 */
const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

/** The body of an `app.<method>('<path>', …)` registration, by brace depth. */
const routeBody = (needle) => {
  const start = SOURCE.indexOf(needle);
  assert.notEqual(start, -1, `route is gone: ${needle} — this test needs rewriting, not deleting`);
  let depth = 0;
  for (let i = SOURCE.indexOf('{', start); i < SOURCE.length; i += 1) {
    if (SOURCE[i] === '{') depth += 1;
    else if (SOURCE[i] === '}' && (depth -= 1) === 0) return SOURCE.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces reading ${needle}`);
};

const DOWNLOAD = "app.get('/api/chats/:id/files/:fileId/download'";
const DELETE_FILE = "app.delete('/api/chats/:id/files/:fileId'";

test('the download resolves the ROW by the ownership predicate, not the key', () => {
  const body = routeBody(DOWNLOAD);
  // The identical three-part predicate read_file has always used.
  assert.match(body, /\.eq\('id', req\.params\.fileId\)/, 'the download does not filter by file id');
  assert.match(body, /\.eq\('user_id', user\.id\)/, 'the download does not filter by user — any user could name any file id');
  assert.match(body, /\.eq\('chat_id', req\.params\.id\)/, 'the download does not filter by chat');
  // And the row is read BEFORE anything touches storage.
  assert.ok(
    body.indexOf("from('chat_files')") < body.indexOf('supabase.storage'),
    'the download reaches storage before it has proved the caller owns the row',
  );
});

test('no request value is ever concatenated into an object key', () => {
  const body = routeBody(DOWNLOAD);
  // The key comes off the row, not out of the URL.
  assert.match(body, /file\.storage_path/, 'the download does not use the row-stored key');
  assert.equal(
    /createSignedUrl\([^)]*req\.params/.test(body),
    false,
    'a request parameter reaches createSignedUrl — that is the key namespace 003 refused',
  );
  assert.equal(
    /\.from\(FILE_BUCKET\)[\s\S]{0,200}\$\{req\./.test(body),
    false,
    'a request value is interpolated into a storage call',
  );
});

test('a stored key is re-checked against its owner before it is signed', () => {
  // A column is a value, and a value can be wrong — written by an older bug, or
  // by a path that has not been audited yet. The key names its own owner.
  assert.match(routeBody(DOWNLOAD), /fileObjectOwner\(file\.storage_path\) !== user\.id/);
});

test('a row with no object answers 404 with a reason, not a 500', () => {
  const body = routeBody(DOWNLOAD);
  assert.match(body, /if \(!file\.storage_path\)/, 'a NULL storage_path is not handled — it would reach createSignedUrl as null');
  assert.match(body, /404/, 'the missing-original branch does not answer 404');
});

test('the DELETE route does not remove the object itself', () => {
  const body = routeBody(DELETE_FILE);
  // Handling only this path would leak every object deleted by a chat or user
  // cascade, which is the majority — a cascade runs in Postgres with no
  // application code in the path at all.
  assert.equal(
    /storage[\s\S]{0,40}\.remove\(/.test(body),
    false,
    'the delete route removes the object directly; objects deleted by cascade would then leak forever',
  );
  assert.match(body, /enqueueStorageSweep\(\)/, 'the delete route does not nudge the sweeper');
});

test('the sweeper is registered, so the work list has a drain', () => {
  // A trigger writing rows nothing reads is worse than no trigger: it grows,
  // and it reads as handled.
  assert.match(SOURCE, /storage_sweep: runStorageSweepJob/, 'storage_sweep has no handler; deleted_file_objects would only ever grow');
  assert.match(SOURCE, /kind: 'storage_sweep'/, 'nothing ever enqueues a storage_sweep job');
});

test('the sweeper refuses to delete by a key it could not have derived', () => {
  const start = SOURCE.indexOf('const runStorageSweepJob');
  assert.notEqual(start, -1, 'the sweeper is gone; this test needs rewriting');
  const body = SOURCE.slice(start, SOURCE.indexOf('\nconst enqueueStorageSweep'));
  assert.match(body, /if \(!fileObjectOwner\(row\.storage_path\)\)/, 'the sweeper passes a stored value straight to remove()');
  assert.ok(
    body.indexOf('fileObjectOwner') < body.indexOf('.remove('),
    'the sweeper removes the object before checking the key is one this server derives',
  );
});

test('retaining the original cannot fail the upload that already succeeded', () => {
  const start = SOURCE.indexOf('const retainOriginal');
  assert.notEqual(start, -1, 'retainOriginal is gone; this test needs rewriting');
  const body = SOURCE.slice(start, SOURCE.indexOf('\nconst runStorageSweepJob'));
  // Its whole contract: the text extracted, the row exists, the council can
  // read it. A bucket that is down costs the download and nothing else.
  assert.match(body, /catch \(err\) \{[\s\S]{0,200}return false;/, 'retainOriginal can throw into the upload route');
  assert.match(body, /return false;/);
  // Object first, pointer second — and the object is removed again if the
  // pointer write fails, so nothing is left unreferenced where the sweeper,
  // which only ever sees rows, could never find it.
  assert.ok(body.indexOf('.upload(') < body.indexOf("update({ storage_path"), 'the pointer is written before the object exists');
  assert.match(body, /if \(linkError\) \{[\s\S]{0,200}\.remove\(\[key\]\)/, 'a failed pointer write leaves an object nothing references');
});
