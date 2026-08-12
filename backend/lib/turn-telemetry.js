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
      return {
        telemetry: "council_turn",
        category,
        turnMs: Math.max(0, now() - startedAt),
        msToFirstByte: Number.isFinite(msToFirstByte) ? msToFirstByte : null,
        msToFirstProgress: Number.isFinite(msToFirstProgress) ? msToFirstProgress : null,
        contextReads,
        contextMs,
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
