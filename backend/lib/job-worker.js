'use strict';

const crypto = require('node:crypto');
const {
  afterFailure,
  afterSuccess,
  claimPatch,
  nextJobs,
} = require('./job-queue');

const CLAIMABLE_STATUSES = ['pending', 'running'];

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function databaseError(action, error) {
  const wrapped = new Error(`job worker could not ${action}: ${error?.message || error}`);
  wrapped.cause = error;
  return wrapped;
}

function missingHandler(kind) {
  const error = new Error(`no handler for job kind: ${kind}`);
  error.permanent = true;
  return error;
}

/**
 * A small Supabase-backed durable job worker.
 *
 * Claims are optimistic conditional updates rather than a read followed by an
 * unconditional write. Two workers may read the same due row, but only the
 * first update can replace its expired lease with a live one. Completion uses
 * the inverse rule: it must match the exact claim and the lease must STILL be
 * live. This matters even when `workerId` is reused by a restarted process —
 * `claimed_at` and `lease_until` make each claim a distinct ownership token.
 *
 * Handlers are injected by kind and receive `(job, { workerId })`. Database,
 * clock, randomness, and timers are injectable so no test needs Supabase or a
 * live event-loop timer.
 */
function createJobWorker({
  supabase,
  handlers = {},
  workerId = `${process.pid}-${crypto.randomUUID()}`,
  leaseMs = 120_000,
  pollMs = 1000,
  batchSize = 5,
  candidateLimit,
  maxAttempts = 5,
  now = Date.now,
  random = Math.random,
  setTimeout: scheduleTimeout = globalThis.setTimeout,
  clearTimeout: cancelTimeout = globalThis.clearTimeout,
  onError = (error) => console.error('[JOBS] worker poll failed:', error),
} = {}) {
  if (!supabase || typeof supabase.from !== 'function') {
    throw new TypeError('supabase with a from() method is required');
  }
  if ((!handlers || typeof handlers !== 'object') && !(handlers instanceof Map)) {
    throw new TypeError('handlers must be an object or Map');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof random !== 'function') throw new TypeError('random must be a function');
  if (typeof scheduleTimeout !== 'function' || typeof cancelTimeout !== 'function') {
    throw new TypeError('setTimeout and clearTimeout must be functions');
  }
  if (typeof onError !== 'function') throw new TypeError('onError must be a function');

  positiveInteger(leaseMs, 'leaseMs');
  positiveInteger(batchSize, 'batchSize');
  positiveInteger(maxAttempts, 'maxAttempts');
  if (!Number.isInteger(pollMs) || pollMs < 0) {
    throw new TypeError('pollMs must be a non-negative integer');
  }

  const boundedCandidateLimit = candidateLimit === undefined
    ? batchSize * 4
    : positiveInteger(candidateLimit, 'candidateLimit');
  const id = String(workerId).slice(0, 100);

  let running = false;
  let timer = null;
  let activePoll = null;

  function nowMs() {
    const value = Number(now());
    if (!Number.isFinite(value)) throw new TypeError('now() must return a finite timestamp');
    return value;
  }

  function handlerFor(kind) {
    return handlers instanceof Map ? handlers.get(kind) : handlers[kind];
  }

  async function candidates() {
    const at = nowMs();
    const atIso = new Date(at).toISOString();
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .in('status', CLAIMABLE_STATUSES)
      .or(`run_at.is.null,run_at.lte.${atIso}`)
      .or(`lease_until.is.null,lease_until.lte.${atIso}`)
      .order('priority', { ascending: true })
      .order('run_at', { ascending: true, nullsFirst: true })
      .limit(boundedCandidateLimit);

    if (error) throw databaseError('read due jobs', error);
    return nextJobs(Array.isArray(data) ? data : [], { now: at, limit: batchSize });
  }

  async function claim(candidate) {
    const at = nowMs();
    const atIso = new Date(at).toISOString();
    const patch = claimPatch({ leaseMs, now: at, workerId: id });
    const { data, error } = await supabase
      .from('jobs')
      .update(patch)
      .eq('id', candidate.id)
      .in('status', CLAIMABLE_STATUSES)
      .or(`run_at.is.null,run_at.lte.${atIso}`)
      .or(`lease_until.is.null,lease_until.lte.${atIso}`)
      .select('*')
      .maybeSingle();

    if (error) throw databaseError(`claim job ${candidate.id}`, error);
    return data || null;
  }

  async function settle(claimedJob, patch) {
    const atIso = new Date(nowMs()).toISOString();
    const { data, error } = await supabase
      .from('jobs')
      .update(patch)
      .eq('id', claimedJob.id)
      .eq('status', 'running')
      .eq('claimed_by', claimedJob.claimed_by)
      .eq('claimed_at', claimedJob.claimed_at)
      .eq('lease_until', claimedJob.lease_until)
      /* At equality the lease is expired: isClaimable uses `> now` for the
       * same boundary. A stale handler must leave the row for a new claim. */
      .gt('lease_until', atIso)
      .select('id')
      .maybeSingle();

    if (error) throw databaseError(`settle job ${claimedJob.id}`, error);
    return Boolean(data);
  }

  async function runClaimed(claimedJob) {
    let patch;
    let outcome;

    try {
      const handler = handlerFor(claimedJob.kind);
      if (typeof handler !== 'function') throw missingHandler(claimedJob.kind);
      await handler(claimedJob, { workerId: id });
      patch = afterSuccess(claimedJob, { now: nowMs() });
      outcome = 'done';
    } catch (error) {
      patch = afterFailure(claimedJob, error, {
        maxAttempts,
        now: nowMs(),
        random,
      });
      outcome = patch.status;
    }

    return await settle(claimedJob, patch) ? outcome : 'lost';
  }

  async function pollOnce({ shouldContinue = () => true } = {}) {
    if (typeof shouldContinue !== 'function') {
      throw new TypeError('shouldContinue must be a function');
    }

    const due = await candidates();
    const work = [];
    let claimConflicts = 0;

    for (const candidate of due) {
      if (!shouldContinue()) break;
      const claimedJob = await claim(candidate);
      if (!claimedJob) {
        claimConflicts += 1;
        continue;
      }
      work.push(runClaimed(claimedJob));
    }

    const outcomes = await Promise.all(work);
    return {
      examined: due.length,
      claimed: work.length,
      claimConflicts,
      succeeded: outcomes.filter((outcome) => outcome === 'done').length,
      retried: outcomes.filter((outcome) => outcome === 'pending').length,
      dead: outcomes.filter((outcome) => outcome === 'dead').length,
      lost: outcomes.filter((outcome) => outcome === 'lost').length,
    };
  }

  function schedule(delay) {
    if (!running) return;
    timer = scheduleTimeout(() => {
      timer = null;
      if (!running) return undefined;

      activePoll = pollOnce({ shouldContinue: () => running })
        .catch((error) => {
          try {
            onError(error);
          } catch {
            /* Reporting must not kill the worker loop. */
          }
        })
        .finally(() => {
          activePoll = null;
          if (running) schedule(pollMs);
        });
      return activePoll;
    }, delay);
    timer?.unref?.();
  }

  function start() {
    if (running) return false;
    running = true;
    schedule(0);
    return true;
  }

  async function stop() {
    running = false;
    if (timer) {
      cancelTimeout(timer);
      timer = null;
    }
    if (activePoll) await activePoll;
  }

  return {
    workerId: id,
    pollOnce,
    start,
    stop,
    get running() { return running; },
  };
}

module.exports = { createJobWorker };
