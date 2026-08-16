'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { readMigrations } = require('./migration-lineage');

/**
 * EVERY FUNCTION THE CODE CALLS IS CREATED BY A MIGRATION.
 *
 * `reserve_or_requests` and `settle_or_requests` were called on every turn,
 * existed in production, and were created by no file in `migrations/`. Nothing
 * noticed for months: the suite passed because the calls are mocked, and
 * production worked because someone had run the SQL by hand. The cost lands on
 * whoever rebuilds the database — they get a schema with no request budget and
 * a failure at the first RPC.
 *
 * This is the file-side half of the check. `scripts/check-drift.mjs` is the
 * other half and asks production directly; it needs a token, so it cannot run
 * here.
 */
const ROOT = join(__dirname, '..');

const sources = () => {
  const files = [join(ROOT, 'server.js')];
  for (const name of readdirSync(__dirname)) {
    if (name.endsWith('.js') && !name.endsWith('.test.js')) files.push(join(__dirname, name));
  }
  return files;
};

/** `rpc('name'` / `rpc("name"` — the only way this codebase calls a function. */
const calledFunctions = () => {
  const found = new Map();
  for (const file of sources()) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\brpc\(\s*['"]([a-z_][a-z0-9_]*)['"]/gi)) {
      if (!found.has(match[1])) found.set(match[1], file.replace(ROOT, '').replace(/\\/g, '/'));
    }
  }
  return found;
};

test('every RPC the code calls is created by a migration', () => {
  const declared = new Set(readMigrations().functions.map((f) => f.name));
  const missing = [...calledFunctions()]
    .filter(([name]) => !declared.has(name))
    .map(([name, file]) => `${name}() called from ${file}`);

  assert.deepEqual(
    missing,
    [],
    `these functions exist only by hand — a rebuilt database will not have them:\n  ${missing.join('\n  ')}`,
  );
});

test('the check can actually fail', () => {
  // A lineage check that cannot go red is the reason nobody looks at it again.
  const declared = new Set(readMigrations().functions.map((f) => f.name));
  assert.equal(declared.has('a_function_nobody_wrote'), false);
  assert.ok(declared.size > 10, 'readMigrations found almost nothing — the parser, not the schema, is broken');
});

test('the tables the code reads are created by a migration', () => {
  // Same failure shape one level up: `or_request_budget` was untracked too.
  const declared = new Set(readMigrations().tables.map((t) => t.name));
  const missing = new Set();
  for (const file of sources()) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\.from\(\s*['"]([a-z_][a-z0-9_]*)['"]/gi)) {
      if (!declared.has(match[1])) missing.add(match[1]);
    }
  }
  assert.deepEqual([...missing], [], 'tables read by the code that no migration creates');
});
