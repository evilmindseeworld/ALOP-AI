const test = require("node:test");
const assert = require("node:assert/strict");
const { PostgresStore } = require("./pg-rate-limit-store");

const okRpc = (hits, resetAt = new Date(Date.now() + 60_000).toISOString()) =>
  async () => ({ data: [{ total_hits: hits, reset_at: resetAt }], error: null });

const silent = () => {};

test("returns the count and reset time the database reported", async () => {
  const store = new PostgresStore({ rpc: okRpc(3), onError: silent });
  const r = await store.increment("ip:1.2.3.4");
  assert.equal(r.totalHits, 3);
  assert.ok(r.resetTime instanceof Date);
});

test("passes the limiter's own window through, not a hardcoded one", () => {
  // Each limiter has a different window — 60s for the floor, 300s for billing.
  // A store that always sent 60s would give the billing limiter the wrong one.
  let sent = null;
  const store = new PostgresStore({ rpc: async (_fn, args) => { sent = args; return okRpc(1)(); }, onError: silent });
  store.init({ windowMs: 300_000 });
  return store.increment("k").then(() => assert.equal(sent.p_window_ms, 300_000));
});

test("defaults the window when init is never called", async () => {
  let sent = null;
  const store = new PostgresStore({ rpc: async (_fn, args) => { sent = args; return okRpc(1)(); }, onError: silent });
  await store.increment("k");
  assert.equal(sent.p_window_ms, 60_000);
});

test("keys are stringified, because express-rate-limit does not promise a string", async () => {
  let sent = null;
  const store = new PostgresStore({ rpc: async (_fn, args) => { sent = args; return okRpc(1)(); }, onError: silent });
  await store.increment(12345);
  assert.equal(sent.p_key, "12345");
});

// ===== the decision that matters =====

test("A DATABASE ERROR FAILS OPEN, AND SAYS SO", async () => {
  // Failing closed would convert a partial dependency failure into a total
  // outage: a Supabase blip would 429 every request on every endpoint. The
  // limits here protect against cost and abuse, not data loss.
  const logged = [];
  const store = new PostgresStore({
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
    const store = new PostgresStore({ rpc: async () => ({ data, error: null }), onError: (m) => logged.push(m) });
    const r = await store.increment("k");
    assert.equal(r.totalHits, 0, JSON.stringify(data));
    assert.equal(logged.length, 1, JSON.stringify(data));
  }
});

test("a missing reset_at still yields a usable date", async () => {
  const store = new PostgresStore({ rpc: async () => ({ data: [{ total_hits: 2 }], error: null }), onError: silent });
  const r = await store.increment("k");
  assert.equal(r.totalHits, 2);
  assert.ok(r.resetTime instanceof Date && !Number.isNaN(r.resetTime.getTime()));
});

// ===== decrement =====

test("decrement calls the database and swallows failure", async () => {
  let called = null;
  const store = new PostgresStore({ rpc: async (fn, args) => { called = [fn, args]; return { error: null }; }, onError: silent });
  await store.decrement("k");
  assert.equal(called[0], "decrement_rate_limit");
  assert.equal(called[1].p_key, "k");
});

test("a failed decrement is logged but never thrown", async () => {
  // Nothing to fall back to, and an un-decremented counter only makes the limit
  // stricter — the safe direction to be wrong in.
  const logged = [];
  const store = new PostgresStore({ rpc: async () => { throw new Error("nope"); }, onError: (m) => logged.push(m) });
  await assert.doesNotReject(() => store.decrement("k"));
  assert.equal(logged.length, 1);
});

test("resetKey never throws", async () => {
  const store = new PostgresStore({ rpc: async () => { throw new Error("nope"); }, onError: silent });
  await assert.doesNotReject(() => store.resetKey("k"));
});

test("refuses to construct without an rpc function", () => {
  assert.throws(() => new PostgresStore({}), TypeError);
  assert.throws(() => new PostgresStore({ rpc: "not a function" }), TypeError);
});

// ===== the counting behaviour the SQL is responsible for =====

test("the store reports whatever the window logic decided, without second-guessing it", async () => {
  // The restart-after-expiry rule lives in the SQL function, in one statement,
  // so it cannot race. This asserts the store does not layer its own logic on
  // top — a second opinion here is how the two disagree.
  const store = new PostgresStore({ rpc: okRpc(1), onError: silent });
  assert.equal((await store.increment("k")).totalHits, 1);

  const climbing = new PostgresStore({ rpc: okRpc(119), onError: silent });
  assert.equal((await climbing.increment("k")).totalHits, 119);
});
