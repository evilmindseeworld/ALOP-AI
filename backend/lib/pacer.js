'use strict';

/**
 * Three things that stop this product hurting itself, in one place because they
 * are one decision: may this call go out right now?
 *
 *   MINUTE PACING. OpenRouter's free tier limits requests per MINUTE as well as
 *   per day, and the per-minute limit is the one a council turn walks into: a
 *   seven-seat fan-out is seven requests in one instant. The existing handling
 *   is a RETRY after the 429 (lib/openrouter.js waits for `X-RateLimit-Reset`),
 *   which is correct and is also the expensive half — the request was made, the
 *   round trip was paid for, and the turn is now seconds slower. Pacing spends
 *   nothing to avoid the same outcome.
 *
 *   CONCURRENCY. Nothing bounded how many provider calls were in flight at
 *   once. Seven seats times however many turns are being served is a number
 *   with no ceiling in it, and the failure mode is not an error — it is every
 *   turn getting slower together while the graphs show a healthy service.
 *
 *   CIRCUIT BREAKING. A model that has failed its last N calls will fail the
 *   next one too, and every seat that waits out a whip on it costs the turn its
 *   whole deadline. The breaker refuses immediately, tries ONE call after a
 *   cool-off, and closes on success. Refusing forever is the failure this
 *   guards against as much as never refusing.
 *
 * WHY NOT IN provider-health.js. That module MEASURES and never decides; this
 * one decides and stores nothing about quality. Keeping the two apart is what
 * lets the health signal be consulted by a router that must not be gated by it
 * — see the note there about never dropping the last working seat.
 *
 * ponytail: per-PROCESS, like every other counter here. Two instances pace two
 * minutes' worth. Stated because the fix (a shared counter on the request path)
 * costs a round trip per call to save one that pacing already avoided.
 */

const DEFAULTS = {
  /** Requests per minute across all models. 0 disables pacing entirely. */
  perMinute: 0,
  /** Provider calls in flight at once. 0 disables the limit. */
  concurrency: 0,
  /** Consecutive failures that open a model's breaker. */
  failureThreshold: 5,
  /** How long a breaker stays open before letting one call probe. */
  cooldownMs: 30_000,
};

class CircuitOpenError extends Error {
  constructor(model, retryAt) {
    super(`Circuit open for ${model}`);
    this.name = 'CircuitOpenError';
    this.code = 'CIRCUIT_OPEN';
    this.model = model;
    this.retryAt = retryAt;
  }
}

function createPacer(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms, signal) => new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  }));

  /* Timestamps of calls admitted in the last minute. An array rather than a
   * token bucket because the question asked of it is "when does the oldest of
   * the last N fall out of the window", which a bucket cannot answer and which
   * is exactly how long a caller should wait. */
  let minuteWindow = [];
  let inFlight = 0;
  const waiters = [];
  /** model -> { failures, openedAt, halfOpen } */
  const breakers = new Map();
  const stats = { admitted: 0, paced: 0, queued: 0, refused: 0, opened: 0, closed: 0 };

  const breakerFor = (model) => {
    const key = String(model || 'unknown');
    let b = breakers.get(key);
    if (!b) { b = { failures: 0, openedAt: null, halfOpen: false }; breakers.set(key, b); }
    return b;
  };

  /** The breaker's own view, without changing it. */
  const breakerState = (model) => {
    const b = breakers.get(String(model || 'unknown'));
    if (!b || b.openedAt == null) return 'closed';
    if (now() - b.openedAt >= config.cooldownMs) return 'half-open';
    return 'open';
  };

  const releaseOne = () => {
    inFlight -= 1;
    const next = waiters.shift();
    if (next) { inFlight += 1; next(); }
  };

  const takeSlot = async (signal) => {
    if (!config.concurrency) return () => {};
    if (inFlight < config.concurrency) {
      inFlight += 1;
      return releaseOne;
    }
    stats.queued += 1;
    await new Promise((resolve, reject) => {
      const onAbort = () => {
        const index = waiters.indexOf(admit);
        if (index !== -1) waiters.splice(index, 1);
        reject(signal.reason || new Error('Aborted'));
      };
      const admit = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      waiters.push(admit);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    return releaseOne;
  };

  const paceMinute = async (signal) => {
    if (!config.perMinute) return;
    for (;;) {
      const cutoff = now() - 60_000;
      minuteWindow = minuteWindow.filter((t) => t > cutoff);
      if (minuteWindow.length < config.perMinute) {
        minuteWindow.push(now());
        return;
      }
      const waitMs = Math.max(1, minuteWindow[0] - cutoff);
      stats.paced += 1;
      await sleep(waitMs, signal);
      if (signal?.aborted) throw signal.reason || new Error('Aborted');
    }
  };

  /**
   * Run one provider call under all three controls.
   *
   * THE ORDER IS THE DESIGN. The breaker is checked FIRST and costs nothing —
   * refusing a doomed call must not first wait in a queue or burn a minute
   * slot. Pacing comes before the concurrency slot so a paced call is not
   * holding a slot while it waits.
   *
   * @param {string} model
   * @param {() => Promise<any>} work
   * @param {{signal?: AbortSignal, classify?: (err: Error) => 'failure'|'ignore'}} [opts]
   */
  const run = async (model, work, { signal, classify } = {}) => {
    const b = breakerFor(model);
    const state = breakerState(model);
    if (state === 'open') {
      stats.refused += 1;
      throw new CircuitOpenError(model, b.openedAt + config.cooldownMs);
    }
    if (state === 'half-open') b.halfOpen = true;

    await paceMinute(signal);
    const release = await takeSlot(signal);
    stats.admitted += 1;
    try {
      const value = await work();
      if (b.openedAt != null) { stats.closed += 1; }
      b.failures = 0;
      b.openedAt = null;
      b.halfOpen = false;
      return value;
    } catch (error) {
      /* AN ABORT IS NOT A FAILURE. A user closing a tab must not open a breaker
       * on a healthy model — that would let one impatient user disable a seat
       * for everybody. The caller may classify anything else the same way. */
      const kind = signal?.aborted ? 'ignore' : (classify ? classify(error) : 'failure');
      if (kind === 'failure') {
        /* REQUESTS, NOT CALLS. `work()` may have retried inside itself —
         * lib/openrouter.js makes up to three POSTs per call and stamps the
         * count on the error it finally throws. Counting one failure per call
         * meant a chronically dead model burned `failureThreshold` × 3 real
         * requests against the account's daily cap before this breaker opened.
         * A failure with no count is one request, which is what every other
         * caller's errors are. */
        b.failures += Math.max(1, Math.floor(Number(error?.providerAttempts)) || 1);
        if (b.failures >= config.failureThreshold && b.openedAt == null) {
          b.openedAt = now();
          stats.opened += 1;
        } else if (b.halfOpen) {
          /* The probe failed. Restart the cool-off rather than letting every
           * subsequent call probe again — that is an open breaker that behaves
           * exactly like a closed one. */
          b.openedAt = now();
          b.halfOpen = false;
        }
      }
      throw error;
    } finally {
      release();
    }
  };

  return {
    run,
    breakerState,
    stats: () => ({ ...stats, inFlight, queued: waiters.length, minuteUsed: minuteWindow.length }),
    /** Test and shutdown seam. Does not cancel in-flight work. */
    reset: () => { breakers.clear(); minuteWindow = []; },
    config,
  };
}

module.exports = { createPacer, CircuitOpenError, PACER_DEFAULTS: DEFAULTS };
