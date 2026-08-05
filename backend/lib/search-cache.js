const crypto = require("node:crypto");
const { settleByDeadline } = require("./deadline");

/**
 * A search cache that survives a deploy.
 *
 * THE PROBLEM. The cache was a 50-entry Map in the process with a 5 minute
 * TTL. Render redeploys on every push, and a redeploy is a new process, so in
 * practice the cache was almost always empty and the first person after any
 * deploy paid the full search for a question already answered minutes ago.
 *
 * THE SHAPE. Two tiers, because they fail differently and are good at
 * different things:
 *
 *   L1, the Map. Free, synchronous, and dies with the process.
 *   L2, Postgres. Survives deploys and is shared across instances, and costs a
 *       round trip.
 *
 * A read checks L1, then L2, and promotes an L2 hit into L1 so the second
 * asker does not pay the round trip either.
 *
 * THREE RULES THAT MATTER MORE THAN THE HIT RATE:
 *
 *   IT NEVER THROWS. This is a cache. A database that is slow, unreachable or
 *   missing the table entirely must degrade to "cache miss", which costs a
 *   search that would have happened anyway. Failing a user's question because
 *   an OPTIMISATION was unavailable would be worse than not having built it.
 *
 *   READS ARE ON A LEASH. A cache read that takes longer than the search it is
 *   avoiding is a pessimisation. The read gets a deadline well under the
 *   fan-out's, and a slow L2 is treated as a miss.
 *
 *   WRITES ARE NEVER AWAITED. Nothing about producing the answer depends on
 *   the write landing, so blocking on it would add latency to the exact path
 *   this exists to speed up.
 */

const DEFAULTS = {
  ttlMs: 15 * 60 * 1000,
  memoryMax: 200,
  // Well under the 3500ms search deadline. A cache is only worth consulting if
  // consulting it is much cheaper than the thing it replaces.
  readDeadlineMs: 400,
  // Expired rows are ignored on read, so the sweep is pure housekeeping and
  // can be rare. Counter rather than a random draw so a test can trigger it.
  sweepEveryWrites: 50,
};

const hash = (q) => crypto.createHash("sha256").update(String(q)).digest("hex");

function createSearchCache({ supabase, log = console, ...opts } = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const now = opts.now || (() => Date.now());
  const memory = new Map();
  let writesSinceSweep = 0;
  const stats = { hitsL1: 0, hitsL2: 0, misses: 0, errors: 0 };

  /* Report a persistence failure ONCE.
   *
   * The common cause is migration 005 not being applied yet, which fails
   * identically on every single search. Logged per-occurrence that is one line
   * per request drowning everything else in the log; logged never, a cache
   * that silently stopped persisting looks exactly like one that is working.
   * Once, naming the likely fix, is the version that is useful at 3am. */
  let warned = false;
  const warnOnce = (what, message) => {
    stats.errors++;
    if (warned) return;
    warned = true;
    log.warn?.(
      `[CACHE] ${what}: ${message}. Falling back to in-process cache only ` +
      `(this is not fatal). If this is "relation ... does not exist", apply ` +
      `migrations/005_search_cache.sql. Further cache errors are not logged.`,
    );
  };

  const readMemory = (key) => {
    const entry = memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      memory.delete(key);
      return null;
    }
    // Refresh recency: re-inserting moves the key to the end of the Map's
    // iteration order, which is what makes the eviction below LRU rather than
    // "whatever was written first", and the difference shows up exactly on the
    // popular queries this is meant to serve.
    memory.delete(key);
    memory.set(key, entry);
    return entry.data;
  };

  const writeMemory = (key, data, expiresAt) => {
    if (memory.has(key)) memory.delete(key);
    memory.set(key, { data, expiresAt });
    while (memory.size > cfg.memoryMax) {
      memory.delete(memory.keys().next().value);
    }
  };

  const sweep = () => {
    if (!supabase) return;
    if (++writesSinceSweep < cfg.sweepEveryWrites) return;
    writesSinceSweep = 0;
    Promise.resolve(supabase.rpc("sweep_search_cache")).catch(() => {});
  };

  return {
    /** @returns {Promise<*|null>} the cached payload, or null for any miss. */
    async get(query) {
      const key = hash(query);

      const local = readMemory(key);
      if (local !== null) {
        stats.hitsL1++;
        return local;
      }
      if (!supabase) {
        stats.misses++;
        return null;
      }

      let row = null;
      try {
        // settleByDeadline rather than a hand-rolled Promise.race: it already
        // swallows a rejection that lands after the deadline, which is the
        // difference between a slow query and an unhandled rejection.
        const { results } = await settleByDeadline(
          [{
            promise: supabase
              .from("search_cache")
              .select("payload, expires_at")
              .eq("query_hash", key)
              .maybeSingle(),
            fallback: null,
          }],
          { deadlineMs: cfg.readDeadlineMs },
        );
        row = results[0];
      } catch (e) {
        // settleByDeadline does not reject, so reaching here means the query
        // builder itself threw synchronously — a misconfigured client. Still a
        // miss, never an error the caller sees.
        warnOnce("read threw", e.message);
        return null;
      }

      if (!row || row.error || !row.data) {
        if (row?.error) warnOnce("read failed", row.error.message);
        else stats.misses++;
        return null;
      }

      const expiresAt = new Date(row.data.expires_at).getTime();
      // Expiry is enforced here and not only in the sweep, so a table the
      // sweep has fallen behind on still cannot serve a stale answer.
      if (!(expiresAt > now())) {
        stats.misses++;
        return null;
      }

      stats.hitsL2++;
      writeMemory(key, row.data.payload, expiresAt);
      return row.data.payload;
    },

    /** Fire and forget. Returns immediately; the caller never waits on L2. */
    set(query, data) {
      if (data === undefined || data === null) return;
      const key = hash(query);
      const expiresAt = now() + cfg.ttlMs;
      writeMemory(key, data, expiresAt);
      if (!supabase) return;

      try {
        Promise.resolve(
          supabase.from("search_cache").upsert(
            {
              query_hash: key,
              // Truncated because nothing reads it to make a decision and an
              // unbounded user-derived string does not belong in a column kept
              // purely for debugging.
              query_text: String(query).slice(0, 500),
              payload: data,
              expires_at: new Date(expiresAt).toISOString(),
            },
            { onConflict: "query_hash" },
          ),
        ).catch((e) => warnOnce("write failed", e.message));
      } catch (e) {
        warnOnce("write threw", e.message);
      }
      sweep();
    },

    stats: () => ({ ...stats, memoryEntries: memory.size }),
    /** Test seam; also what a deploy would do if the cache ever served junk. */
    clearMemory: () => memory.clear(),
  };
}

module.exports = { createSearchCache, hashQuery: hash };
