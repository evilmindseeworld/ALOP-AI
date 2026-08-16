#!/usr/bin/env node
/**
 * Run a SQL migration against Supabase via the Management API, then verify it.
 *
 * Why this exists: the service-role key cannot execute DDL. It is a PostgREST
 * JWT, and PostgREST exposes no SQL endpoint — /rest/v1/rpc/exec_sql,
 * /rest/v1/rpc/query and /pg/query all return 404. So 001_per_chat_memory.sql
 * sat unrun across several sessions while the backend quietly degraded.
 *
 * The Management API does accept SQL, with a personal access token.
 * Generate one at https://supabase.com/dashboard/account/tokens
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/run-migration.mjs
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/run-migration.mjs --verify-only
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/run-migration.mjs 002_something.sql
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const HERE = dirname(fileURLToPath(import.meta.url));

// Pinned to backend/.env rather than cwd, so the script works from anywhere.
// SUPABASE_URL lives there and the project ref is derived from it.
dotenv.config({ path: join(HERE, "..", ".env") });
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

// Derived from SUPABASE_URL when present so the two cannot disagree.
const projectRef = (() => {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  const url = process.env.SUPABASE_URL || "";
  return url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] || null;
})();

const args = process.argv.slice(2);
const verifyOnly = args.includes("--verify-only");
const file = args.find((a) => !a.startsWith("--")) || "001_per_chat_memory.sql";

const fail = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

if (!TOKEN) {
  fail(
    "SUPABASE_ACCESS_TOKEN is not set.\n" +
    "  Generate one at https://supabase.com/dashboard/account/tokens\n" +
    "  Then: SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/run-migration.mjs"
  );
}
if (!projectRef) {
  fail("Could not determine the project ref. Set SUPABASE_PROJECT_REF or SUPABASE_URL.");
}

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

async function runSql(query) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const detail = typeof body === "string" ? body : body?.message || JSON.stringify(body);
    throw new Error(`HTTP ${res.status} — ${detail}`);
  }
  return body;
}

const columnExists = (table, column) => ({
  label: `${table}.${column} exists`,
  sql: `select 1 from information_schema.columns
        where table_schema='public' and table_name='${table}'
          and column_name='${column}'`,
});
const tableExists = (table) => ({
  label: `${table} table exists`,
  sql: `select 1 from information_schema.tables
        where table_schema='public' and table_name='${table}'`,
});
const indexExists = (name) => ({
  label: `${name} index exists`,
  sql: `select 1 from pg_indexes where schemaname='public' and indexname='${name}'`,
});
const functionExists = (name) => ({
  label: `${name}() exists`,
  sql: `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname='${name}'`,
});
/**
 * A function's search_path is PINNED, not merely present.
 *
 * `functionExists` is not the claim 023 makes — the three functions all
 * existed before it ran and would pass that check with a mutable search_path
 * intact. The claim is about `proconfig`, so assert that, and assert the two
 * schemas by name: a pin to something else is not the pin that was reviewed.
 */
const searchPathPinned = (name) => ({
  label: `${name}() has search_path pinned to pg_catalog, public`,
  sql: `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname='${name}'
          and exists (
            select 1 from unnest(coalesce(p.proconfig, '{}')) c
            where c like 'search_path=%' and c like '%pg_catalog%' and c like '%public%'
          )`,
});
const rlsForced = (table) => ({
  label: `${table} has RLS forced`,
  sql: `select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname='public' and c.relname='${table}'
          and c.relrowsecurity and c.relforcerowsecurity`,
});

/**
 * What each migration must have produced, checked per file.
 *
 * THIS USED TO BE ONE HARDCODED LIST — 001's three artifacts, run no matter
 * which file was applied. So `run-migration.mjs 006_audit_retention.sql` would
 * apply 006 and then print "✓ Migration verified" on the strength of a column
 * 001 had added months earlier, without ever looking at `sweep_audit_logs`. A
 * verification that cannot fail for the thing you just ran is worse than none,
 * because it is the reason nobody looks again.
 *
 * A file with no entry here is a hard failure rather than a pass: silently
 * verifying nothing is the exact behaviour being removed.
 */
const MIGRATION_CHECKS = {
  "001_per_chat_memory.sql": [
    columnExists("chats", "conversation_summary"),
    tableExists("feedback_notes"),
    indexExists("feedback_notes_user_recent"),
  ],
  "002_rls_and_webhook_ledger.sql": [tableExists("stripe_events"), rlsForced("stripe_events")],
  "003_chat_files.sql": [tableExists("chat_files")],
  "004_rate_limits.sql": [
    tableExists("rate_limits"),
    indexExists("rate_limits_expiry"),
    functionExists("increment_rate_limit"),
    functionExists("decrement_rate_limit"),
    rlsForced("rate_limits"),
  ],
  "005_search_cache.sql": [
    tableExists("search_cache"),
    indexExists("search_cache_expiry"),
    functionExists("sweep_search_cache"),
    rlsForced("search_cache"),
  ],
  "006_audit_retention.sql": [
    indexExists("audit_logs_created_at"),
    functionExists("sweep_audit_logs"),
    {
      // The function existing is not the claim the privacy policy makes. The
      // claim is that rows older than 90 days are gone, so assert THAT.
      label: "no audit_logs row is older than 90 days",
      sql: `select 1 from audit_logs where created_at < now() - interval '90 days' limit 1`,
      expectEmpty: true,
    },
  ],
  "023_function_search_path.sql": [
    searchPathPinned("reserve_user_spend"),
    searchPathPinned("settle_user_spend"),
    searchPathPinned("sweep_answer_cache"),
  ],
  "024_or_requests_search_path.sql": [
    searchPathPinned("reserve_or_requests"),
    searchPathPinned("settle_or_requests"),
  ],
  "015_answer_cache.sql": [
    tableExists("answer_cache"),
    indexExists("answer_cache_expiry"),
    functionExists("sweep_answer_cache"),
    rlsForced("answer_cache"),
  ],
};

/**
 * Checks the migration's observable effects rather than trusting the write.
 */
async function verify(forFile) {
  const checks = MIGRATION_CHECKS[forFile];
  if (!checks) {
    console.log(`  ✗ no verification defined for ${forFile} — add one to MIGRATION_CHECKS`);
    return false;
  }

  let allPassed = true;
  for (const check of checks) {
    try {
      const rows = await runSql(check.sql);
      const found = Array.isArray(rows) && rows.length > 0;
      // Most checks assert a thing exists; a few assert a query returns
      // nothing, which is the only way to state "and the old rows are gone".
      const ok = check.expectEmpty ? !found : found;
      console.log(`  ${ok ? "✓" : "✗"} ${check.label}`);
      if (!ok) allPassed = false;
    } catch (err) {
      console.log(`  ✗ ${check.label} — ${err.message}`);
      allPassed = false;
    }
  }
  return allPassed;
}

const main = async () => {
  console.log(`\nProject: ${projectRef}`);

  if (verifyOnly) {
    console.log(`\nVerifying ${file}:`);
    process.exit((await verify(file)) ? 0 : 1);
  }

  const path = resolve(join(HERE, "..", "migrations", file));
  const sql = readFileSync(path, "utf8");
  console.log(`Migration: ${file} (${sql.split("\n").length} lines)`);

  console.log("\nBefore:");
  await verify(file);

  console.log("\nApplying...");
  try {
    await runSql(sql);
    console.log("  applied without error");
  } catch (err) {
    fail(`Migration failed — ${err.message}`);
  }

  console.log("\nAfter:");
  const ok = await verify(file);

  // Applying without error is not the same as the schema being correct, so the
  // exit code follows verification, not the write.
  console.log(ok ? "\n✓ Migration verified.\n" : "\n✗ Applied but verification failed.\n");
  process.exit(ok ? 0 : 1);
};

main().catch((err) => fail(err.message));
