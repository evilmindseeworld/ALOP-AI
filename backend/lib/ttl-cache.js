/* A time-boxed Map, and nothing more.
 *
 * Two call sites in server.js needed the same shape and neither justified a
 * dependency: the `users` row read by checkSuspended on every authenticated
 * request, and the throttle that stops refreshProfile calling Clerk once per
 * request. lib/search-cache.js is not that shape — it is a two-tier cache
 * backed by Postgres because a search result must survive a redeploy. These
 * two must NOT survive a redeploy: a fresh process reading the row again is
 * exactly the correct behaviour.
 *
 * Expiry is lazy — checked on read, not on a timer. A timer would keep the
 * event loop alive and would have to be unref'd in tests; a read-time check
 * costs one comparison and cannot leak a handle. The size cap is enforced on
 * write by evicting the oldest insertion, which Map iteration order gives for
 * free.
 */
const createTtlCache = ({ ttlMs, maxEntries = 5000 } = {}) => {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('ttlMs must be a positive number');
  const store = new Map();

  const get = (key) => {
    const hit = store.get(key);
    if (!hit) return undefined;
    if (Date.now() >= hit.expires) { store.delete(key); return undefined; }
    return hit.value;
  };

  /* Bumped by clear(). It exists for one race, and the race is a security one.
   *
   * A caller that reads a value from the source of truth, awaits, and then
   * caches what came back can be overtaken: an invalidation can commit and
   * clear DURING that await, and the older in-flight read then writes its now
   * stale value into an empty cache. The clear happened, and the stale entry
   * outlives it by the full TTL. For the `users` row that means a suspended or
   * deleted account keeps working.
   *
   * `setIfCurrent` takes the generation observed BEFORE the read began and
   * refuses the write if a clear has happened since. */
  let generation = 0;

  const set = (key, value) => {
    // Delete first so a re-set moves the key to the end of the insertion
    // order. Without this, refreshing a hot key leaves it at the front and the
    // eviction below throws away the entry that is being used most.
    store.delete(key);
    store.set(key, { value, expires: Date.now() + ttlMs });
    if (store.size > maxEntries) store.delete(store.keys().next().value);
  };

  // `has` is deliberately absent. A caller that asks "is it cached?" and then
  // reads it does two expiry checks with a gap in between, and the entry can
  // expire in the gap. `get` returning undefined is the only honest answer.
  return {
    get,
    set,
    setIfCurrent: (key, value, observedGeneration) => {
      if (observedGeneration !== generation) return false;
      set(key, value);
      return true;
    },
    delete: (key) => store.delete(key),
    clear: () => { generation += 1; store.clear(); },
    get generation() { return generation; },
    get size() { return store.size; },
  };
};

module.exports = { createTtlCache };
