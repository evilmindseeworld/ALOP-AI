const test = require("node:test");
const assert = require("node:assert/strict");
const { PostgresStore } = require("./pg-rate-limit-store");

const okRpc = (hits, resetAt = new Date(Date.now() + 60_000).toISOString()) =>
  async () => ({ data: [{ total_hits: hits, reset_at: resetAt }], error: null });

const silent = () => {};

test("returns the count and reset time the database reported", async () => {
  const store = new PostgresStore({ prefix: "t:", rpc: okRpc(3), onError: silent });
  const r = await store.increment("ip:1.2.3.4");
  assert.equal(r.totalHits, 3);
  assert.ok(r.resetTime instanceof Date);
});

test("passes the limiter's own window through, not a hardcoded one", () => {
  // Each limiter has a different window — 60s for the floor, 300s for billing.
  // A store that always sent 60s would give the billing limiter the wrong one.
  let sent = null;
  const store = new PostgresStore({ prefix: "t:", rpc: async (_fn, args) => { sent = args; return okRpc(1)(); }, onError: silent });
  store.init({ windowMs: 300_000 });
  return store.increment("k").then(() => assert.equal(sent.p_window_ms, 300_000));
});

test("defaults the window when init is never called", async () => {
  let sent = null;
  const store = new PostgresStore({ prefix: "t:", rpc: async (_fn, args) => { sent = args; return okRpc(1)(); }, onError: silent });
  await store.increment("k");
  assert.equal(sent.p_window_ms, 60_000);
});

test("keys are stringified, because express-rate-limit does not promise a string", async () => {
  let sent = null;
  const store = new PostgresStore({ prefix: "t:", rpc: async (_fn, args) => { sent = args; return okRpc(1)(); }, onError: silent });
  await store.increment(12345);
  assert.equal(sent.p_key, "t:12345", "the key is stringified under this limiter's prefix");
});

// ===== the decision that matters =====

test("A DATABASE ERROR FAILS OPEN, AND SAYS SO", async () => {
  // Failing closed would convert a partial dependency failure into a total
  // outage: a Supabase blip would 429 every request on every endpoint. The
  // limits here protect against cost and abuse, not data loss.
  const logged = [];
  const store = new PostgresStore({
    prefix: "t:",
    rpc: async () => ({ data: null, error: { message: "connection refused" } }),
    onError: (m) => logged.push(m),
  });

  const r = await store.increment("k");

  assert.equal(r.totalHits, 0, "0 is below every limit, so the request proceeds");
  assert.ok(r.resetTime instanceof Date);
  assert.equal(logged.length, 1, "a limiter that stopped limiting must not be quiet about it");
  assert.match(logged[0], /FAILING OPEN/);
});

test("a thrown rpc fails open too, not just a returned error", async () => {
  const logged = [];
  const store = new PostgresStore({
    prefix: "t:",
    rpc: async () => { throw new Error("ETIMEDOUT"); },
    onError: (m) => logged.push(m),
  });
  assert.equal((await store.increment("k")).totalHits, 0);
  assert.match(logged[0], /ETIMEDOUT/);
});

test("a malformed result fails open rather than being trusted", async () => {
  // A row without total_hits would otherwise become NaN, and NaN compares false
  // against every limit — failing open by accident instead of by decision.
  for (const data of [null, [], [{}], [{ total_hits: "abc" }], "nonsense"]) {
    const logged = [];
    const store = new PostgresStore({ prefix: "t:", rpc: async () => ({ data, error: null }), onError: (m) => logged.push(m) });
    const r = await store.increment("k");
    assert.equal(r.totalHits, 0, JSON.stringify(data));
    assert.equal(logged.length, 1, JSON.stringify(data));
  }
});

test("a missing reset_at still yields a usable date", async () => {
  const store = new PostgresStore({ prefix: "t:", rpc: async () => ({ data: [{ total_hits: 2 }], error: null }), onError: silent });
  const r = await store.increment("k");
  assert.equal(r.totalHits, 2);
  assert.ok(r.resetTime instanceof Date && !Number.isNaN(r.resetTime.getTime()));
});

// ===== decrement =====

test("decrement calls the database and swallows failure", async () => {
  let called = null;
  const store = new PostgresStore({ prefix: "t:", rpc: async (fn, args) => { called = [fn, args]; return { error: null }; }, onError: silent });
  await store.decrement("k");
  assert.equal(called[0], "decrement_rate_limit");
  assert.equal(called[1].p_key, "t:k");
});

test("a failed decrement is logged but never thrown", async () => {
  // Nothing to fall back to, and an un-decremented counter only makes the limit
  // stricter — the safe direction to be wrong in.
  const logged = [];
  const store = new PostgresStore({ prefix: "t:", rpc: async () => { throw new Error("nope"); }, onError: (m) => logged.push(m) });
  await assert.doesNotReject(() => store.decrement("k"));
  assert.equal(logged.length, 1);
});

test("resetKey never throws", async () => {
  const store = new PostgresStore({ prefix: "t:", rpc: async () => { throw new Error("nope"); }, onError: silent });
  await assert.doesNotReject(() => store.resetKey("k"));
});

test("refuses to construct without an rpc function", () => {
  assert.throws(() => new PostgresStore({}), TypeError);
  assert.throws(() => new PostgresStore({ prefix: "t:", rpc: "not a function" }), TypeError);
});

// ===== the counting behaviour the SQL is responsible for =====

test("the store reports whatever the window logic decided, without second-guessing it", async () => {
  // The restart-after-expiry rule lives in the SQL function, in one statement,
  // so it cannot race. This asserts the store does not layer its own logic on
  // top — a second opinion here is how the two disagree.
  const store = new PostgresStore({ prefix: "t:", rpc: okRpc(1), onError: silent });
  assert.equal((await store.increment("k")).totalHits, 1);

  const climbing = new PostgresStore({ prefix: "t:", rpc: okRpc(119), onError: silent });
  assert.equal((await climbing.increment("k")).totalHits, 119);
});

// ===== one table, many limiters =====
//
// Every limiter gets its OWN PostgresStore instance, but they all write to the
// same `rate_limits` table. Without a per-limiter prefix, the `/api/` floor
// (120/min) and `/api/council` (30/min) increment the same row for the same
// user, so one council request counts twice and the two limits eat each
// other's budget. express-rate-limit sees the same thing from the other side:
// its `singleCount` validation keys a shared store by constructor name plus
// `store.prefix`, so two unprefixed PostgresStores look like one store
// counting one key twice in a single request.

test("every key is written under the limiter's own prefix", async () => {
  const sent = [];
  const store = new PostgresStore({
    prefix: "council:",
    rpc: async (_fn, args) => { sent.push(args); return okRpc(1)(); },
    onError: silent,
  });
  await store.increment("u:abc");
  await store.decrement("u:abc");
  await store.resetKey("u:abc");
  assert.deepEqual(sent.map((a) => a.p_key), ["council:u:abc", "council:u:abc", "council:u:abc"]);
});

test("two limiters cannot collide on one user's key", async () => {
  const keys = [];
  const make = (prefix) => new PostgresStore({
    prefix,
    rpc: async (_fn, args) => { keys.push(args.p_key); return okRpc(1)(); },
    onError: silent,
  });
  await make("floor:").increment("u:abc");
  await make("council:").increment("u:abc");
  assert.equal(new Set(keys).size, 2, "the floor and the council limiter shared a counter row");
});

test("the store declares itself shared, which is what express-rate-limit checks", () => {
  const store = new PostgresStore({ prefix: "p:", rpc: async () => okRpc(1)(), onError: silent });
  assert.equal(store.localKeys, false, "a Postgres-backed store is not process-local");
  assert.equal(store.prefix, "p:", "express-rate-limit reads store.prefix in its double-count check");
});

test("refuses to construct without a prefix, because an unprefixed store silently shares rows", () => {
  assert.throws(() => new PostgresStore({ rpc: async () => {} }), TypeError);
  assert.throws(() => new PostgresStore({ rpc: async () => {}, prefix: "" }), TypeError);
});
