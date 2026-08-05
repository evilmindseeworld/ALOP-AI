/**
 * An express-rate-limit store backed by Postgres, so a limit means the same
 * thing across every instance.
 *
 * The default store is in-memory and per-process. On one instance the limits
 * hold exactly as measured; on two, "120 per minute" silently becomes 240. The
 * counter has to live somewhere both processes can see.
 *
 * THE ONE DECISION THAT MATTERS HERE IS WHAT TO DO WHEN THE DATABASE IS
 * UNREACHABLE, and it is a genuine trade with no free answer:
 *
 *   Fail CLOSED — treat a database error as "limit exceeded" — and a Supabase
 *   blip takes the whole API down for everyone. The rate limiter becomes the
 *   least reliable component in the request path and the most total in its
 *   effect.
 *
 *   Fail OPEN — treat it as "not limited" — and during an outage the limits do
 *   not apply.
 *
 * This fails OPEN, deliberately. The limits here protect against cost and
 * abuse, not against data loss: the worst case is a window in which someone
 * could burn API credits, and that window requires them to notice an outage
 * they cannot cause. Failing closed converts a partial dependency failure into
 * a total one, which is a worse trade for a service whose database is already
 * on the critical path for everything else.
 *
 * Every failure is logged, because a rate limiter that has quietly stopped
 * limiting must not also be quiet about it.
 */

/** Matches express-rate-limit's Store interface (v7). */
class PostgresStore {
  /**
   * @param {object} deps
   * @param {(fn: string, args: object) => Promise<{data: any, error: any}>} deps.rpc
   *        Supabase's rpc(), or anything with that shape.
   * @param {(msg: string) => void} [deps.onError]
   */
  constructor({ rpc, onError = (m) => console.error(m) }) {
    if (typeof rpc !== "function") throw new TypeError("PostgresStore needs an rpc function");
    this.rpc = rpc;
    this.onError = onError;
    this.windowMs = 60_000;
  }

  /** Called once by express-rate-limit with the limiter's own window. */
  init(options) {
    if (options && Number.isFinite(options.windowMs)) this.windowMs = options.windowMs;
  }

  async increment(key) {
    try {
      const { data, error } = await this.rpc("increment_rate_limit", {
        p_key: String(key),
        p_window_ms: this.windowMs,
      });
      if (error) throw new Error(error.message || String(error));

      // Postgres RETURNS TABLE arrives as an array of one row.
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !Number.isFinite(Number(row.total_hits))) throw new Error("malformed rpc result");

      return {
        totalHits: Number(row.total_hits),
        resetTime: row.reset_at ? new Date(row.reset_at) : new Date(Date.now() + this.windowMs),
      };
    } catch (err) {
      this.onError(`[ratelimit] store unavailable, FAILING OPEN: ${err.message}`);
      // totalHits 0 is below every limit, so the request proceeds. Returning a
      // huge number instead would fail closed — see the note at the top.
      return { totalHits: 0, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  async decrement(key) {
    try {
      const { error } = await this.rpc("decrement_rate_limit", { p_key: String(key) });
      if (error) throw new Error(error.message || String(error));
    } catch (err) {
      // Nothing to fall back to, and an un-decremented counter only ever makes
      // the limit stricter — which is the safe direction to be wrong in.
      this.onError(`[ratelimit] decrement failed: ${err.message}`);
    }
  }

  async resetKey(key) {
    try {
      await this.rpc("decrement_rate_limit", { p_key: String(key) });
    } catch {
      /* best effort */
    }
  }
}

module.exports = { PostgresStore };
