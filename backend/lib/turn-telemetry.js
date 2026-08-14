/**
 * One cheap, structured record for the work that made a council turn take as
 * long as it did.
 *
 * This is deliberately a recorder, not a logger. The route already writes
 * audit rows and the admin command already reads them; this module only keeps
 * the measurements together until that existing write happens. It stores no
 * prompts, answers or provider payloads.
 */

function createTurnTelemetry({ now = Date.now, startedAt = now() } = {}) {
  const contextReads = {};
  let contextCompression = null;
  const routerReads = {};
  const seats = [];
  const toolRounds = [];
  let synthesisMs = null;
  let fallbackCouncil = { used: false, durationMs: null, kind: null };
  let ceiling = { hit: false, reason: null };
  /* Provider calls that are NOT seats, NOT synthesis and NOT router reads —
   * today that is the pair `rememberTurn` fires after the user has been
   * answered, one to re-summarise the chat and one to extract user facts.
   *
   * They are counted because they are real OpenRouter requests against an
   * account-wide daily cap, and because nothing else here could see them: they
   * are deliberately fire-and-forget, so they leave no seat record, no
   * synthesis time and no router read. lib/spend.js used to model them as part
   * of a flat `FAST_OVERHEAD` constant that named the wrong three calls
   * entirely, which is exactly the kind of assumption a recorder exists to
   * replace. */
  let fastCalls = 0;

  /* TOKENS, WHICH NOTHING HERE COULD SEE UNTIL THE ADAPTER STOPPED RETURNING A
   * STRING. Every measurement in this file was wall time, so the cost model was
   * "a request is a request" — which is how a 12-token greeting and a 40k-token
   * research synthesis drew equally on the account's daily allowance in the
   * only place anyone could look. `usage` is what the provider actually billed;
   * it arrives in the JSON body of a `callModel` reply and, since the stream
   * body now asks for it, on the final frame of a streamed one.
   *
   * Recorded per PHASE, because that is the question worth asking of it: a turn
   * that spends 80% of its tokens on seats that were then discarded by the
   * quorum is a different problem from one that spends them on synthesis.
   * Absent on providers that do not report usage — null totals are honest and
   * a zero would not be. */
  const usageByPhase = new Map();
  let usageCalls = 0;

  const measure = (bucket, name, work) => {
    const started = now();
    return Promise.resolve()
      .then(work)
      .then(
        (value) => {
          bucket[name] = { ms: Math.max(0, now() - started), ok: true };
          return value;
        },
        (error) => {
          bucket[name] = { ms: Math.max(0, now() - started), ok: false };
          throw error;
        },
      );
  };

  return {
    measureContext(name, work) {
      return measure(contextReads, name, work);
    },
    /**
    * Record only shape and size. Context itself is user data and must never
     * enter the audit row or a diagnostic log.
     */
    recordContextCompression(stats = {}) {
      const nonNegative = (value) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
      };
      contextCompression = {
        compressed: Boolean(stats.compressed),
        originalMessages: nonNegative(stats.originalMessages),
        retainedMessages: nonNegative(stats.retainedMessages),
        originalChars: nonNegative(stats.originalChars),
        retainedChars: nonNegative(stats.retainedChars),
        droppedMessages: nonNegative(stats.droppedMessages),
        relevantTurns: nonNegative(stats.relevantTurns),
        maxChars: nonNegative(stats.maxChars),
        maxMessages: nonNegative(stats.maxMessages),
      };
    },
    measureRouter(name, work) {
      return measure(routerReads, name, work);
    },
    /**
     * Record N provider calls that no other recorder here can see.
     *
     * Counted at DISPATCH rather than on completion, deliberately: these are
     * fire-and-forget, so waiting for them would mean the settlement in the
     * route's `finally` reads a count that has not finished changing. The
     * provider bills a request that was sent whether or not we waited for the
     * answer, so dispatch is also the honest moment to count it.
     */
    recordFastCalls(n = 1) {
      const count = Number(n);
      if (Number.isFinite(count) && count > 0) fastCalls += Math.round(count);
    },
    /**
     * Add one provider call's reported usage.
     *
     * @param {{promptTokens: number|null, completionTokens: number|null, totalTokens: number|null, costUsd: number|null}|null} usage
     * @param {{phase?: string}} [opts]  'council' | 'synthesis' | 'router' | 'fast' | 'vision'
     */
    recordUsage(usage, { phase = 'council' } = {}) {
      if (!usage || typeof usage !== 'object') return;
      const key = String(phase || 'council');
      const bucket = usageByPhase.get(key)
        || { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, calls: 0 };
      const add = (value) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : 0;
      };
      bucket.promptTokens += add(usage.promptTokens);
      bucket.completionTokens += add(usage.completionTokens);
      bucket.totalTokens += add(usage.totalTokens);
      bucket.costUsd += add(usage.costUsd);
      bucket.calls += 1;
      usageByPhase.set(key, bucket);
      usageCalls += 1;
    },
    recordSeat(row) {
      if (!row || typeof row !== "object") return;
      seats.push({
        phase: row.phase || "council",
        round: Number.isFinite(row.round) ? row.round : 1,
        model: String(row.model || "unknown"),
        ms: Math.max(0, Number(row.durationMs) || 0),
        outcome: row.outcome || "unknown",
      });
    },
    recordToolRound(row) {
      if (!row || typeof row !== "object") return;
      toolRounds.push({
        round: Number.isFinite(row.round) ? row.round : 0,
        ms: Math.max(0, Number(row.durationMs) || 0),
        calls: Math.max(0, Number(row.calls) || 0),
        aborted: Boolean(row.aborted),
      });
    },
    recordSynthesis(durationMs) {
      synthesisMs = Math.max(0, Number(durationMs) || 0);
    },
    recordFallback(durationMs, kind = "post_council") {
      fallbackCouncil = {
        used: true,
        durationMs: Math.max(0, Number(durationMs) || 0),
        kind,
      };
    },
    markCeiling(reason) {
      if (!ceiling.hit) ceiling = { hit: true, reason: reason || "unknown" };
    },
    snapshot({
      category = "council",
      msToFirstByte = null,
      msToFirstProgress = null,
      aborted = false,
      extra = {},
    } = {}) {
      const contextMs = Object.values(contextReads).reduce((n, r) => n + (r.ms || 0), 0);
      const toolMs = toolRounds.reduce((n, r) => n + r.ms, 0);
      /* null rather than a zeroed object when no provider reported usage. A
       * zero here would read as "this turn cost nothing", which is the one
       * thing it definitely did not. */
      const usage = usageCalls === 0 ? null : {
        calls: usageCalls,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        byPhase: {},
      };
      if (usage) {
        for (const [phase, bucket] of usageByPhase) {
          usage.byPhase[phase] = { ...bucket };
          usage.promptTokens += bucket.promptTokens;
          usage.completionTokens += bucket.completionTokens;
          usage.totalTokens += bucket.totalTokens;
          usage.costUsd += bucket.costUsd;
        }
        // Sub-cent sums accumulate float noise that reads as false precision.
        usage.costUsd = Math.round(usage.costUsd * 1e6) / 1e6;
      }
      return {
        usage,
        telemetry: "council_turn",
        category,
        turnMs: Math.max(0, now() - startedAt),
        msToFirstByte: Number.isFinite(msToFirstByte) ? msToFirstByte : null,
        msToFirstProgress: Number.isFinite(msToFirstProgress) ? msToFirstProgress : null,
        contextReads,
        contextMs,
        contextCompression,
        routerReads,
        fastCalls,
        seats: [...seats],
        synthesisMs,
        toolRounds: [...toolRounds],
        toolMs,
        ceiling,
        fallbackCouncil,
        aborted: Boolean(aborted),
        ...extra,
      };
    },
  };
}

module.exports = { createTurnTelemetry };
