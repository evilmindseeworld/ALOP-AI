'use strict';

/**
 * One in-flight execution per key; everybody else waits for it.
 *
 * WHY. Two users asking the same question inside the same few seconds — or one
 * user double-tapping send, or the brain pre-computing a question a live turn
 * has just asked — each ran a full council. The answer cache stops the SECOND
 * ask only once the FIRST has finished writing, and a council turn is measured
 * in seconds, so the whole window in which duplication is most likely is the
 * window the cache cannot cover.
 *
 * WHAT IT IS NOT. Not a cache: nothing is retained after the work settles, so
 * this can never serve a stale answer. Not a lock: a caller does not block, it
 * shares. Not distributed — one process, and that is stated rather than hidden:
 *
 * ponytail: per-PROCESS. Two instances asked the same question at the same
 * moment still run it twice. Making it cross-process means a Postgres advisory
 * lock on the request path, which costs a round trip on EVERY turn to save a
 * duplicate on the rare one. Revisit when the duplicate rate is measured, not
 * before.
 *
 * THE SHARING IS THE RISKY PART, so two things are deliberately NOT shared:
 *
 *   - **Anything scoped to one user.** The key is the caller's to build, and a
 *     key that omits the tenant would hand one user's answer to another. The
 *     same rule the answer cache lives by; `keyFor` there is the model.
 *   - **Cancellation.** A follower that goes away must not abort the work the
 *     leader is still waiting on, and a leader that goes away must not strand
 *     the followers. Each caller keeps its own signal; `run` rejects for the
 *     caller that aborted and nobody else.
 */

/** Nothing waits forever. A leader that hangs must not hang its followers. */
const DEFAULT_MAX_WAIT_MS = 120_000;

function createSingleFlight({ maxWaitMs = DEFAULT_MAX_WAIT_MS, now = Date.now } = {}) {
  /** key -> { promise, startedAt, followers } */
  const inFlight = new Map();
  const stats = { leaders: 0, followers: 0, timeouts: 0 };

  /**
   * @param {string} key       must already carry every dimension that changes
   *                           the answer, tenant included.
   * @param {() => Promise<any>} work
   * @param {{signal?: AbortSignal}} [opts]
   * @returns {Promise<any>} whatever `work` resolved to, plus `{shared: true}`
   *          reported through `onShare` for the callers that did not run it.
   */
  const run = async (key, work, { signal, onShare } = {}) => {
    if (typeof key !== 'string' || !key) return work();

    const existing = inFlight.get(key);
    if (existing && now() - existing.startedAt < maxWaitMs) {
      existing.followers += 1;
      stats.followers += 1;
      try { onShare?.({ key, waitedMs: now() - existing.startedAt }); } catch { /* diagnostics only */ }
      /* THE FOLLOWER'S OWN ABORT, and it is a race rather than a chain. The
       * leader's work is left running: other followers may still want it, and
       * the leader itself certainly does. */
      if (!signal) return existing.promise;
      return Promise.race([
        existing.promise,
        new Promise((_, reject) => {
          if (signal.aborted) return reject(signal.reason || new Error('Aborted'));
          signal.addEventListener('abort', () => reject(signal.reason || new Error('Aborted')), { once: true });
        }),
      ]);
    }

    /* A leader older than the ceiling is treated as gone. Counted, because a
     * non-zero number here means work is hanging rather than that sharing is
     * working. */
    if (existing) stats.timeouts += 1;

    stats.leaders += 1;
    const entry = { startedAt: now(), followers: 0 };
    /* The promise is registered BEFORE `work` is called. `work()` may resolve
     * synchronously — a cache hit inside it, a rejected precondition — and a
     * caller arriving in that same tick must find the entry, not miss it. */
    entry.promise = (async () => {
      try {
        return await work();
      } finally {
        /* Only if it is still OURS. A leader that timed out and was replaced
         * must not delete its successor's entry on the way out. */
        if (inFlight.get(key) === entry) inFlight.delete(key);
      }
    })();
    inFlight.set(key, entry);
    return entry.promise;
  };

  return {
    run,
    inFlightCount: () => inFlight.size,
    stats: () => ({ ...stats, inFlight: inFlight.size }),
    /** For shutdown and for tests. Does not cancel anything; only forgets. */
    clear: () => inFlight.clear(),
  };
}

module.exports = { createSingleFlight, DEFAULT_MAX_WAIT_MS };
