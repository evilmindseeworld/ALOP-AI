'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const {
  readMigrations, unpinnedFunctions, tablesWithoutRls, driftQuery, bareName,
} = require('./migration-lineage');

const state = readMigrations();

/* ==========================================================================
 * THE PARSER, CHECKED AGAINST CASES WHOSE ANSWER IS KNOWN.
 *
 * A scanner that reports "0 problems" is indistinguishable from one that
 * cannot see, and this codebase has already been burnt by exactly that: a
 * search returned four hover rules when nine existed, and the count was read as
 * the truth. So the fixtures below contain a function that IS pinned and one
 * that is NOT, and the test fails if either is classified wrongly.
 * ========================================================================== */

const withFixture = (files, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'lineage-'));
  try {
    for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
    return fn(readMigrations(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('an unpinned function is found, and a pinned one is not reported', () => {
  withFixture({
    '001_x.sql': `
      CREATE TABLE public.thing (id uuid primary key);
      ALTER TABLE public.thing ENABLE ROW LEVEL SECURITY;
      CREATE OR REPLACE FUNCTION public.safe_one() RETURNS void
        LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN END; $$;
      CREATE OR REPLACE FUNCTION public.loose_one(p uuid) RETURNS void
        LANGUAGE plpgsql AS $$ BEGIN END; $$;
    `,
  }, (fixture) => {
    const loose = unpinnedFunctions(fixture).map((f) => f.name);
    assert.deepEqual(loose, ['loose_one'], 'the scanner missed the unpinned function or invented one');
    assert.deepEqual(tablesWithoutRls(fixture), []);
  });
});

test('a later ALTER pins a function created in an earlier file', () => {
  // This is the case that makes file ORDER load-bearing: migration 011 pins
  // functions created in 002, so a scanner that read files independently would
  // report six false positives.
  withFixture({
    '001_a.sql': "CREATE FUNCTION public.f() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;",
    '002_b.sql': "alter function public.f() set search_path = pg_catalog, public;",
  }, (fixture) => {
    assert.deepEqual(unpinnedFunctions(fixture), []);
    assert.equal(fixture.functions[0].pinnedBy, '002_b.sql');
  });
});

test('a table created without RLS is found', () => {
  withFixture({
    '001_a.sql': 'CREATE TABLE public.open_table (id uuid);',
  }, (fixture) => {
    assert.deepEqual(tablesWithoutRls(fixture).map((t) => t.name), ['open_table']);
  });
});

test('SQL comments describing a rule are not counted as applying it', () => {
  // Migration 011's own commentary says "search_path" a dozen times before it
  // pins anything. A scanner reading comments would call every function in that
  // file pinned.
  withFixture({
    '001_a.sql': `
      -- we should SET search_path on this one day
      CREATE FUNCTION public.f() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
    `,
  }, (fixture) => {
    assert.deepEqual(unpinnedFunctions(fixture).map((f) => f.name), ['f']);
  });
});

test('SECURITY DEFINER is detected, because it is what raises the stakes', () => {
  withFixture({
    '001_a.sql': `
      CREATE FUNCTION public.d() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT null::uuid $$;
    `,
  }, (fixture) => {
    assert.equal(fixture.functions[0].securityDefiner, true);
  });
});

test('the schema prefix is not part of the identity', () => {
  assert.equal(bareName('public.Foo'), 'foo');
  assert.equal(bareName('foo'), 'foo');
});

/* ==========================================================================
 * THE REAL DIRECTORY. These are the assertions that fail on the next migration
 * that forgets, which is the whole point of the file.
 * ========================================================================== */

test('the scanner actually sees this repository', () => {
  // Guards the failure mode where a path change makes every check below pass by
  // reading an empty directory.
  assert.ok(state.files.length >= 20, `only ${state.files.length} migrations found`);
  assert.ok(state.functions.length >= 15, `only ${state.functions.length} functions found`);
  assert.ok(state.tables.length >= 10, `only ${state.tables.length} tables found`);
  const known = state.functions.find((f) => f.name === 'current_app_user_id');
  assert.ok(known, 'current_app_user_id is missing — the parser is not reading these files');
  assert.equal(known.securityDefiner, true);
  assert.equal(known.pinned, true, 'a function known to be pinned reads as unpinned');
});

test('EVERY FUNCTION PINS ITS search_path', () => {
  const loose = unpinnedFunctions(state);
  assert.deepEqual(
    loose.map((f) => `${f.name} (${f.file})`),
    [],
    'add `SET search_path` to the definition, or an ALTER in a new migration',
  );
});

test('no SECURITY DEFINER function has a mutable search_path', () => {
  // The subset of the rule above that is a privilege escalation rather than a
  // correctness bug: the shadowed object would run as the definer.
  const escalating = unpinnedFunctions(state).filter((f) => f.securityDefiner);
  assert.deepEqual(escalating.map((f) => f.name), []);
});

test('EVERY TABLE HAS ROW LEVEL SECURITY ENABLED', () => {
  assert.deepEqual(tablesWithoutRls(state).map((t) => `${t.name} (${t.file})`), []);
});

test('the drift query asks the catalogue the same two questions', () => {
  // The checks above read what the migrations SAY. This is how someone asks
  // what the database IS, and it lives next to them so the two cannot drift.
  const sql = driftQuery();
  assert.match(sql, /pg_proc/);
  assert.match(sql, /search_path=/);
  assert.match(sql, /relrowsecurity/);
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter)\b/i, 'the drift query must only read');
});
