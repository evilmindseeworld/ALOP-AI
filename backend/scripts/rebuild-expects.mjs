#!/usr/bin/env node
/**
 * EVERY TABLE AND RPC THE CODE CALLS MUST EXIST IN THE REBUILT DATABASE.
 *
 * `scripts/rebuild-proof.sh` proves the migrations APPLY to an empty database.
 * That is not the same as proving they BUILD it: a file made entirely of
 * guarded `DO $$ ... IF EXISTS ...` blocks applies perfectly and creates
 * nothing, and this repo now contains two such guards deliberately (011 and
 * 024, both for objects the platform or a later migration owns). "0 failures"
 * would stay green while the schema quietly emptied out.
 *
 * So this reads the SOURCE for every `.from('…')` and `.rpc('…')` and requires
 * each name in the catalogue the rebuild produced. It is the same question
 * `lib/rpc-lineage.test.js` asks of the migration FILES, asked of an actual
 * database instead — the difference between a file that claims to create a
 * table and a table.
 *
 *   node scripts/rebuild-expects.mjs <catalogue-file>
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const cataloguePath = process.argv[2];
if (!cataloguePath) {
  console.error('usage: node scripts/rebuild-expects.mjs <catalogue-file>');
  process.exit(2);
}

const built = new Set(
  readFileSync(cataloguePath, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
);

/* Tests are excluded: they name fake tables on purpose, and a fixture called
 * `nonexistent_table` is not a claim about the schema. */
const sources = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/node_modules|migrations|\.git/.test(path)) walk(path);
    } else if (entry.isFile() && /\.(js|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      sources.push(path);
    }
  }
};
walk(ROOT);

const tables = new Set();
const rpcs = new Set();
for (const path of sources) {
  const text = readFileSync(path, 'utf8');
  for (const m of text.matchAll(/\.from\(\s*['"]([a-z0-9_]+)['"]/g)) tables.add(m[1]);
  for (const m of text.matchAll(/\.rpc\(\s*['"]([a-z0-9_]+)['"]/g)) rpcs.add(m[1]);
}

const missing = [
  ...[...tables].filter((n) => !built.has(n)).map((n) => `table ${n}`),
  ...[...rpcs].filter((n) => !built.has(n)).map((n) => `rpc   ${n}`),
];

console.log(`  code calls ${tables.size} tables and ${rpcs.size} rpcs`);
if (missing.length) {
  console.error('  MISSING from the rebuilt database:');
  for (const name of missing.sort()) console.error(`    ${name}`);
  process.exit(1);
}
console.log('  every one of them exists in the rebuilt database');
