/**
 * One cheap, structured record for the work that made a council turn take as
 * long as it did.
 *
 * This is deliberately a recorder, not a logger. The route already writes
 * audit rows and the admin command already reads them; this module only keeps
 * the measurements together until that existing write happens. It stores no
 * prompts, answers or provider payloads.
 */

function createTurnTelemetry({ now = Date.now, startedAt = now(), context = null } = {}) {
  /* THE IDS, CARRIED RATHER THAN RE-DERIVED. Every row this produces is read
   * later by someone asking "what happened on this turn", and until the ids
   * were in the row itself the answer required joining an audit row to a log
   * line by timestamp. See lib/turn-context.js for why there are two of them. */
  const ids = context && typeof context.ids === 'function' ? context.ids() : null;
  /* PHYSICAL provider requests, one record per POST that reached a gateway —
   * retries included. `seats` counts LOGICAL asks: a seat retried twice inside
   * lib/openrouter.js is one seat record and three requests against an
   * account-wide daily cap, and the ceiling built to bound that cap could not
   * see the difference. */
  const providerAttempts = [];
  const MAX_ATTEMPT_RECORDS = 200;
  const attemptTotals = { total: 0, ok: 0, failed: 0, retries: 0, byOutcome: {}, byProvider: {} };
  /* Tool executions, by name and outcome. The agent loop already reports rounds
   * and call counts; what nothing recorded is whether the calls WORKED, which
   * is the number that decides whether a tool is worth its tokens. */
  const toolOutcomes = [];
  let cancellation = null;
  /* Where the answer's text came from. 'content' is a model writing an answer;
   * 'reasoning' is an answer rescued from excluded thinking (see
   * lib/reasoning-rescue.js) and is a WEAKER result — worth knowing about
   * before it is cached and served to somebody else. */
  let textSource = null;
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
    /**
     * One physical request to a model gateway.
     *
     * Fed by `options.onAttempt` in lib/openrouter.js, which fires once per POST
     * on both the streaming and non-streaming paths. Bounded so that a pathological
     * retry storm cannot grow an audit row without limit; the COUNTS below are
     * kept exactly either way, because they are what the spend ceiling reads.
     *
     * @param {{provider?: string, model?: string, attempt?: number,
     *          outcome?: string, status?: number|null, ms?: number,
     *          streamed?: boolean, phase?: string}} row
     */
    recordProviderAttempt(row) {
      if (!row || typeof row !== 'object') return;
      attemptTotals.total += 1;
      if (row.outcome === 'ok') attemptTotals.ok += 1; else attemptTotals.failed += 1;
      if (Number(row.attempt) > 1) attemptTotals.retries += 1;
      const outcome = String(row.outcome || 'unknown');
      const provider = String(row.provider || 'openrouter');
      attemptTotals.byOutcome[outcome] = (attemptTotals.byOutcome[outcome] || 0) + 1;
      attemptTotals.byProvider[provider] = (attemptTotals.byProvider[provider] || 0) + 1;
      /* The COUNTS above are exact; the per-attempt DETAIL below is capped. A
       * retry storm must not grow this object without limit, and the counts are
       * what the spend ceiling settles against — losing detail costs a
       * diagnostic, losing a count costs money. */
      if (providerAttempts.length >= MAX_ATTEMPT_RECORDS) return;
      providerAttempts.push({
        provider: String(row.provider || 'openrouter'),
        model: String(row.model || 'unknown'),
        phase: row.phase ? String(row.phase) : null,
        attempt: Number.isFinite(row.attempt) ? row.attempt : 1,
        outcome: String(row.outcome || 'unknown'),
        status: Number.isFinite(row.status) ? row.status : null,
        ms: Math.max(0, Number(row.ms) || 0),
        streamed: Boolean(row.streamed),
      });
    },
    /**
     * Did a tool call do what it was asked?
     *
     * @param {{name?: string, ok?: boolean, ms?: number, round?: number, error?: string}} row
     */
    recordToolOutcome(row) {
      if (!row || typeof row !== 'object') return;
      toolOutcomes.push({
        name: String(row.name || 'unknown'),
        ok: row.ok !== false,
        ms: Math.max(0, Number(row.ms) || 0),
        round: Number.isFinite(row.round) ? row.round : null,
      });
    },
    /**
     * Why the turn stopped early, when it did.
     *
     * `aborted: true` on the snapshot has always said THAT a turn was cancelled
     * and never WHY, so a user closing a tab, a deadline expiring and an
     * upstream disconnect were one number. They call for three different fixes.
     */
    recordTextSource(source) {
      if (typeof source === 'string' && source) textSource = source;
    },
    markCancelled(reason, { atMs = null } = {}) {
      if (cancellation) return;
      cancellation = {
        reason: String(reason || 'unknown'),
        atMs: Number.isFinite(atMs) ? atMs : Math.max(0, now() - startedAt),
      };
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
      /* Summed, not just listed. `providerRequests` is what lib/spend.js reads
       * to settle the account-wide request ceiling, and a settlement that had
       * to walk an array to find its own number would be a settlement that
       * silently returns 0 for a truncated row. */
      const toolTotals = toolOutcomes.length === 0 ? null : {
        calls: toolOutcomes.length,
        ok: toolOutcomes.filter((t) => t.ok).length,
        failed: toolOutcomes.filter((t) => !t.ok).length,
        byName: toolOutcomes.reduce((acc, t) => {
          const entry = acc[t.name] || { calls: 0, ok: 0, ms: 0 };
          entry.calls += 1;
          if (t.ok) entry.ok += 1;
          entry.ms += t.ms;
          acc[t.name] = entry;
          return acc;
        }, {}),
      };
      return {
        usage,
        telemetry: "council_turn",
        ...(ids || {}),
        providerAttempts: {
          ...attemptTotals,
          byOutcome: { ...attemptTotals.byOutcome },
          byProvider: { ...attemptTotals.byProvider },
          truncatedDetail: providerAttempts.length >= MAX_ATTEMPT_RECORDS,
        },
        /* The number the ceiling settles against. Named separately from the
         * breakdown so a reader of lib/spend.js does not have to know the
         * breakdown's shape to know which field is the count. */
        providerRequests: attemptTotals.byProvider.openrouter || 0,
        toolOutcomes: toolTotals,
        cancellation,
        textSource,
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
