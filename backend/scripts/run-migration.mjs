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

/**
 * Checks the migration's observable effects rather than trusting the write.
 * Both are the exact failures the backend was hitting: 42703 for the missing
 * column, PGRST205 for the missing table.
 */
async function verify() {
  const checks = [
    {
      label: "chats.conversation_summary exists",
      sql: `select 1 from information_schema.columns
            where table_schema='public' and table_name='chats'
              and column_name='conversation_summary'`,
    },
    {
      label: "feedback_notes table exists",
      sql: `select 1 from information_schema.tables
            where table_schema='public' and table_name='feedback_notes'`,
    },
    {
      label: "feedback_notes_user_recent index exists",
      sql: `select 1 from pg_indexes
            where schemaname='public' and indexname='feedback_notes_user_recent'`,
    },
  ];

  let allPassed = true;
  for (const check of checks) {
    try {
      const rows = await runSql(check.sql);
      const ok = Array.isArray(rows) && rows.length > 0;
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
    console.log("\nVerifying:");
    process.exit((await verify()) ? 0 : 1);
  }

  const path = resolve(join(HERE, "..", "migrations", file));
  const sql = readFileSync(path, "utf8");
  console.log(`Migration: ${file} (${sql.split("\n").length} lines)`);

  console.log("\nBefore:");
  await verify();

  console.log("\nApplying...");
  try {
    await runSql(sql);
    console.log("  applied without error");
  } catch (err) {
    fail(`Migration failed — ${err.message}`);
  }

  console.log("\nAfter:");
  const ok = await verify();

  // Applying without error is not the same as the schema being correct, so the
  // exit code follows verification, not the write.
  console.log(ok ? "\n✓ Migration verified.\n" : "\n✗ Applied but verification failed.\n");
  process.exit(ok ? 0 : 1);
};

main().catch((err) => fail(err.message));
