'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));

const finiteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const timestamp = (value) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/**
 * Convert a durable answer-cache row into the exact replay contract. Rows
 * written before migration 016 deliberately fail closed here: the brain must
 * skip a row it cannot prove is safe to replay rather than guessing its
 * language, plan, or execution branch.
 */
function candidateToReplayInput(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const question = typeof (row.question_text ?? row.question) === 'string'
    ? (row.question_text ?? row.question).trim()
    : '';
  const lang = row.lang;
  const country = row.country;
  const plan = row.plan;
  const branch = row.branch;
  const detailed = row.detailed;
  const usedLiveWeb = row.used_live_web ?? row.usedLiveWeb ?? row.searched;
  if (!question || typeof lang !== 'string' || !lang.trim() ||
      typeof country !== 'string' || typeof plan !== 'string' || !plan.trim() ||
      typeof branch !== 'string' || !branch.trim() || typeof detailed !== 'boolean' ||
      typeof usedLiveWeb !== 'boolean') return null;
  return { question, lang, country, plan, detailed, branch, usedLiveWeb };
}

function provenanceCost(row) {
  const provenance = row?.provenance && typeof row.provenance === 'object'
    ? row.provenance : {};
  const explicit = [
    provenance.quota_cost,
    provenance.estimated_request_cost,
    provenance.request_count,
    provenance.model_calls,
    provenance.tool_calls,
    provenance.search_requests,
  ].map(finiteNumber).find((value) => value !== null && value >= 0);
  if (explicit !== undefined) return explicit;
  return row?.used_live_web === true || row?.searched === true ? 6 : 1;
}

/**
 * Score one candidate using only signals that survive in answer_cache.
 *
 * Demand favours rows people actually ask for; miss cost favours answers that
 * save a costly search/model fan-out; freshness favours rows that are stale or
 * close to expiry; quality avoids spending quota on known weak answers; and
 * quota cost favours work whose next miss would consume more of the shared
 * provider budget. All signals are bounded so one malformed row cannot
 * dominate the queue.
 */
function scoreCandidate(row, { now = Date.now(), quotaRemaining = null, quotaCapacity = 50 } = {}) {
  const hits = Math.max(0, finiteNumber(row?.hit_count ?? row?.hitCount) || 0);
  const demand = clamp(Math.log1p(hits) / Math.log1p(50));
  const cost = provenanceCost(row);
  const missCost = clamp(Math.log1p(cost) / Math.log1p(8));
  const expiresAt = timestamp(row?.expires_at ?? row?.expiresAt);
  const freshness = expiresAt === null
    ? 0
    : expiresAt <= now ? 1 : clamp(1 - ((expiresAt - now) / (14 * DAY_MS)));
  const qualityValue = finiteNumber(row?.quality)
    ?? finiteNumber(row?.provenance?.quality);
  const quality = qualityValue === null ? 0.5 : clamp(qualityValue);
  const quotaPressure = Number.isFinite(Number(quotaRemaining)) && Number(quotaCapacity) > 0
    ? clamp(1 - (Number(quotaRemaining) / Number(quotaCapacity)))
    : 0.5;
  const quotaCost = clamp(Math.log1p(cost) / Math.log1p(8)) * quotaPressure;
  const score = (demand * 0.30)
    + (missCost * 0.25)
    + (freshness * 0.20)
    + (quality * 0.10)
    + (quotaCost * 0.15);
  return {
    score,
    signals: { demand, missCost, freshness, quality, quotaPressure, quotaCost },
    hitCount: hits,
    expiresAt,
    storedAt: timestamp(row?.stored_at ?? row?.storedAt),
  };
}

/**
 * Rank safe, replayable cache rows for the brain's pre-compute producer.
 * `quotaRemaining === 0` is an explicit no-work result; callers never need to
 * turn a provider budget refusal into a model request just to discover it.
 */
function rankPrefetchCandidates(rows, options = {}) {
  const limit = Math.max(0, Math.floor(Number(options.limit) || 0));
  if (!Array.isArray(rows) || limit <= 0) return [];
  if (Number.isFinite(Number(options.quotaRemaining)) && Number(options.quotaRemaining) <= 0) return [];
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();

  return rows.flatMap((row) => {
    const input = candidateToReplayInput(row);
    if (!input) return [];
    const scored = scoreCandidate(row, { ...options, now });
    if (!Number.isFinite(scored.expiresAt)) return [];
    return [{
      key: row.key || null,
      ...input,
      searched: input.usedLiveWeb,
      storedAt: scored.storedAt,
      expiresAt: scored.expiresAt,
      hitCount: scored.hitCount,
      quality: finiteNumber(row.quality),
      prefetchScore: scored.score,
      prefetchSignals: scored.signals,
    }];
  }).sort((a, b) => b.prefetchScore - a.prefetchScore
    || a.expiresAt - b.expiresAt
    || b.hitCount - a.hitCount
    || String(a.key || '').localeCompare(String(b.key || ''))).slice(0, limit);
}

module.exports = { candidateToReplayInput, scoreCandidate, rankPrefetchCandidates, DAY_MS };
