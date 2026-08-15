'use strict';

const crypto = require('node:crypto');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/* These are COST ceilings, not throughput tuning.
 *
 * One council question may fan out into several OpenRouter requests. The free
 * account has roughly 50 requests/day shared with live users, so warming all 28
 * curated questions in one night would consume the product to optimise it. Two
 * refresh attempts/run allows one ordinary failure not to strand the next due
 * row; one pre-compute/night makes the cold fill deliberately slow. The UTC-day
 * ceiling is the final local guard: at defaults, background work can start at
 * most two questions in a day, across both jobs. The server-side admission gate
 * remains authoritative because only it can count the model calls within one
 * question and see the account-wide daily latch.
 *
 * When a ceiling is raised, the minute between questions keeps two council
 * fan-outs from becoming one OpenRouter burst. Any 429 stops the current batch
 * and pauses both jobs for fifteen minutes. Daily-limit 429s pause until the
 * next UTC day instead. The named numbers below are the single tuning surface;
 * the safe defaults stay small on purpose. */
const DEFAULTS = Object.freeze({
  refreshWindowMs: 2 * HOUR_MS,
  refreshEveryMs: HOUR_MS,
  precomputeEveryMs: DAY_MS,
  nightlyUtcHour: 3,
  refreshRunCap: 2,
  precomputeRunCap: 1,
  dailyQuestionCap: 2,
  paceMs: MINUTE_MS,
  rateLimitBackoffMs: 15 * MINUTE_MS,
});

function hashQuestion(question) {
  return crypto.createHash('sha256').update(String(question || '')).digest('hex').slice(0, 12);
}

function safeLog(log, level, line) {
  try { log?.[level]?.(line); } catch { /* Observability cannot kill a job. */ }
}

function errorMessage(error) {
  return String(error?.message || error || 'unknown error').replace(/[\r\n]+/g, ' ').slice(0, 240);
}

function isRateLimit(error) {
  return Number(error?.status || error?.statusCode) === 429;
}

function isDailyRateLimit(error) {
  return /daily_request_limit|openrouter_free_tier_daily|out of model requests|per_day|midnight|50 requests/i.test(
    `${error?.reason || ''} ${error?.limitSource || ''} ${error?.message || ''}`,
  );
}

function nextUtcDay(time) {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function delayUntilNightly(time, hour) {
  const date = new Date(time);
  let target = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hour,
  );
  if (target <= time) target += DAY_MS;
  return target - time;
}

function replayInput(value) {
  if (!value || typeof value !== 'object') return null;
  const question = typeof value.question === 'string' ? value.question.trim() : '';
  if (!question) return null;
  if (typeof value.lang !== 'string' || !value.lang.trim()) return null;
  if (typeof value.country !== 'string') return null;
  if (typeof value.plan !== 'string' || !value.plan.trim()) return null;
  if (typeof value.detailed !== 'boolean') return null;
  /* `branch` carries the execution mode in the answer-cache identity. It is
   * required even though the fixed runQuestion seam does not accept it: a row
   * without that identity cannot be checked safely by the pre-compute job. */
  if (typeof value.branch !== 'string' || !value.branch.trim()) return null;
  return {
    question,
    lang: value.lang,
    country: value.country,
    plan: value.plan,
    detailed: value.detailed,
    branch: value.branch,
  };
}

/**
 * Background answer-cache maintenance.
 *
 * Assumed cache seam:
 *   cache.dueForRefresh({ before, limit }) -> Promise<Array<Row>>
 * where `before` and Row.expiresAt are epoch milliseconds and Row contains
 * question/lang/country/plan/detailed/branch/searched. cache.get(cache.keyFor())
 * is the existing fresh-entry test used by pre-compute.
 *
 * `questions` may be an array or an async function returning one. Replacing the
 * curated source with a usage-log query later therefore changes the producer,
 * not this scheduler or its budget/failure behaviour.
 */
function createBrain({
  cache,
  runQuestion,
  questions = [],
  enqueueJob = null,
  queueUserId = null,
  log = console,
  now = () => Date.now(),
  setTimeoutFn = setTimeout,
  refreshBranch = '',
} = {}) {
  const cfg = { ...DEFAULTS };
  const enabled = /^(1|true)$/i.test(process.env.COUNCIL_BRAIN || '');
  const scheduleTimers = new Set();
  const sleepers = new Set();
  const controllers = new Set();

  let started = false;
  let stopped = false;
  let running = false;
  let backoffUntil = 0;
  let budgetDay = '';
  let dailyAttempts = 0;

  const safeNow = () => {
    try {
      const value = Number(now());
      return Number.isFinite(value) ? value : Date.now();
    } catch {
      return Date.now();
    }
  };

  const resetDailyCounter = (time) => {
    const day = new Date(time).toISOString().slice(0, 10);
    if (day === budgetDay) return;
    budgetDay = day;
    dailyAttempts = 0;
  };

  const reserveBackgroundQuestion = () => {
    const time = safeNow();
    resetDailyCounter(time);
    if (time < backoffUntil || dailyAttempts >= cfg.dailyQuestionCap) return false;
    dailyAttempts++;
    return true;
  };

  const sleep = (ms) => {
    if (!(ms > 0) || stopped) return Promise.resolve();
    return new Promise((resolve) => {
      const record = { handle: null, resolve };
      const wake = () => { sleepers.delete(record); resolve(); };
      try {
        record.handle = setTimeoutFn(wake, ms);
        record.handle?.unref?.();
        sleepers.add(record);
      } catch {
        resolve();
      }
    });
  };

  const loadQuestions = async () => {
    try {
      const rows = typeof questions === 'function' ? await questions() : questions;
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      safeLog(log, 'warn', `[BRAIN] questions failed: ${errorMessage(error)}`);
      return [];
    }
  };

  const cacheKeyFor = (input) => {
    try { return cache?.keyFor?.(input) || null; } catch { return null; }
  };

  const ask = async (input, label) => {
    if (!reserveBackgroundQuestion()) return { stop: true };

    /* In production the scheduler only creates durable work. The queue worker
     * runs the same `runQuestion` seam later, so a deploy or sleeping instance
     * cannot lose a refresh after the scheduler selected it. Tests and small
     * embedders that do not provide a queue retain the direct seam. */
    if (typeof enqueueJob === 'function') {
      const kind = label === 'refresh' ? 'brain_refresh' : 'cache_warm';
      try {
        const accepted = await enqueueJob({
          kind,
          userId: queueUserId || null,
          priority: label === 'refresh' ? 8 : 9,
          keyParts: [input.question, input.lang, input.country, input.plan, input.detailed, input.branch],
          payload: { ...input },
        });
        if (!accepted) {
          safeLog(log, 'warn', `[BRAIN] ${label} queue unavailable: ${hashQuestion(input.question)}`);
          return { stop: true };
        }
        safeLog(log, 'info', `[BRAIN] ${label} queued: ${hashQuestion(input.question)}`);
        return { stop: false };
      } catch (error) {
        safeLog(log, 'warn', `[BRAIN] ${label} queue failed: ${hashQuestion(input.question)} (${errorMessage(error)})`);
        return { stop: true };
      }
    }

    if (typeof runQuestion !== 'function') {
      safeLog(log, 'warn', `[BRAIN] ${label} failed: ${hashQuestion(input.question)} (runQuestion unavailable)`);
      return { stop: true };
    }

    const controller = new AbortController();
    controllers.add(controller);
    try {
      const result = await runQuestion({
        question: input.question,
        lang: input.lang,
        country: input.country,
        plan: input.plan,
        detailed: input.detailed,
        branch: input.branch,
        signal: controller.signal,
      });
      if (typeof result?.answer !== 'string' || !result.answer.trim()) {
        throw new Error('runQuestion returned no answer');
      }
      /* runQuestion writes the answer cache as part of the normal council path.
       * Writing again here would duplicate asynchronous upserts and risks using
       * a TTL that disagrees with its returned searched/fresh provenance. */
      safeLog(log, 'info', `[BRAIN] ${label}: ${hashQuestion(input.question)}`);
      return { stop: false };
    } catch (error) {
      if (isDailyRateLimit(error) || isRateLimit(error)) {
        const time = safeNow();
        backoffUntil = Math.max(
          backoffUntil,
          isDailyRateLimit(error) ? nextUtcDay(time) : time + cfg.rateLimitBackoffMs,
        );
        safeLog(log, 'warn', `[BRAIN] 429 back-off until ${new Date(backoffUntil).toISOString()}`);
        return { stop: true };
      }
      safeLog(log, 'warn', `[BRAIN] ${label} failed: ${hashQuestion(input.question)} (${errorMessage(error)})`);
      return { stop: false };
    } finally {
      controllers.delete(controller);
    }
  };

  const enterRun = () => {
    const time = safeNow();
    resetDailyCounter(time);
    if (stopped || running || time < backoffUntil || dailyAttempts >= cfg.dailyQuestionCap) return false;
    running = true;
    return true;
  };

  async function runRefresh() {
    if (!enterRun()) return;
    try {
      const time = safeNow();
      let rows = [];
      try {
        if (typeof cache?.dueForRefresh !== 'function') {
          safeLog(log, 'warn', '[BRAIN] refresh selection unavailable');
          return;
        }
        const selection = {
          before: time + cfg.refreshWindowMs,
          limit: cfg.refreshRunCap,
        };
        if (refreshBranch) selection.branch = refreshBranch;
        rows = await cache.dueForRefresh(selection);
      } catch (error) {
        safeLog(log, 'warn', `[BRAIN] refresh selection failed: ${errorMessage(error)}`);
        return;
      }

      if (!Array.isArray(rows)) return;
      let attempted = 0;
      const seen = new Set();
      for (const row of rows) {
        if (attempted >= cfg.refreshRunCap || stopped) break;
        const input = replayInput(row);
        const expiresAt = Number(row?.expiresAt);
        if (!input || row.searched !== true) continue;
        if (!Number.isFinite(expiresAt) || expiresAt <= time || expiresAt > time + cfg.refreshWindowMs) continue;
        const key = cacheKeyFor(input);
        if (!key || seen.has(key)) continue;
        seen.add(key);

        if (attempted > 0) await sleep(cfg.paceMs);
        if (stopped) break;
        attempted++;
        const outcome = await ask(input, 'refresh');
        if (outcome.stop) break;
      }
    } catch (error) {
      safeLog(log, 'warn', `[BRAIN] refresh run failed: ${errorMessage(error)}`);
    } finally {
      running = false;
    }
  }

  async function runPrecompute() {
    if (!enterRun()) return;
    try {
      if (typeof cache?.get !== 'function' || typeof cache?.keyFor !== 'function') {
        safeLog(log, 'warn', '[BRAIN] pre-compute cache lookup unavailable');
        return;
      }
      const rows = await loadQuestions();
      let attempted = 0;
      const seen = new Set();
      for (const row of rows) {
        if (attempted >= cfg.precomputeRunCap || stopped) break;
        const input = replayInput(row);
        if (!input) continue;
        const key = cacheKeyFor(input);
        if (!key || seen.has(key)) continue;
        seen.add(key);

        let hit;
        try { hit = await cache.get(key); }
        catch (error) {
          /* If freshness cannot be checked, spending is the unsafe direction. */
          safeLog(log, 'warn', `[BRAIN] pre-compute lookup failed: ${hashQuestion(input.question)} (${errorMessage(error)})`);
          continue;
        }
        if (hit) continue;

        if (attempted > 0) await sleep(cfg.paceMs);
        if (stopped) break;
        attempted++;
        const outcome = await ask(input, 'pre-compute');
        if (outcome.stop) break;
      }
    } catch (error) {
      safeLog(log, 'warn', `[BRAIN] pre-compute run failed: ${errorMessage(error)}`);
    } finally {
      running = false;
    }
  }

  const scheduleLoop = (job, initialDelay, repeatDelay) => {
    if (stopped) return;
    let handle;
    const tick = async () => {
      scheduleTimers.delete(handle);
      if (stopped) return;
      try { await job(); }
      catch (error) { safeLog(log, 'warn', `[BRAIN] scheduled run failed: ${errorMessage(error)}`); }
      finally { if (!stopped) scheduleLoop(job, repeatDelay, repeatDelay); }
    };
    try {
      handle = setTimeoutFn(tick, initialDelay);
      handle?.unref?.();
      scheduleTimers.add(handle);
    } catch (error) {
      safeLog(log, 'warn', `[BRAIN] schedule failed: ${errorMessage(error)}`);
    }
  };

  const stop = () => {
    stopped = true;
    for (const handle of scheduleTimers) {
      try { clearTimeout(handle); } catch { /* Fake and foreign handles are okay. */ }
    }
    scheduleTimers.clear();
    for (const sleeper of sleepers) {
      try { clearTimeout(sleeper.handle); } catch { /* See above. */ }
      sleeper.resolve();
    }
    sleepers.clear();
    for (const controller of controllers) controller.abort('brain-stopped');
    controllers.clear();
  };

  function start() {
    if (started || !enabled) return stop;
    started = true;
    stopped = false;
    const time = safeNow();
    scheduleLoop(runRefresh, cfg.refreshEveryMs, cfg.refreshEveryMs);
    scheduleLoop(
      runPrecompute,
      delayUntilNightly(time, cfg.nightlyUtcHour),
      cfg.precomputeEveryMs,
    );
    return stop;
  }

  return { start, runRefresh, runPrecompute };
}

module.exports = { createBrain, hashQuestion, DEFAULTS };
