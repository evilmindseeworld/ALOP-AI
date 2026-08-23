const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

/**
 * .env.example must document every variable the code reads.
 *
 * It had drifted six behind — ALLOWED_ORIGINS, ALLOWED_ORIGIN_SUFFIXES,
 * CLERK_PUBLISHABLE_KEY, COUNCIL_TOOLS, RATE_LIMIT_STORE, TERMINAL_ADMINS and
 * TERMINAL_SECRET were all read by the server and mentioned nowhere. The only
 * way anyone learned about them was being told, one at a time, usually after
 * something had already broken because one was missing.
 *
 * This is the same shape as the FRONTEND.md §2 guard: documentation nothing
 * verifies is a comment about a different file.
 */

const HERE = join(__dirname, "..");
const EXAMPLE = readFileSync(join(HERE, ".env.example"), "utf8");

/** Sources that read configuration. */
const SOURCES = ["server.js", ...readdirSync(join(HERE, "lib")).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js")).map((f) => join("lib", f))];

/**
 * Variables read from the environment anywhere in the backend.
 *
 * Both access shapes are matched: `process.env.X` in server.js, and `env.X`
 * inside the lib modules, which take an injected env so they can be tested.
 */
const referenced = (() => {
  const found = new Set();
  for (const rel of SOURCES) {
    const src = readFileSync(join(HERE, rel), "utf8");
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g)) found.add(m[1]);
    for (const m of src.matchAll(/\benv\.([A-Z][A-Z0-9_]{2,})/g)) found.add(m[1]);
  }
  return found;
})();

/** Variables with a line in .env.example, set or not. */
const documented = new Set([...EXAMPLE.matchAll(/^([A-Z][A-Z0-9_]{2,})=/gm)].map((m) => m[1]));

test("the parser finds a plausible number of variables at all", () => {
  // A guard on the guard. If the regexes stop matching, every assertion below
  // passes vacuously and the file becomes decoration.
  assert.ok(referenced.size >= 15, `only found ${referenced.size} referenced vars`);
  assert.ok(documented.size >= 15, `only found ${documented.size} documented vars`);
  assert.ok(referenced.has("SUPABASE_URL"));
  assert.ok(documented.has("SUPABASE_URL"));
});

test("EVERY VARIABLE THE CODE READS IS DOCUMENTED", () => {
  const missing = [...referenced].filter((k) => !documented.has(k)).sort();
  assert.deepEqual(
    missing,
    [],
    `read by the backend but absent from .env.example: ${missing.join(", ")}\n` +
      "Add it there with a line saying what happens when it is unset.",
  );
});

/**
 * Read by a DEPENDENCY out of the environment, never by our code, so no grep of
 * this repo can find them. Each has to be justified here rather than being a
 * blanket exemption.
 *
 * The first run of this test found CLERK_SECRET_KEY, which is exactly the
 * category: the Clerk SDK reads it itself out of the environment, and the
 * server would refuse to boot without it while mentioning it nowhere.
 */
const READ_BY_DEPENDENCIES = new Set([
  "CLERK_SECRET_KEY", // @clerk/express, read by clerkMiddleware
]);

/* Dynamic configuration names cannot be found by the source regex above. Keep
 * the exception explicit rather than weakening the scan to match arbitrary
 * bracket access, which would also accept user-controlled environment names. */
const DYNAMIC_REFERENCES = new Set([
  "ALOP_BENCHMARK_CACHE_BYPASS_SECRET", // lib/benchmark-cache-bypass.js
]);

test("no variable is documented that nothing reads", () => {
  // The other direction matters too: a stale entry sends someone to configure
  // something that does nothing, which is worse than silence because it looks
  // like a working feature.
  const orphans = [...documented]
    .filter((k) => !referenced.has(k) && !READ_BY_DEPENDENCIES.has(k) && !DYNAMIC_REFERENCES.has(k))
    .sort();
  assert.deepEqual(orphans, [], `in .env.example but read nowhere: ${orphans.join(", ")}`);
});

test("no real secret has been committed into the example", () => {
  // The file is checked into a PUBLIC repo. Every line must be a bare key with
  // no value — this is the one place a credential would look like documentation.
  const filled = [...EXAMPLE.matchAll(/^([A-Z][A-Z0-9_]{2,})=(.+)$/gm)]
    .map(([, key, value]) => [key, value.trim()])
    // A trailing `# comment` is fine; an actual value is not.
    .filter(([, value]) => value && !value.startsWith("#"))
    // Two deliberate defaults that are not secrets.
    .filter(([key]) => !["NODE_ENV", "PORT"].includes(key));

  assert.deepEqual(filled, [], `looks like a value was committed: ${JSON.stringify(filled)}`);
});

test("the dangerous defaults are stated where someone setting up will read them", () => {
  // Each of these is a variable whose ABSENCE is the dangerous state, and each
  // cost a real incident or a real support message this week.
  assert.match(EXAMPLE, /BEFORE SCALING PAST ONE INSTANCE/);
  assert.match(EXAMPLE, /Failed to create chat/);
  assert.match(EXAMPLE, /an unconfigured security control must never be\s*#?\s*an open one/);
});
