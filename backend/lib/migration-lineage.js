'use strict';

/**
 * WHAT THE MIGRATIONS ADD UP TO, read from the files rather than from memory.
 *
 * WHY THIS EXISTS. A migration directory is append-only and each file is
 * reviewed on its own, so every property that spans files — "every table has
 * RLS", "every function pins its search_path" — is checked by nobody. Migration
 * 011 pinned `search_path` on the six functions that existed then; eleven more
 * functions have been added since, in seven files, each reviewed against
 * itself. That is not an oversight anyone made, it is the one thing a per-file
 * review structurally cannot see.
 *
 * WHAT IT IS NOT. It reads SQL text, so it knows what the migrations SAY, not
 * what the database IS. Drift between the two is a separate question and needs
 * the live catalogue — see `driftQuery()` below, which returns the SQL to ask
 * it with. A green result here means the intent is right, and that is a
 * different claim from the schema being right.
 *
 * ponytail: regex over SQL, not a parser. It handles the shapes this directory
 * actually uses — `CREATE [OR REPLACE] FUNCTION`, `ALTER FUNCTION … SET
 * search_path`, `CREATE TABLE`, `ALTER TABLE … ENABLE ROW LEVEL SECURITY` — and
 * would need a real parser the day someone writes SQL that generates SQL.
 */

const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

/** `public.foo` and `foo` are the same function; the schema is not part of the name. */
const bareName = (name) => String(name || '').trim().replace(/^public\./i, '').toLowerCase();

/**
 * Everything the migration files declare, folded in FILE ORDER so that a later
 * `ALTER` is what counts. Order matters: 011 pins functions created in 002.
 *
 * @param {string} [dir] migrations directory
 */
function readMigrations(dir = join(__dirname, '..', 'migrations')) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  /** name -> {name, file, securityDefiner, pinned, pinnedBy} */
  const functions = new Map();
  /** name -> {name, file, rls, rlsBy} */
  const tables = new Map();

  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    /* Comments are stripped first, or the PROSE explaining a rule counts as an
     * instance of it — migration 011's own commentary mentions search_path a
     * dozen times before it pins anything. */
    const bare = sql.replace(/--[^\n]*/g, '');

    for (const match of bare.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(/gi)) {
      const name = bareName(match[1]);
      /* The BODY of this definition: from the signature to the language clause
       * that closes it, or to the next CREATE. `SET search_path` inside those
       * bounds pins this function; the same words further down the file belong
       * to a different one. */
      const from = match.index;
      const nextCreate = bare.slice(from + 1).search(/create\s+(?:or\s+replace\s+)?function/i);
      const body = bare.slice(from, nextCreate === -1 ? undefined : from + 1 + nextCreate);
      const header = body.slice(0, body.search(/\$\$|\bAS\s+\$/i) + 1 || body.length);

      const prior = functions.get(name);
      functions.set(name, {
        name,
        file: prior?.file || file,
        redefinedIn: prior ? [...(prior.redefinedIn || []), file] : [],
        securityDefiner: /security\s+definer/i.test(header),
        pinned: /set\s+search_path/i.test(header) || Boolean(prior?.pinned),
        pinnedBy: /set\s+search_path/i.test(header) ? file : prior?.pinnedBy || null,
      });
    }

    for (const match of bare.matchAll(/alter\s+function\s+([\w.]+)\s*\([^)]*\)\s*set\s+search_path/gi)) {
      const name = bareName(match[1]);
      const prior = functions.get(name);
      if (prior) functions.set(name, { ...prior, pinned: true, pinnedBy: prior.pinnedBy || file });
    }

    for (const match of bare.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w.]+)/gi)) {
      const name = bareName(match[1]);
      if (!tables.has(name)) tables.set(name, { name, file, rls: false, rlsBy: null });
    }

    for (const match of bare.matchAll(/alter\s+table\s+([\w.]+)\s+enable\s+row\s+level\s+security/gi)) {
      const name = bareName(match[1]);
      const prior = tables.get(name);
      if (prior) tables.set(name, { ...prior, rls: true, rlsBy: file });
    }
  }

  return { files, functions: [...functions.values()], tables: [...tables.values()] };
}

/**
 * Functions whose `search_path` is not pinned.
 *
 * WHY IT MATTERS, and the honest size of it: with a mutable search_path, a
 * schema earlier in the caller's path can shadow a table or operator the body
 * names unqualified. On a SECURITY DEFINER function that is a privilege
 * escalation — the shadowed object runs as the definer. On an INVOKER function
 * it is a correctness bug rather than a breach, and still worth closing,
 * because the difference between the two is one `ALTER` somebody makes later.
 */
const unpinnedFunctions = (state) => state.functions.filter((f) => !f.pinned);

/** Tables created without row level security ever being enabled on them. */
const tablesWithoutRls = (state) => state.tables.filter((t) => !t.rls);

/**
 * The SQL that answers "does the database match these files?".
 *
 * Kept here rather than in a runbook so it cannot drift from the checks above:
 * the two halves ask the same question of the text and of the catalogue.
 * Run it through the Supabase MCP; it reads the catalogue and writes nothing.
 */
function driftQuery() {
  return `
-- Functions in public whose search_path is not pinned.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef                               as security_definer,
       p.proconfig                               as settings
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and (p.proconfig is null or not exists (
         select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
 order by p.prosecdef desc, p.proname;

-- Tables in public without row level security.
select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
 order by c.relname;
`.trim();
}

module.exports = { readMigrations, unpinnedFunctions, tablesWithoutRls, driftQuery, bareName };
