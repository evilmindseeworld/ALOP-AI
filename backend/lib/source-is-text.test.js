'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * A SOURCE FILE THAT GIT CALLS BINARY CANNOT BE REVIEWED.
 *
 * `answer-cache.js` built its cache key by joining fields with a RAW 0x00 byte
 * typed into the string literal instead of its escape. It ran correctly —
 * JavaScript allows a control character inside a literal, and NUL is a good
 * separator precisely because no field can contain it. What it broke was
 * everything around the code: `git diff` reported "Bin 12532 -> 13984 bytes",
 * so the commit introducing it could not be read, reviewed or merged by hand.
 * The module carrying the cross-user cache safety rule is the worst one in this
 * tree to make opaque.
 *
 * The escape produces an identical string, so the fix is purely about tooling.
 * Checked before changing it: keyFor returned byte-identical hashes for a plain
 * question, a search-branch question and a greeting, so nothing already cached
 * in production was orphaned.
 *
 * The banned set is built from character CODES rather than written as a regex
 * literal, because a test that bans a byte must not contain that byte — the
 * first two drafts of this file flagged themselves.
 */
const LIB = __dirname;

// Every C0 control except tab (9), newline (10) and carriage return (13).
const BANNED = new Set(
  Array.from({ length: 32 }, (_, n) => n).filter((n) => n !== 9 && n !== 10 && n !== 13),
);

const firstControl = (text) => {
  for (let i = 0; i < text.length; i += 1) {
    if (BANNED.has(text.charCodeAt(i))) return i;
  }
  return -1;
};

test('no lib source file contains a raw control byte', () => {
  const offenders = [];
  for (const name of readdirSync(LIB)) {
    if (!name.endsWith('.js')) continue;
    const text = readFileSync(join(LIB, name), 'utf8');
    const at = firstControl(text);
    if (at === -1) continue;
    const code = text.charCodeAt(at).toString(16).padStart(2, '0');
    offenders.push(`${name} @${at}: 0x${code} in ${JSON.stringify(text.slice(Math.max(0, at - 40), at + 20))}`);
  }
  assert.deepEqual(offenders, [], `write the escape, not the byte:\n${offenders.join('\n')}`);
});
