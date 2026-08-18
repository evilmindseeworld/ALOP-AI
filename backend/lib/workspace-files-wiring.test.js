'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * A WORKSPACE FILE IS A `chat_files` ROW WITH `chat_id IS NULL` (029), AND
 * EVERY WAY THAT GOES WRONG IS A ONE-LINE EDIT.
 *
 * The feature is small on purpose — no second table, no second store, no second
 * retrieval path — which means the properties that make it correct are not
 * visible as code anyone would think to protect. These are those properties.
 */
const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
const MIGRATION = readFileSync(join(__dirname, '..', 'migrations', '029_workspace_files.sql'), 'utf8');
const NEWLINE = String.fromCharCode(10);

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

const PATCH = "app.patch('/api/chats/:id/files/:fileId'";

test('promotion is a NULL chat_id and nothing else', () => {
  const body = routeBody(PATCH);
  // Not a copy, not a new row, not a move in the bucket. A second row would
  // double every search hit and leave two objects to sweep.
  assert.match(body, /update\(\{ chat_id: wanted \? null : req\.params\.id \}\)/);
  assert.equal(/\.insert\(/.test(body), false, 'promotion inserts a row; the same document would then match twice');
  assert.equal(/storage\s*\.from\(|storage_path/.test(body), false, 'promotion touches the object; a key is an address, and rewriting it means a copy, a delete, and a window where a download 404s');
});

test('demotion returns the file to the chat the caller has PROVEN it owns', () => {
  const body = routeBody(PATCH);
  // requireOwnership('chats') ran on req.params.id. A chat named in the body
  // would be a way to file a document into a conversation you do not own.
  assert.match(body, /requireOwnership\('chats'\)/);
  assert.match(body, /: req\.params\.id \}\)/, 'demotion does not use the URL chat');
  assert.equal(/chat_id: req\.body/.test(body), false, 'the body can name the destination chat');
});

test('the update is checked for having matched a row', () => {
  const body = routeBody(PATCH);
  /* `.update().eq()` reports NO ERROR when it matches zero rows. That exact
   * defect shipped once already, in the Stripe webhook (1fa6aec), where an
   * event addressed to a missing row logged the healthy line and marked itself
   * done. `.select()` is what makes "no such file" distinguishable. */
  assert.match(body, /\.select\('id,name'\)/, 'the update result is never selected, so a zero-row update reads as success');
  assert.match(body, /if \(!data \|\| !data\.length\)/, 'a zero-row update is not detected');
  assert.match(body, /404/);
});

test('an already-promoted file can still be demoted', () => {
  const body = routeBody(PATCH);
  // Once chat_id IS NULL, `.eq('chat_id', …)` never finds the row again, so a
  // promotion would be one-way and the button would silently stop working.
  assert.match(body, /inThisChatOrWorkspace\(/, 'the update scopes with .eq on chat_id, so a promoted file can never be found again');
});

test('the workspace ceiling is enforced before the write, and only on promotion', () => {
  const body = routeBody(PATCH);
  assert.match(body, /MAX_WORKSPACE_FILES/, 'nothing bounds how many files are searched on every turn of every chat');
  assert.match(body, /\.is\('chat_id', null\)/, 'the count is not restricted to workspace rows');
  assert.ok(body.indexOf('MAX_WORKSPACE_FILES') < body.indexOf('update({ chat_id'), 'the ceiling is checked after the write');
  // Demotion always has room by definition; blocking it would strand a user at
  // the ceiling with no way down.
  assert.match(body, /if \(wanted\) \{/, 'the ceiling is checked on demotion too, which can only ever free space');
});

test('the workspace ceiling is its own number, not a share of the per-chat one', () => {
  assert.match(SOURCE, /const MAX_WORKSPACE_FILES = (\d+);/);
  const workspace = Number(SOURCE.match(/const MAX_WORKSPACE_FILES = (\d+);/)[1]);
  assert.ok(workspace > 0 && workspace <= 20, `implausible workspace ceiling: ${workspace}`);
  // These files are searched on EVERY turn of EVERY conversation, which the
  // twentieth attachment of one chat is not. Smaller is the argued position;
  // this asserts the two numbers are at least distinct constants.
  assert.match(SOURCE, /const MAX_FILES_PER_CHAT|MAX_FILES_PER_CHAT/);
});

test('a promoted file is outside the chat cascade BY CONSTRUCTION, not by a flag', () => {
  /* The whole reason the scope is spelled `chat_id IS NULL` rather than
   * `scope = 'workspace'`: a foreign key does not constrain a NULL, so the row
   * leaves the ON DELETE CASCADE in 003 automatically. With a flag beside a
   * still-populated chat_id, deleting the conversation a document happened to
   * be uploaded into would delete the workspace document too, and the flag
   * would be a comment rather than a mechanism. */
  assert.match(MIGRATION, /ALTER COLUMN chat_id DROP NOT NULL/);
  assert.equal(/ADD COLUMN[\s\S]*scope/i.test(MIGRATION), false, 'a scope column reintroduces the cascade this design escapes');
  assert.match(MIGRATION, /WHERE chat_id IS NULL/, 'the workspace read has no index; it cannot use the chat-leading one from 003');
});

test('the client is told a file is workspace-wide, and not which chat it came from', () => {
  const start = SOURCE.indexOf('list: async ({ signal } = {}) => {');
  assert.notEqual(start, -1);
  const body = SOURCE.slice(start, SOURCE.indexOf('},', start));
  assert.match(body, /workspace: chat_id === null/, 'the client cannot tell a workspace file from a chat file');
  // chat_id is destructured away for the same reason storage_path is: this
  // store is what read_file and search_files see, so anything left on the
  // object is one field away from a model's context.
  assert.match(body, /\(\{ storage_path, chat_id, \.\.\.file \}\)/, 'chat_id or storage_path leaks to the client and to the tools');
});
