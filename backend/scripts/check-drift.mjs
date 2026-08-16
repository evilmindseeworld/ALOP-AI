#!/usr/bin/env node
/**
 * WHAT THE MIGRATIONS SAY, AGAINST WHAT THE DATABASE IS.
 *
 * Both directions, because both happened here on 2026-08-16 and neither was
 * visible to anything that existed:
 *
 *   MISSING — `019_turn_ledger.sql` was never applied. `turns`,
 *   `turn_reservations` and their three functions did not exist in production
 *   while `lib/turn-ledger.js` and `lib/reservation-ledger.js` called them on
 *   every turn. Both fail open by design, so resume-after-drop and idempotent
 *   admission were simply off, silently, with a green test suite.
 *
 *   UNTRACKED — `or_request_budget` and its two functions existed in
 *   production and in no migration file, so a rebuild from `migrations/`
 *   produced a database that failed at its first RPC.
 *
 * `lib/migration-lineage.js` reads the FILES and cannot see either. This
 * script asks the database, which is the only thing that knows.
 *
 * Read-only. Every statement here is a SELECT.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/check-drift.mjs
 *
 * Exit 1 when anything is missing; untracked objects are reported and do not
 * fail the run on their own, because the ad-hoc tables that predate migrations
 * (`users`, `chats`, `usage`, `audit_logs`, `user_facts`) are permanent and
 * known — they are listed below so a NEW one still stands out.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import dotenv from "dotenv";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { readMigrations } = require("../lib/migration-lineage");

dotenv.config({ path: join(HERE, "..", ".env") });

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef =
  process.env.SUPABASE_PROJECT_REF ||
  (process.env.SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ||
  null;

const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };
if (!TOKEN) die("SUPABASE_ACCESS_TOKEN is not set. https://supabase.com/dashboard/account/tokens");
if (!projectRef) die("Could not determine the project ref. Set SUPABASE_PROJECT_REF or SUPABASE_URL.");

/**
 * Objects Supabase owns, not the project's to track.
 *
 * `rls_auto_enable` is the platform's own event-trigger function, paired with
 * the `ensure_rls` event trigger; it appears in `public` and no migration
 * should create it. Listed by name rather than skipped by a pattern, so the
 * day a NEW untracked object is created by hand it is not absorbed into an
 * exemption. The five base tables used to be listed here and are now created
 * by `000_base_schema_lineage.sql`, which is what emptied this set.
 */
const AD_HOC = new Set(["rls_auto_enable"]);

/** Extension-owned functions are not the project's to track. */
const EXTENSION_SCHEMAS_QUERY = `
  select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  left join pg_depend d
    on d.objid = p.oid and d.deptype = 'e'
  where n.nspname = 'public' and d.objid is null`;

async function runSql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) die(`Management API ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

const report = (title, names) => {
  if (!names.length) return false;
  console.log(`\n${title}`);
  for (const name of names.sort()) console.log(`  - ${name}`);
  return true;
};

const main = async () => {
  const declared = readMigrations();
  const declaredTables = new Set(declared.tables.map((t) => t.name));
  const declaredFunctions = new Set(declared.functions.map((f) => f.name));

  const liveTables = new Set(
    (await runSql(
      `select table_name from information_schema.tables
       where table_schema='public' and table_type='BASE TABLE'`,
    )).map((r) => r.table_name),
  );
  const liveFunctions = new Set((await runSql(EXTENSION_SCHEMAS_QUERY)).map((r) => r.proname));

  console.log(`\nProject: ${projectRef}`);
  console.log(`Migrations declare ${declaredTables.size} tables, ${declaredFunctions.size} functions.`);
  console.log(`Production has ${liveTables.size} tables, ${liveFunctions.size} non-extension functions.`);

  const missingTables = [...declaredTables].filter((t) => !liveTables.has(t));
  const missingFunctions = [...declaredFunctions].filter((f) => !liveFunctions.has(f));
  const untrackedTables = [...liveTables].filter((t) => !declaredTables.has(t) && !AD_HOC.has(t));
  const untrackedFunctions = [...liveFunctions].filter((f) => !declaredFunctions.has(f) && !AD_HOC.has(f));

  const missed =
    report("MISSING — a migration declares it and production does not have it:", [
      ...missingTables.map((t) => `table ${t}`),
      ...missingFunctions.map((f) => `function ${f}()`),
    ]) | 0;

  report("UNTRACKED — production has it and no migration creates it:", [
    ...untrackedTables.map((t) => `table ${t}`),
    ...untrackedFunctions.map((f) => `function ${f}()`),
  ]);

  if (missed) {
    console.log("\n✗ Production is behind the migrations. Apply them before trusting the code that calls them.\n");
    process.exit(1);
  }
  console.log("\n✓ Every migrated object exists in production.\n");
};

main().catch((err) => die(err.message));
