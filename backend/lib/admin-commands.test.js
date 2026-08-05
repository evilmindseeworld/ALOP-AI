const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCommands, TRACKED_ENV, SHOWABLE } = require("./admin-commands");

/** A Supabase stand-in: every from().select() resolves to a count. */
const fakeSupabase = (over = {}) => ({
  from: (table) => ({
    select: () => ({
      // head:true count query
      then: (res) => res(over[table] || { count: 7, error: null }),
      order: () => ({ limit: () => Promise.resolve(over[table] || { data: [], error: null }) }),
    }),
  }),
});

const build = (over = {}) =>
  buildCommands({
    supabase: fakeSupabase(over.tables),
    env: { COUNCIL_TOOLS: "1", SUPABASE_SERVICE_ROLE_KEY: "super-secret-value", STRIPE_SECRET_KEY: "sk_live_realkey", ...over.env },
    proc: { uptime: () => 3725, version: "v26.4.0", pid: 42, memoryUsage: () => ({ rss: 120e6, heapUsed: 60e6 }) },
  });

test("lists commands with summaries and no input field implied", () => {
  const list = build().list();
  assert.ok(list.length >= 4);
  for (const c of list) {
    assert.equal(typeof c.id, "string");
    assert.ok(c.summary.length > 10);
    // A command that advertised parameters would be a command that takes them.
    assert.equal("args" in c, false);
    assert.equal("params" in c, false);
  }
});

test("health reports process state", async () => {
  const r = await build().run("health");
  assert.equal(r.ok, true);
  assert.equal(r.result.node, "v26.4.0");
  assert.equal(r.result.pid, 42);
  assert.match(r.result.uptime, /1h 2m/);
  assert.match(r.result.rateLimitStore, /memory/);
});

// ===== the rule that matters most =====

test("CONFIG NEVER RETURNS A CREDENTIAL", async () => {
  // A command that returned an env VALUE would turn the strongest credential in
  // the system into an HTTP response. Presence only.
  const r = await build().run("config");
  const serialised = JSON.stringify(r.result);

  assert.equal(serialised.includes("super-secret-value"), false);
  assert.equal(serialised.includes("sk_live_realkey"), false);
  assert.equal(r.result.SUPABASE_SERVICE_ROLE_KEY, "set");
  assert.equal(r.result.STRIPE_SECRET_KEY, "set");
  assert.equal(r.result.SENTRY_DSN, "not set");
});

test("only the explicitly showable variables show their value", async () => {
  const r = await build({ env: { FRONTEND_URL: "https://alop-ai-omega.vercel.app" } }).run("config");
  assert.equal(r.result.COUNCIL_TOOLS, "1");
  assert.equal(r.result.FRONTEND_URL, "https://alop-ai-omega.vercel.app");
  // Everything not on the list is reduced to presence, whatever it holds.
  for (const key of TRACKED_ENV) {
    if (SHOWABLE.has(key)) continue;
    assert.ok(["set", "not set"].includes(r.result[key]), `${key} leaked a value`);
  }
});

test("no tracked variable name matches a credential pattern by accident", () => {
  // SHOWABLE is a list rather than a pattern like !/_KEY$/ on purpose: a
  // pattern is a rule someone eventually satisfies without meaning to.
  for (const key of SHOWABLE) {
    assert.equal(/SECRET|_KEY$|TOKEN|PASSWORD|DSN/.test(key), false, `${key} looks like a credential`);
  }
});

// ===== dispatch =====

test("an unknown command is refused and names the real ones", async () => {
  const r = await build().run("rm -rf /");
  assert.equal(r.ok, false);
  assert.match(r.error, /No such command/);
  assert.match(r.error, /health/);
});

test("PROTOTYPE KEYS ARE NOT COMMANDS", async () => {
  // A bare `commands[id]` lookup resolves these to functions off
  // Object.prototype, and calling one is a strange way to discover the
  // allowlist was not one.
  for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    const r = await build().run(id);
    assert.equal(r.ok, false, id);
    assert.match(r.error, /No such command/);
  }
});

test("a non-string id is refused rather than coerced", async () => {
  for (const id of [undefined, null, 42, {}, [], true]) {
    assert.equal((await build().run(id)).ok, false, JSON.stringify(id));
  }
});

test("has() agrees with run()", () => {
  const c = build();
  assert.equal(c.has("health"), true);
  assert.equal(c.has("constructor"), false);
  assert.equal(c.has("nope"), false);
});

// ===== failure containment =====

test("a command that throws is a failed result, not a thrown error", async () => {
  const c = buildCommands({
    supabase: { from: () => { throw new Error("database on fire"); } },
    env: {},
    proc: process,
  });
  const r = await c.run("usage");
  assert.equal(r.ok, false);
  assert.match(r.error, /database on fire/);
});

test("a hanging command is cut off", async () => {
  const c = buildCommands({
    supabase: { from: () => ({ select: () => new Promise(() => {}) }) },
    env: {},
    proc: process,
  });
  const started = Date.now();
  const r = await c.run("usage", { timeoutMs: 60 });
  assert.equal(r.ok, false);
  assert.match(r.error, /timed out/);
  assert.ok(Date.now() - started < 1500);
});

// ===== the cutover preflight =====

test("origins reports the allowlist and the Clerk instance type", async () => {
  const r = await build({
    env: {
      FRONTEND_URL: "https://alop.com",
      ALLOWED_ORIGINS: "https://www.alop.com, https://alop-ai-omega.vercel.app",
      CLERK_PUBLISHABLE_KEY: "pk_live_abc",
      STRIPE_SECRET_KEY: "sk_live_abc",
    },
  }).run("origins");

  assert.equal(r.ok, true);
  assert.deepEqual(r.result.acceptedOrigins, [
    "https://alop.com",
    "https://www.alop.com",
    "https://alop-ai-omega.vercel.app",
  ]);
  assert.equal(r.result.clerkInstance, "PRODUCTION");
  assert.equal(r.result.stripeMode, "LIVE");
  assert.equal(r.result.warning, null);
});

test("ORIGINS NEVER ECHOES A KEY, ONLY ITS PREFIX", async () => {
  const r = await build({
    env: { CLERK_PUBLISHABLE_KEY: "pk_live_SECRETPART", STRIPE_SECRET_KEY: "sk_live_SECRETPART" },
  }).run("origins");
  assert.equal(JSON.stringify(r.result).includes("SECRETPART"), false);
});

test("names the mismatch that actually breaks a cutover", async () => {
  // Clerk moved to production, origins still only the vercel alias: the app
  // loads and every API call fails CORS. Nothing in the server logs looks
  // wrong, because refusing a disallowed origin IS the server working.
  const r = await build({
    env: {
      FRONTEND_URL: "https://alop-ai-omega.vercel.app",
      ALLOWED_ORIGINS: "",
      CLERK_PUBLISHABLE_KEY: "pk_live_abc",
    },
  }).run("origins");
  assert.match(r.result.warning, /fail CORS/);
});

test("a development Clerk instance is called what it is", async () => {
  const r = await build({ env: { CLERK_PUBLISHABLE_KEY: "pk_test_abc" } }).run("origins");
  assert.match(r.result.clerkInstance, /DEVELOPMENT/);
  assert.match(r.result.clerkInstance, /100 users/);
});
