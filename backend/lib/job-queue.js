'use strict';

const crypto = require('node:crypto');

/**
 * THE WORK A TURN LEAVES BEHIND, MADE DURABLE.
 *
 * Everything this system learns from a turn is currently fire-and-forget:
 *
 *     updateChatSummary(...).catch(() => {});
 *     updateUserFacts(...).catch(() => {});
 *
 * A `.catch(() => {})` is a decision that losing the work is acceptable, and it
 * was, when the work was one summary. It is now the summary, the facts, their
 * embeddings, the cache warmer and the brain's refreshes — and the failure is
 * invisible by construction: nothing records that the job existed, so nothing
 * can report that it did not run. A deploy mid-turn loses every one of them
 * with no trace. On Render's free tier the process is also stopped when idle,
 * which is exactly when this work runs.
 *
 * WHAT THIS FILE IS. The decisions — what to run next, when to retry, when to
 * stop retrying, and what makes two jobs the same job. No SQL and no clock of
 * its own, so every one of them is testable without a database, which is the
 * same split `spend.js` and `router.js` already use here.
 *
 * WHAT A LEASE IS FOR. More than one instance may run this (RATE_LIMIT_STORE
 * exists for exactly that reason), and two workers running the same summary
 * job is two provider calls against an account-wide daily cap for one result.
 * A claimed job carries `lease_until`; a worker that dies leaves a lease that
 * EXPIRES rather than a row locked forever. That is the whole reason the lease
 * is a timestamp and not a boolean.
 *
 * IDEMPOTENCY IS THE DEDUPE KEY, and it belongs to the ENQUEUER. Only the
 * caller knows that "summarise chat X through turn 12" is the same request
 * twice; the queue cannot see it in a payload. A unique index on that key makes
 * the second enqueue a no-op in the database rather than a race in the code.
 */

/** The kinds this queue carries. Named, because a typo'd kind is a job no worker claims. */
const KINDS = [
  'chat_summary',
  'fact_extraction',
  'embedding_backfill',
  'cache_warm',
  'brain_refresh',
  'evaluation',
];

const TERMINAL = new Set(['done', 'dead']);

/**
 * A stable key for "this exact piece of work".
 *
 * Two enqueues of the same job must collide, and two enqueues of DIFFERENT work
 * must not. Built from the kind and the caller's own identifying parts rather
 * than from the whole payload: a payload usually carries a timestamp or a
 * request id, and hashing that would make every enqueue unique, which is the
 * failure this is here to prevent.
 */
function dedupeKey(kind, parts = []) {
  const material = [kind, ...parts.map((p) => String(p ?? ''))].join('\u0000');
  return `${kind}:${crypto.createHash('sha256').update(material).digest('hex').slice(0, 24)}`;
}

/**
 * EXPONENTIAL BACKOFF WITH JITTER, and the jitter is not decoration.
 *
 * A provider outage fails every queued job at once. Without jitter every one of
 * them retries at the same instant, which is a self-inflicted thundering herd
 * against a service that has just told us it is struggling — and the retry
 * storm looks exactly like the outage it is responding to.
 *
 * @param {number} attempt   how many attempts have already failed
 * @param {{baseMs?: number, maxMs?: number, random?: () => number}} [opts]
 */
function backoffMs(attempt, { baseMs = 30_000, maxMs = 3_600_000, random = Math.random } = {}) {
  const exponential = Math.min(maxMs, baseMs * (2 ** Math.max(0, attempt)));
  /* Full jitter: a uniform draw across the whole window rather than a small
   * wobble around it. Decorrelating the retries matters more than retrying at
   * a predictable moment. */
  return Math.round(exponential * (0.5 + 0.5 * random()));
}

/**
 * What to do with a job that just failed.
 *
 * DEAD IS NOT DELETED. A dead-lettered job keeps its payload and its last
 * error, because "which jobs are failing and why" is the only question worth
 * asking about a queue and a deleted row cannot answer it. The alternative —
 * retrying forever — spends an account-wide daily provider budget on a job that
 * will never succeed, while the jobs that would succeed wait behind it.
 */
function afterFailure(job, error, { maxAttempts = 5, now = Date.now(), random = Math.random } = {}) {
  const attempts = (Number(job?.attempts) || 0) + 1;
  const message = String(error?.message || error || 'unknown').slice(0, 500);

  /* A PERMANENT FAILURE IS NOT WORTH FIVE ATTEMPTS. A malformed payload or a
   * deleted chat will fail identically every time, and the queue can tell
   * because the caller says so — `error.permanent`. Guessing from the message
   * text would be a string match on somebody else's error strings. */
  if (error?.permanent || attempts >= maxAttempts) {
    return {
      status: 'dead',
      attempts,
      last_error: message,
      lease_until: null,
      run_at: null,
      dead_at: new Date(now).toISOString(),
    };
  }

  return {
    status: 'pending',
    attempts,
    last_error: message,
    lease_until: null,
    run_at: new Date(now + backoffMs(attempts - 1, { random })).toISOString(),
  };
}

/** The patch for a job that succeeded. */
function afterSuccess(job, { now = Date.now() } = {}) {
  return {
    status: 'done',
    attempts: (Number(job?.attempts) || 0) + 1,
    lease_until: null,
    run_at: null,
    last_error: null,
    completed_at: new Date(now).toISOString(),
  };
}

/**
 * Is this job available to be claimed right now?
 *
 * Three ways a row is NOT available, and the third is the one that matters:
 * it is finished, it is not due yet, or somebody else holds an unexpired lease.
 * A lease in the past is not a held lease — that is a worker that died, and the
 * job has to become claimable again or it is lost forever.
 */
function isClaimable(job, { now = Date.now() } = {}) {
  if (!job || TERMINAL.has(job.status)) return false;
  if (job.run_at && new Date(job.run_at).getTime() > now) return false;
  if (job.lease_until && new Date(job.lease_until).getTime() > now) return false;
  return true;
}

/** The patch that claims a job for `leaseMs`. */
function claimPatch({ leaseMs = 120_000, now = Date.now(), workerId = 'worker' } = {}) {
  return {
    status: 'running',
    lease_until: new Date(now + leaseMs).toISOString(),
    claimed_by: String(workerId).slice(0, 100),
    claimed_at: new Date(now).toISOString(),
  };
}

/**
 * Order a batch of rows the way a worker should take them.
 *
 * DUE FIRST, THEN PRIORITY, THEN AGE. Age last and not first: a queue that
 * always takes the oldest row spends every cycle on the job that has been
 * failing longest, which is the one least likely to succeed.
 */
function nextJobs(rows, { now = Date.now(), limit = 5 } = {}) {
  return rows
    .filter((job) => isClaimable(job, { now }))
    .sort((a, b) => (Number(a.priority) || 5) - (Number(b.priority) || 5)
      || new Date(a.run_at || a.created_at || 0) - new Date(b.run_at || b.created_at || 0))
    .slice(0, limit);
}

/**
 * A job row ready to insert.
 *
 * `run_at` in the future is how a job is DELAYED rather than slept on — a
 * setTimeout does not survive the deploy that is the reason this queue exists.
 */
function enqueue({ kind, payload = {}, userId = null, chatId = null, keyParts = null, delayMs = 0, priority = 5, now = Date.now() } = {}) {
  if (!KINDS.includes(kind)) throw new TypeError(`unknown job kind: ${kind}`);
  return {
    kind,
    payload,
    user_id: userId,
    chat_id: chatId,
    /* Defaulting the key to the payload is the LAST resort and is stated as
     * such: it makes two enqueues collide only when the payloads are byte
     * identical, which a payload carrying a timestamp never is. Callers that
     * care about idempotency pass keyParts. */
    dedupe_key: dedupeKey(kind, keyParts || [userId, chatId, JSON.stringify(payload)]),
    status: 'pending',
    attempts: 0,
    priority,
    run_at: new Date(now + Math.max(0, delayMs)).toISOString(),
  };
}

module.exports = { KINDS, dedupeKey, backoffMs, afterFailure, afterSuccess, isClaimable, claimPatch, nextJobs, enqueue };
