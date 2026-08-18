'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { MAX_DOCUMENT_BYTES } = require('./file-intake');

/**
 * AN EXTRACTOR WITH NO CALLER IS NOT A FEATURE.
 *
 * `doc-extract.js` reads PDFs, DOCX and XLSX and is thoroughly tested, and for
 * its whole life nothing called it: the upload route called `prepareUpload`,
 * the synchronous text-only sibling, which refuses every binary kind with
 * "PDF, DOCX and XLSX files require asynchronous document extraction." Every
 * test in `doc-extract.test.js` and `file-intake.test.js` passed while a PDF
 * upload was rejected at the door.
 *
 * The second failure this catches is quieter: the route can call the right
 * function and still 413 every document, because Express parses the body
 * before the handler runs and the default limit for this path was 1mb against
 * a 10.7mb base64 payload.
 */
const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

test('the upload route calls the document path, not the text-only one', () => {
  assert.match(
    SOURCE,
    /const \{ prepareUploadAsync,[^}]*\} = require\('\.\/lib\/file-intake'\)/,
    'server.js no longer imports prepareUploadAsync',
  );
  assert.match(SOURCE, /await prepareUploadAsync\(/, 'the route does not await the document path');
  assert.equal(
    /[^c]\bprepareUpload\(/.test(SOURCE),
    false,
    'a caller still uses the text-only prepareUpload, which refuses every PDF',
  );
});

test('the extraction gets a key, a model list and a deadline', () => {
  // Without the key the PDF branch fails; without a deadline a hung provider
  // holds the request open for as long as it likes.
  const call = SOURCE.slice(SOURCE.indexOf('await prepareUploadAsync('));
  const args = call.slice(0, 400);
  assert.match(args, /apiKey: GOOGLE_API_KEY/);
  assert.match(args, /models: visionModels\(/);
  assert.match(args, /signal: \w+\.signal/);
});

test('THE BODY LIMIT CLEARS AN 8MB DOCUMENT IN BASE64', () => {
  const match = SOURCE.match(/const docJson = express\.json\(\{ limit: '(\d+)mb' \}\)/);
  assert.ok(match, 'no document-sized body parser in server.js');
  const limitBytes = Number(match[1]) * 1024 * 1024;
  // base64 is 4 bytes per 3, plus the rest of the JSON envelope.
  const encoded = Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4;
  assert.ok(
    limitBytes > encoded,
    `limit ${limitBytes} rejects the largest accepted document (${encoded} base64 bytes)`,
  );
  assert.match(
    SOURCE,
    /UPLOAD_ROUTE\.test\(req\.path\)\) return docJson/,
    'the parser exists but the upload path does not select it',
  );
});

test('the upload path pattern matches the route it is meant to match', () => {
  const match = SOURCE.match(/const UPLOAD_ROUTE = \/(.*)\/;/);
  assert.ok(match, 'UPLOAD_ROUTE vanished');
  const re = new RegExp(match[1]);
  assert.equal(re.test('/api/chats/11111111-2222-4333-8444-555555555555/files'), true);
  assert.equal(re.test('/api/chats/abc/files/'), true);
  // Not a licence for every chat sub-path to take a 16mb body.
  assert.equal(re.test('/api/chats/abc/messages'), false);
  assert.equal(re.test('/api/chats/abc/files/extra'), false);
});

/**
 * A CROSS-FILE SEARCH THAT CANNOT READ THE FILES IS A TOOL THAT ALWAYS SAYS NO.
 *
 * `search_files` is registered only when the bound store offers `all()`, so a
 * store missing it does not break — the tool silently stops existing, and the
 * council goes back to guessing which document to open one round at a time.
 * That is exactly the failure the tool was built to end, and nothing else in
 * the suite would notice it: every unit test builds its own fake store.
 */
test('the bound file store can read every file, or search_files is never offered', () => {
  const store = SOURCE.slice(SOURCE.indexOf('const fileStoreFor'));
  const body = store.slice(0, store.indexOf('\n});'));
  assert.match(body, /\ball:\s*async/, 'fileStoreFor has no all() — search_files will not register');
  assert.match(body, /all:[\s\S]*?\.select\([^)]*content/, 'all() must select content; ids and names cannot be searched');
  // The same (user, chat) binding as list/get. Without both predicates the
  // service-role key would happily return another user's documents.
  const all = body.slice(body.indexOf('all:'));
  assert.match(all, /\.eq\('user_id', userId\)/, "all() must filter on user_id");
  /* 029 widened the chat half from `= this chat` to `= this chat OR IS NULL`,
   * because a workspace file belongs to the user rather than to a
   * conversation. The USER half is untouched and must stay that way: it is the
   * predicate that stops a service-role read returning another account's
   * documents. */
  assert.match(all, /inThisChatOrWorkspace\(/, 'all() no longer scopes by chat at all');
});

/**
 * THE WIDENING IN 029 IS ONE LINE, AND THE WRONG ONE LINE LEAKS EVERY CHAT.
 *
 * "Visible from every conversation" is one edit away from "every conversation's
 * files are visible", and the difference is entirely in this predicate. Dropping
 * the chat clause instead of OR-ing a null check would return the user's OTHER
 * conversations' attachments into this one — still their own data, still a
 * privacy failure, and completely invisible to a test that only checks
 * user_id.
 */
test('the workspace widening admits NULL, not everything', () => {
  const start = SOURCE.indexOf('const inThisChatOrWorkspace');
  assert.notEqual(start, -1, 'the workspace scoping helper is gone; this test needs rewriting');
  const NEWLINE = String.fromCharCode(10);
  const helper = SOURCE.slice(start, SOURCE.indexOf(NEWLINE, SOURCE.indexOf('=>', start)));
  assert.match(helper, /chat_id\.eq\.\$\{chatId\}/, 'the helper no longer restricts to this chat');
  assert.match(helper, /chat_id\.is\.null/, 'the helper does not admit workspace files');
  // Exactly two clauses. A third is a scope nobody has argued for.
  assert.equal((helper.match(/chat_id\./g) || []).length, 2, 'the helper has grown a clause beyond "this chat" and "no chat"');
});
