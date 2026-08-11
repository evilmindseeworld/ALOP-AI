const test = require("node:test");
const assert = require("node:assert/strict");
const { createSearchCache, hashQuery, comprehensiveSearchKey } = require("./search-cache");

/**
 * A Supabase stand-in that records what it was asked to do.
 *
 * `rows` is keyed by query_hash, so a test seeds L2 the same way a previous
 * process would have left it — which is the whole scenario this cache exists
 * for and the one a per-process Map cannot reach.
 */
const fakeDb = ({ rows = {}, readDelay = 0, readError = null, writeRejects = false, throwOnFrom = false, sweepThrows = false } = {}) => {
  const calls = { reads: 0, writes: 0, sweeps: 0, wrote: [] };
  const db = {
    calls,
    rows,
    rpc: (name) => {
      if (name === "sweep_search_cache") calls.sweeps++;
      if (sweepThrows) throw new Error("client not configured");
      return Promise.resolve({ data: 0, error: null });
    },
    from: () => {
      if (throwOnFrom) throw new Error("client not configured");
      return {
        select: () => ({
          eq: (_col, key) => ({
            maybeSingle: () => {
              calls.reads++;
              const settle = () =>
                readError ? { data: null, error: readError } : { data: rows[key] || null, error: null };
              return readDelay
                ? new Promise((r) => setTimeout(() => r(settle()), readDelay))
                : Promise.resolve(settle());
            },
          }),
        }),
        upsert: (row) => {
          calls.writes++;
          calls.wrote.push(row);
          rows[row.query_hash] = { payload: row.payload, expires_at: row.expires_at };
          return writeRejects ? Promise.reject(new Error("connection reset")) : Promise.resolve({ error: null });
        },
      };
    },
  };
  return db;
};

const seed = (query, payload, expiresInMs = 60_000) => ({
  [hashQuery(query)]: { payload, expires_at: new Date(Date.now() + expiresInMs).toISOString() },
});

const silent = { warn: () => {} };

// ===== the reason this exists =====

test("A HIT SURVIVES THE PROCESS THAT WROTE IT", async () => {
  // The actual problem: Render redeploys on every push, the Map dies with the
  // process, and the first person after a deploy pays the full fan-out for a
  // question answered ten minutes ago. A fresh cache against a warm table is
  // exactly that person.
  const db = fakeDb({ rows: seed("best monitor uae", { sources: 15 }) });
  const cache = createSearchCache({ supabase: db, log: silent });

  assert.deepEqual(await cache.get("best monitor uae"), { sources: 15 });
  assert.equal(cache.stats().hitsL2, 1);
});

test("an L2 hit is promoted, so the next asker does not pay the round trip", async () => {
  const db = fakeDb({ rows: seed("q", { a: 1 }) });
  const cache = createSearchCache({ supabase: db, log: silent });

  await cache.get("q");
  await cache.get("q");
  await cache.get("q");

  assert.equal(db.calls.reads, 1, "only the first read should reach the database");
  assert.equal(cache.stats().hitsL1, 2);
});

test("a miss is null, not an error", async () => {
  const cache = createSearchCache({ supabase: fakeDb(), log: silent });
  assert.equal(await cache.get("never asked"), null);
  assert.equal(cache.stats().misses, 1);
});

// ===== never throws, whatever the database does =====

test("AN UNREACHABLE DATABASE IS A MISS, NOT A FAILED QUESTION", async () => {
  // Degrading to "do the search" costs a search that was going to happen.
  // Failing the turn because an optimisation was unavailable would be worse
  // than never having built it.
  const cache = createSearchCache({ supabase: fakeDb({ readError: { message: "relation does not exist" } }), log: silent });
  assert.equal(await cache.get("q"), null);
  assert.equal(cache.stats().errors, 1);
});

test("a client that throws synchronously is a miss", async () => {
  const cache = createSearchCache({ supabase: fakeDb({ throwOnFrom: true }), log: silent });
  await assert.doesNotReject(() => cache.get("q"));
  assert.equal(await cache.get("q"), null);
});

test("A WRITE THAT REJECTS DOES NOT CRASH THE PROCESS", async () => {
  // set() is deliberately not awaited, so a rejection with nobody listening is
  // an unhandled rejection — a process-level event in Node, and in production
  // a crash caused by a cache write.
  const seen = [];
  const onUnhandled = (e) => seen.push(e);
  process.on("unhandledRejection", onUnhandled);

  const cache = createSearchCache({ supabase: fakeDb({ writeRejects: true }), log: silent });
  cache.set("q", { a: 1 });
  await new Promise((r) => setTimeout(r, 60));

  process.off("unhandledRejection", onUnhandled);
  assert.deepEqual(seen, []);
});

test("a failed L2 write still leaves a usable in-memory entry", async () => {
  const cache = createSearchCache({ supabase: fakeDb({ writeRejects: true }), log: silent });
  cache.set("q", { a: 1 });
  assert.deepEqual(await cache.get("q"), { a: 1 });
});

test("works with no database at all", async () => {
  const cache = createSearchCache({ log: silent });
  cache.set("q", { a: 1 });
  assert.deepEqual(await cache.get("q"), { a: 1 });
  assert.equal(await cache.get("other"), null);
});

// ===== the leash =====

test("A SLOW READ IS ABANDONED RATHER THAN WAITED ON", async () => {
  // A cache read that takes longer than the search it avoids is a
  // pessimisation. Below the deadline it is a hit; above it, a miss.
  const db = fakeDb({ rows: seed("q", { a: 1 }), readDelay: 400 });
  const cache = createSearchCache({ supabase: db, readDeadlineMs: 60, log: silent });

  const started = Date.now();
  assert.equal(await cache.get("q"), null);
  assert.ok(Date.now() - started < 250, "should not have waited for the slow read");
});

test("set() returns without waiting for the write", () => {
  const db = fakeDb({ writeRejects: false });
  const cache = createSearchCache({ supabase: db, log: silent });
  const started = Date.now();
  cache.set("q", { a: 1 });
  assert.ok(Date.now() - started < 50);
});

// ===== expiry =====

test("an expired row is not served even though it is still in the table", async () => {
  // Expiry is enforced on read as well as by the sweep, so a sweep that has
  // fallen behind cannot produce a stale answer.
  const db = fakeDb({ rows: seed("q", { a: 1 }, -1000) });
  const cache = createSearchCache({ supabase: db, log: silent });
  assert.equal(await cache.get("q"), null);
});

test("an expired memory entry falls through to L2 rather than being served", async () => {
  // The realistic version of this: two instances. This one cached an answer
  // and its copy went stale; the other refreshed the shared row in between.
  // The stale local copy must not win.
  let clock = 1_000_000;
  const db = fakeDb();
  const cache = createSearchCache({ supabase: db, ttlMs: 1000, now: () => clock, log: silent });

  cache.set("q", { stale: true });
  assert.deepEqual(await cache.get("q"), { stale: true });

  // The other instance writes a newer row, as it would have.
  db.rows[hashQuery("q")] = { payload: { fresh: true }, expires_at: new Date(clock + 60_000).toISOString() };

  clock += 5000; // the local copy's 1s TTL is long gone
  assert.deepEqual(await cache.get("q"), { fresh: true });
});

// ===== eviction =====

test("EVICTION IS LRU, NOT INSERTION ORDER", async () => {
  // The popular query is the one worth keeping, and it is also the one a
  // first-in-first-out cache evicts while the one-off that pushed it out
  // stays. Reading must count as use.
  const cache = createSearchCache({ memoryMax: 3, log: silent });
  cache.set("popular", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  await cache.get("popular"); // used again
  cache.set("d", 4); // evicts something

  assert.equal(await cache.get("popular"), 1, "the recently used entry should have survived");
  assert.equal(await cache.get("b"), null, "the least recently used entry should be gone");
});

test("the memory tier stays bounded under sustained writes", async () => {
  const cache = createSearchCache({ memoryMax: 10, log: silent });
  for (let i = 0; i < 500; i++) cache.set(`q${i}`, i);
  assert.equal(cache.stats().memoryEntries, 10);
});

// ===== keying =====

test("WIKI AND ORDINARY SEARCHES CANNOT SHARE A RESULT", () => {
  // `needsWiki` changes the provider set. Without it in the cache key, an
  // ordinary result could satisfy a Wikipedia-backed request before the
  // encyclopedia was ever consulted.
  assert.notEqual(
    comprehensiveSearchKey("what is a quasar", false),
    comprehensiveSearchKey("what is a quasar", true),
  );
  assert.match(comprehensiveSearchKey("q", false), /^comprehensive:web:/);
  assert.match(comprehensiveSearchKey("q", true), /^comprehensive:wiki:/);
});

test("the key is a hash, so an enormous query cannot blow the index", () => {
  const key = hashQuery("x".repeat(100_000));
  assert.equal(key.length, 64);
});

test("REGION IS PART OF THE QUERY, SO REGIONS CANNOT SERVE EACH OTHER", async () => {
  // The table is global on purpose — one person's search pays for the next
  // person's answer. That is only safe because getSearchQuery bakes the region
  // into the query string, making a UAE price query a different key.
  const cache = createSearchCache({ log: silent });
  cache.set("monitor price UAE", { price: "AED 2999" });
  assert.equal(await cache.get("monitor price US"), null);
});

test("query_text is truncated and the payload is not", () => {
  const db = fakeDb();
  const cache = createSearchCache({ supabase: db, log: silent });
  const big = "word ".repeat(500);
  cache.set(big, { sources: 15 });

  assert.ok(db.calls.wrote[0].query_text.length <= 500);
  assert.deepEqual(db.calls.wrote[0].payload, { sources: 15 });
});

test("a null payload is not cached", async () => {
  const db = fakeDb();
  const cache = createSearchCache({ supabase: db, log: silent });
  cache.set("q", null);
  cache.set("q2", undefined);
  assert.equal(db.calls.writes, 0);
});

// ===== housekeeping =====

test("the sweep runs periodically, not on every write", () => {
  const db = fakeDb();
  const cache = createSearchCache({ supabase: db, sweepEveryWrites: 5, log: silent });
  for (let i = 0; i < 12; i++) cache.set(`q${i}`, i);
  assert.equal(db.calls.sweeps, 2, "12 writes at every-5 should sweep twice");
});

test("a sweep that throws synchronously does not fail the cache write", async () => {
  const cache = createSearchCache({ supabase: fakeDb({ sweepThrows: true }), sweepEveryWrites: 1, log: silent });
  assert.doesNotThrow(() => cache.set("q", { a: 1 }));
  assert.deepEqual(await cache.get("q"), { a: 1 });
  assert.equal(cache.stats().errors, 1);
});

test("A BROKEN TABLE IS REPORTED ONCE, NOT ON EVERY SEARCH", async () => {
  // Until migration 005 is applied this fails identically on every request.
  // One line per request buries everything else in the log; the log is the
  // only debugging tool the free tier has.
  const lines = [];
  const cache = createSearchCache({
    supabase: fakeDb({ readError: { message: 'relation "search_cache" does not exist' } }),
    log: { warn: (m) => lines.push(m) },
  });

  for (let i = 0; i < 20; i++) await cache.get(`q${i}`);

  assert.equal(lines.length, 1);
  assert.match(lines[0], /005_search_cache\.sql/, "must name the fix, not just the symptom");
  assert.equal(cache.stats().errors, 20, "the count is still accurate even though the log is quiet");
});
