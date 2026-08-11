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
