'use strict';

/**
 * What each model and each provider has actually been doing lately.
 *
 * WHY. Every routing decision in this product is made from a constant: the
 * roster is a hand-ordered list, the whip is a number, the fallback is an env
 * var. None of them can see that a seat has failed its last nine calls, that
 * one provider's p95 has tripled, or that a model advertised as supporting
 * tools has never once emitted one. The handoff's oldest open item is a latency
 * probe that has to be run BY HAND, which is the same gap from the other side.
 *
 * WHAT IT MEASURES, and each one exists because a decision needs it:
 *
 *   latency      p50/p95 from a bounded reservoir, not a mean. A mean over a
 *                bimodal distribution — a fast provider that sometimes queues —
 *                describes neither mode.
 *   failures     consecutive and windowed, because "failing right now" and
 *                "unreliable in general" call for different responses.
 *   rate limits  429s counted apart from other failures: they are a signal
 *                about US, not about the provider's health.
 *   tools        did a tool-capable seat actually emit a call. A model that
 *                silently never does is a metered seat producing free-tier work.
 *   cost         tokens and dollars per call, so "cheap" is measured.
 *   quality      whatever the caller scores it as — usable answer, quorum
 *                survival. Optional and absent by default; a made-up quality
 *                number is worse than none.
 *
 * IN MEMORY AND PER PROCESS, deliberately. This informs a decision that is
 * about to be made in this process, in the next few milliseconds; a shared
 * store would put a round trip in front of the routing decision it exists to
 * speed up. It is a health signal, not a ledger — nothing here is money and
 * nothing here needs to survive a restart.
 *
 * ponytail: reservoir of 64 samples per model, decayed by recency rather than
 * time-bucketed. Good enough to rank seats; not a metrics system. If this ever
 * needs to answer "what was the p95 at 3am on Tuesday", that is Sentry's job.
 */

const WINDOW = 64;
/** Below this many samples a model's stats are reported but not trusted. */
const MIN_CONFIDENT_SAMPLES = 8;

const percentile = (sorted, p) => {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

function createProviderHealth({ now = Date.now, window = WINDOW } = {}) {
  /** model -> record */
  const models = new Map();

  const blank = () => ({
    calls: 0,
    ok: 0,
    failed: 0,
    rateLimited: 0,
    consecutiveFailures: 0,
    latencies: [],
    toolOffers: 0,
    toolEmissions: 0,
    costUsd: 0,
    tokens: 0,
    qualitySum: 0,
    qualityCount: 0,
    lastAt: null,
    lastOutcome: null,
  });

  const recordOf = (model) => {
    const key = String(model || 'unknown');
    let record = models.get(key);
    if (!record) { record = blank(); models.set(key, record); }
    return record;
  };

  /**
   * @param {object} row
   * @param {string} row.model
   * @param {'ok'|'failed'|'rate_limited'|'timeout'|'aborted'} row.outcome
   * @param {number} [row.ms]
   * @param {boolean} [row.offeredTools]  the request carried tool schemas
   * @param {boolean} [row.emittedTool]   the reply carried a tool call
   * @param {number} [row.costUsd]
   * @param {number} [row.tokens]
   * @param {number} [row.quality]        0..1, caller's judgement; optional
   */
  const record = (row) => {
    if (!row || typeof row !== 'object') return;
    const r = recordOf(row.model);
    const outcome = String(row.outcome || 'ok');

    /* AN ABORT IS NOT A FAILURE, and conflating them is how a provider gets
     * blamed for a user closing a tab. A cancelled call says nothing about the
     * model's health, so it is not counted at all. */
    if (outcome === 'aborted') return;

    r.calls += 1;
    r.lastAt = now();
    r.lastOutcome = outcome;

    if (outcome === 'ok') {
      r.ok += 1;
      r.consecutiveFailures = 0;
    } else {
      r.failed += 1;
      r.consecutiveFailures += 1;
      if (outcome === 'rate_limited') r.rateLimited += 1;
    }

    const ms = Number(row.ms);
    /* Only successful calls carry a latency worth ranking on. A 200ms 429 would
     * otherwise make an unusable provider look like the fastest one. */
    if (outcome === 'ok' && Number.isFinite(ms) && ms >= 0) {
      r.latencies.push(ms);
      if (r.latencies.length > window) r.latencies.shift();
    }

    if (row.offeredTools) r.toolOffers += 1;
    if (row.emittedTool) r.toolEmissions += 1;

    const cost = Number(row.costUsd);
    if (Number.isFinite(cost) && cost > 0) r.costUsd += cost;
    const tokens = Number(row.tokens);
    if (Number.isFinite(tokens) && tokens > 0) r.tokens += tokens;

    const quality = Number(row.quality);
    if (Number.isFinite(quality) && quality >= 0 && quality <= 1) {
      r.qualitySum += quality;
      r.qualityCount += 1;
    }
  };

  /**
   * One model's health, as numbers a routing decision can compare.
   *
   * `confident` is the field that stops this being dangerous. Two samples make
   * a p95 that looks like a measurement and is not, and a router that drops a
   * seat on two samples is a router that drops a healthy seat after one bad
   * minute.
   */
  const statsFor = (model) => {
    const r = models.get(String(model || 'unknown'));
    if (!r) return null;
    const sorted = [...r.latencies].sort((a, b) => a - b);
    return {
      model: String(model),
      calls: r.calls,
      ok: r.ok,
      failed: r.failed,
      rateLimited: r.rateLimited,
      consecutiveFailures: r.consecutiveFailures,
      successRate: r.calls ? r.ok / r.calls : null,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      samples: sorted.length,
      /* CALLS, NOT LATENCY SAMPLES. Only successful calls carry a latency, so
       * keying confidence on the reservoir made a model with ten failures and
       * no successes indistinguishable from one nobody had ever called — the
       * ranking treated the most broken thing on the roster as a promising
       * newcomer and kept its position. Failures are evidence too, and they are
       * the evidence that matters most here. */
      confident: r.calls >= MIN_CONFIDENT_SAMPLES,
      /* null, not 0, when tools were never offered. A model nobody armed has
       * not "failed to emit a call"; it was never asked. */
      toolReliability: r.toolOffers ? r.toolEmissions / r.toolOffers : null,
      toolOffers: r.toolOffers,
      costPerCallUsd: r.calls ? r.costUsd / r.calls : null,
      tokensPerCall: r.calls ? r.tokens / r.calls : null,
      quality: r.qualityCount ? r.qualitySum / r.qualityCount : null,
      lastAt: r.lastAt,
      lastOutcome: r.lastOutcome,
    };
  };

  /**
   * Rank candidates best-first for a given emphasis.
   *
   * NOT A FILTER. It never drops a model, because a health signal that removes
   * the last working seat during a provider-wide blip has turned a degraded
   * turn into no turn. Dropping is `pacer.js`'s job, through a circuit breaker
   * that knows how to close again.
   *
   * @param {string[]} candidates
   * @param {{emphasis?: 'latency'|'quality'|'cost'|'balanced'}} [opts]
   */
  const rank = (candidates, { emphasis = 'balanced' } = {}) => {
    const scored = (Array.isArray(candidates) ? candidates : []).map((model, index) => {
      const s = statsFor(model);
      /* An unmeasured model keeps its ROSTER position. The list is hand-ordered
       * by someone who knew what they were doing, and "no data" must not sort
       * below "measured and bad" or a new model could never earn a sample. */
      if (!s || !s.confident) return { model, score: 0.5 - index * 1e-6, unmeasured: true };

      const reliability = s.successRate ?? 0.5;
      /* Normalised against 10s, which is the order of a slow seat here (23.9s
       * measured for the recovery model, 2.4s for the primary). */
      const speed = s.p95 == null ? 0.5 : Math.max(0, 1 - s.p95 / 10_000);
      const cheapness = s.costPerCallUsd == null ? 0.5 : Math.max(0, 1 - s.costPerCallUsd / 0.01);
      const quality = s.quality ?? 0.5;

      const weights = {
        latency: { reliability: 0.3, speed: 0.5, cheapness: 0.1, quality: 0.1 },
        quality: { reliability: 0.3, speed: 0.1, cheapness: 0.1, quality: 0.5 },
        cost: { reliability: 0.3, speed: 0.1, cheapness: 0.5, quality: 0.1 },
        balanced: { reliability: 0.4, speed: 0.25, cheapness: 0.15, quality: 0.2 },
      }[emphasis] || { reliability: 0.4, speed: 0.25, cheapness: 0.15, quality: 0.2 };

      const score = reliability * weights.reliability
        + speed * weights.speed
        + cheapness * weights.cheapness
        + quality * weights.quality;
      return { model, score, unmeasured: false, stats: s };
    });
    return scored.sort((a, b) => b.score - a.score);
  };

  return {
    record,
    statsFor,
    rank,
    snapshot: () => Object.fromEntries([...models.keys()].map((m) => [m, statsFor(m)])),
    reset: () => models.clear(),
    MIN_CONFIDENT_SAMPLES,
  };
}

module.exports = { createProviderHealth, MIN_CONFIDENT_SAMPLES, WINDOW };
