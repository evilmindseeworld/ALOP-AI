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
