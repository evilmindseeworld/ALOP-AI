const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCommands, TRACKED_ENV, SHOWABLE } = require("./admin-commands");

/**
 * A Supabase stand-in.
 *
 * `select()` is thenable so a head:true count query resolves directly, and
 * carries the chain methods the commands actually use. `eq` returns the same
 * object rather than filtering: these tests supply exactly the rows a query
 * should see, so filtering here would just re-implement Postgres badly and
 * test the fake instead of the command.
 */
const fakeSupabase = (over = {}) => ({
  from: (table) => {
    const result = over[table] || { count: 7, error: null, data: [] };
    const chain = {
      then: (res) => res(result),
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => Promise.resolve(result),
    };
    return { select: () => chain };
  },
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

// ===== council tool-loop health =====

const councilRows = (rows) => ({
  audit_logs: { data: rows.map((metadata) => ({ action: "council.tools", metadata, created_at: "2026-08-05T12:00:00Z" })), error: null },
});

test("aggregates tool-loop turns into a dedupe ratio", async () => {
  // Seven members, two unique calls: the dedupe collapsed five overlapping
  // requests. That ratio is the whole reason the design works.
  const c = buildCommands({
    supabase: fakeSupabase(councilRows([
      { rounds: 2, uniqueCalls: 2, members: 7, answered: 7, usable: 6, fellBack: false, tools: { web_search: 2 } },
      { rounds: 2, uniqueCalls: 3, members: 7, answered: 7, usable: 7, fellBack: false, tools: { web_search: 2, read_url: 1 } },
    ])),
    env: {},
    proc: process,
  });
  const r = await c.run("council");
  assert.equal(r.result.turns, 2);
  assert.equal(r.result.avgUniqueCalls, 2.5);
  assert.equal(r.result.callsPerMember, 0.36);
  assert.deepEqual(r.result.toolsUsed, { web_search: 4, read_url: 1 });
  assert.equal(r.result.verdict, "Healthy.");
});

test("CALLS THE DEDUPE OUT WHEN IT IS NOT EARNING ITS PLACE", async () => {
  // Seven members, seven unique calls, every turn: nothing is collapsing and
  // the loop costs seven searches to do one member's worth of research.
  const c = buildCommands({
    supabase: fakeSupabase(councilRows([
      { rounds: 2, uniqueCalls: 7, members: 7, fellBack: false, tools: { web_search: 7 } },
    ])),
    env: {},
    proc: process,
  });
  const r = await c.run("council");
  assert.equal(r.result.callsPerMember, 1);
  assert.match(r.result.verdict, /DEDUPE IS NOT EARNING ITS PLACE/);
});

test("names the case where no tool was ever called", async () => {
  const c = buildCommands({
    supabase: fakeSupabase(councilRows([{ rounds: 1, uniqueCalls: 0, members: 7, fellBack: false, tools: {} }])),
    env: {},
    proc: process,
  });
  assert.match((await c.run("council")).result.verdict, /No tool was ever called/);
});

test("flags frequent fallbacks to the plain council", async () => {
  const rows = Array.from({ length: 4 }, (_, i) => ({
    rounds: 2, uniqueCalls: 2, members: 7, fellBack: i < 2, tools: { web_search: 2 },
  }));
  const c = buildCommands({ supabase: fakeSupabase(councilRows(rows)), env: {}, proc: process });
  const r = await c.run("council");
  assert.equal(r.result.fellBackToPlainCouncil, "2 of 4");
  assert.match(r.result.verdict, /Falling back/);
});

test("says plainly when there is nothing recorded, rather than reporting zeros as health", async () => {
  const c = buildCommands({ supabase: fakeSupabase(councilRows([])), env: {}, proc: process });
  const r = await c.run("council");
  assert.equal(r.result.turns, 0);
  assert.match(r.result.note, /COUNCIL_TOOLS is not 1/);
});

test("reports time-to-first-byte as percentiles, not a mean", async () => {
  // One cold start at 22s drags a mean somewhere no real request ever was.
  // The median is what a user actually experiences.
  const c = buildCommands({
    supabase: fakeSupabase(councilRows([
      { msToFirstByte: 1200, rounds: 1, uniqueCalls: 1, members: 7, tools: {} },
      { msToFirstByte: 1400, rounds: 1, uniqueCalls: 1, members: 7, tools: {} },
      { msToFirstByte: 1500, rounds: 1, uniqueCalls: 1, members: 7, tools: {} },
      { msToFirstByte: 22000, rounds: 1, uniqueCalls: 1, members: 7, tools: {} },
    ])),
    env: {}, proc: process,
  });
  const r = await c.run("council");
  assert.equal(r.result.msToFirstByteMedian, 1500);
  assert.equal(r.result.msToFirstByteWorst, 22000);
});

test("reports the phase and per-seat telemetry from structured turn rows", async () => {
  const c = buildCommands({
    supabase: fakeSupabase(councilRows([
      {
        telemetry: "council_turn",
        turnMs: 9100,
        contextMs: 500,
        routerReads: { memory: { ms: 120, ok: true }, search: { ms: 80, ok: true } },
        synthesisMs: 1800,
        toolMs: 2400,
        seats: [
          { model: "fast", ms: 900, outcome: "answered" },
          { model: "slow", ms: 4200, outcome: "answered" },
        ],
        ceiling: { hit: true, reason: "council_whip" },
        fallbackCouncil: { used: true, durationMs: 700 },
      },
      {
        telemetry: "council_turn",
        turnMs: 1200,
        contextMs: 100,
        routerReads: { memory: { ms: 20, ok: true } },
        synthesisMs: 300,
        toolMs: 0,
        seats: [{ model: "fast", ms: 500, outcome: "answered" }],
        fallbackCouncil: { used: false },
      },
    ])),
    env: {}, proc: process,
  });
  const r = await c.run("council");
  assert.equal(r.result.turnMsMedian, 9100);
  assert.equal(r.result.turnMsP90, 9100);
  assert.equal(r.result.synthesisMsMedian, 1800);
  assert.equal(r.result.contextMsP90, 500);
  assert.equal(r.result.routerMsP90, 200);
  assert.equal(r.result.toolMsP90, 2400);
  assert.equal(r.result.seatMsP90ByModel.fast, 900);
  assert.equal(r.result.seatMsP90ByModel.slow, 4200);
  assert.deepEqual(r.result.slowestSeatByModel, { slow: 1, fast: 1 });
  assert.equal(r.result.postCouncilFallbacks, 1);
  assert.equal(r.result.hitACeiling, "1 of 2");
});

test("turns with no timing recorded do not break the percentiles", async () => {
  // Rows written before msToFirstByte existed.
  const c = buildCommands({
    supabase: fakeSupabase(councilRows([
      { rounds: 1, uniqueCalls: 1, members: 7, tools: {} },
      { msToFirstByte: 900, rounds: 1, uniqueCalls: 1, members: 7, tools: {} },
    ])),
    env: {}, proc: process,
  });
  const r = await c.run("council");
  assert.equal(r.result.msToFirstByteMedian, 900);
});
