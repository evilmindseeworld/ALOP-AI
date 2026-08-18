const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

/* server.js exits the process at import time when env is missing, so it is read
 * as text here — the same shape the other server-level guards use. Asserted on
 * proximity, not on an escaped literal, so reflowing the line does not fail it. */
const source = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

const ensureUserBody = () => {
  const start = source.indexOf('const ensureUser = async (userId');
  assert.notStrictEqual(start, -1, 'ensureUser moved or was renamed');
  const end = source.indexOf('\n};', start);
  return source.slice(start, end);
};

test('ensureUser reads the shared user-row cache before selecting the row', () => {
  const body = ensureUserBody();
  const cacheRead = body.indexOf('userRowCache.get(');
  const select = body.indexOf(".from('users').select");
  assert.notStrictEqual(cacheRead, -1, 'ensureUser no longer consults userRowCache');
  assert.notStrictEqual(select, -1, 'the users select moved out of ensureUser');
  assert.ok(
    cacheRead < select,
    'the cache read must come BEFORE the select, or every request pays the round trip anyway',
  );
});

test('a row ensureUser fetched itself goes back into the cache', () => {
  const body = ensureUserBody();
  assert.ok(
    body.includes('userRowCache.setIfCurrent('),
    'ensureUser fetched a row and did not populate the cache — the next request repeats the select',
  );
});

test('the populate is generation-guarded, so an invalidation in flight is not undone', () => {
  const body = ensureUserBody();
  const generation = body.indexOf('userRowCache.generation');
  const select = body.indexOf(".from('users').select");
  assert.notStrictEqual(generation, -1, 'the generation read is gone; a concurrent clear can be reverted');
  assert.ok(generation < select, 'the generation must be read BEFORE the select it guards');
});
