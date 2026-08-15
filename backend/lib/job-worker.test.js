'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const { afterFailure, afterSuccess, claimPatch } = require('./job-queue');
const { createJobWorker } = require('./job-worker');

const NOW = 1_760_000_000_000;
const iso = (ms) => new Date(ms).toISOString();

const job = (extra = {}) => ({
  id: 'job-1',
  kind: 'chat_summary',
  payload: { chatId: 'chat-1' },
  status: 'pending',
  attempts: 0,
  priority: 5,
  run_at: iso(NOW - 1000),
  lease_until: null,
  created_at: iso(NOW - 5000),
  ...extra,
});

const claimed = (extra = {}) => ({
  ...job(extra),
  ...claimPatch({ now: NOW, leaseMs: 30_000, workerId: 'worker-1' }),
});

/**
 * A deliberately small Supabase query-builder double. Each awaited query takes
 * the next scripted response while preserving every predicate for assertions.
 */
function scriptedSupabase(responses) {
  const pending = [...responses];
  const calls = [];

  const take = () => {
    assert.ok(pending.length > 0, 'worker made an unexpected database query');
    return pending.shift();
  };

  return {
    calls,
    from(table) {
      const call = { table, action: null, values: null, operations: [] };
      calls.push(call);

      const query = {};
      for (const method of ['in', 'or', 'order', 'limit', 'eq', 'gt']) {
        query[method] = (...args) => {
          call.operations.push([method, ...args]);
          return query;
        };
      }
      query.select = (columns) => {
        if (!call.action) call.action = 'select';
        call.operations.push(['select', columns]);
        return query;
      };
      query.update = (values) => {
        call.action = 'update';
        call.values = values;
        call.operations.push(['update', values]);
        return query;
      };
      query.maybeSingle = async () => {
        call.operations.push(['maybeSingle']);
        return take();
      };
      query.then = (resolve, reject) => Promise.resolve(take()).then(resolve, reject);

      return query;
    },
  };
}

function workerFor(supabase, options = {}) {
  return createJobWorker({
    supabase,
    handlers: { chat_summary: async () => {} },
    workerId: 'worker-1',
    leaseMs: 30_000,
    now: () => NOW,
    random: () => 1,
    ...options,
  });
}

function hasOperation(call, expected) {
  return call.operations.some((operation) => isDeepStrictEqual(operation, expected));
}

test('candidate selection is due, lease-aware, ordered, and bounded', async () => {
  const supabase = scriptedSupabase([{ data: [], error: null }]);
  const worker = workerFor(supabase, { batchSize: 3, candidateLimit: 7 });

  const result = await worker.pollOnce();

  assert.deepEqual(result, {
    examined: 0, claimed: 0, claimConflicts: 0, succeeded: 0, retried: 0, dead: 0, lost: 0,
  });
  const [select] = supabase.calls;
  assert.equal(select.table, 'jobs');
  assert.equal(select.action, 'select');
  assert.ok(hasOperation(select, ['in', 'status', ['pending', 'running']]));
  assert.ok(hasOperation(select, ['or', `run_at.is.null,run_at.lte.${iso(NOW)}`]));
  assert.ok(hasOperation(select, ['or', `lease_until.is.null,lease_until.lte.${iso(NOW)}`]));
  assert.ok(hasOperation(select, ['order', 'priority', { ascending: true }]));
  assert.ok(hasOperation(select, ['limit', 7]));
});

test('claim is an atomic conditional update and a lost race runs no handler', async () => {
  let handled = 0;
  const due = job();
  const supabase = scriptedSupabase([
    { data: [due], error: null },
    { data: null, error: null },
  ]);
  const worker = workerFor(supabase, {
    handlers: { chat_summary: async () => { handled += 1; } },
  });

  const result = await worker.pollOnce();

  assert.equal(handled, 0);
  assert.equal(result.claimed, 0);
  assert.equal(result.claimConflicts, 1);
  const claim = supabase.calls[1];
  assert.deepEqual(claim.values, claimPatch({ now: NOW, leaseMs: 30_000, workerId: 'worker-1' }));
  assert.ok(hasOperation(claim, ['eq', 'id', due.id]));
  assert.ok(hasOperation(claim, ['in', 'status', ['pending', 'running']]));
  assert.ok(hasOperation(claim, ['or', `run_at.is.null,run_at.lte.${iso(NOW)}`]));
  assert.ok(hasOperation(claim, ['or', `lease_until.is.null,lease_until.lte.${iso(NOW)}`]));
});

test('success runs the matching handler and settles only the live exact claim', async () => {
  const due = job();
  const held = claimed();
  let received = null;
  const supabase = scriptedSupabase([
    { data: [due], error: null },
    { data: held, error: null },
    { data: { id: held.id }, error: null },
  ]);
  const worker = workerFor(supabase, {
    handlers: {
      chat_summary: async (row, context) => { received = { row, context }; },
    },
  });

  const result = await worker.pollOnce();

  assert.equal(received.row, held);
  assert.equal(received.context.workerId, 'worker-1');
  assert.equal(result.succeeded, 1);
  const settle = supabase.calls[2];
  assert.deepEqual(settle.values, afterSuccess(held, { now: NOW }));
  assert.ok(hasOperation(settle, ['eq', 'id', held.id]));
  assert.ok(hasOperation(settle, ['eq', 'status', 'running']));
  assert.ok(hasOperation(settle, ['eq', 'claimed_by', held.claimed_by]));
  assert.ok(hasOperation(settle, ['eq', 'claimed_at', held.claimed_at]));
  assert.ok(hasOperation(settle, ['eq', 'lease_until', held.lease_until]));
  assert.ok(hasOperation(settle, ['gt', 'lease_until', iso(NOW)]));
});

test('a worker whose lease expired cannot mark the job successful', async () => {
  const due = job();
  const held = claimed();
  const supabase = scriptedSupabase([
    { data: [due], error: null },
    { data: held, error: null },
    { data: null, error: null },
  ]);

  const result = await workerFor(supabase).pollOnce();

  assert.equal(result.succeeded, 0);
  assert.equal(result.lost, 1);
});

test('a handler error is rescheduled with the queue policy helper', async () => {
  const due = job();
  const held = claimed();
  const error = new Error('provider timeout');
  const supabase = scriptedSupabase([
    { data: [due], error: null },
    { data: held, error: null },
    { data: { id: held.id }, error: null },
  ]);
  const worker = workerFor(supabase, {
    handlers: { chat_summary: async () => { throw error; } },
  });

  const result = await worker.pollOnce();

  assert.equal(result.retried, 1);
  assert.deepEqual(supabase.calls[2].values, afterFailure(held, error, {
    now: NOW, maxAttempts: 5, random: () => 1,
  }));
});

test('the last failed attempt is dead-lettered', async () => {
  const due = job({ attempts: 4 });
  const held = claimed({ attempts: 4 });
  const supabase = scriptedSupabase([
    { data: [due], error: null },
    { data: held, error: null },
    { data: { id: held.id }, error: null },
  ]);
  const worker = workerFor(supabase, {
    handlers: { chat_summary: async () => { throw new Error('still broken'); } },
  });

  const result = await worker.pollOnce();

  assert.equal(result.dead, 1);
  assert.equal(supabase.calls[2].values.status, 'dead');
  assert.equal(supabase.calls[2].values.attempts, 5);
  assert.equal(supabase.calls[2].values.run_at, null);
});

test('a missing kind handler is a permanent dead-letter failure', async () => {
  const due = job();
  const held = claimed();
  const supabase = scriptedSupabase([
    { data: [due], error: null },
    { data: held, error: null },
    { data: { id: held.id }, error: null },
  ]);
  const worker = workerFor(supabase, { handlers: {} });

  const result = await worker.pollOnce();

  assert.equal(result.dead, 1);
  assert.equal(supabase.calls[2].values.attempts, 1);
  assert.match(supabase.calls[2].values.last_error, /no handler for job kind/);
});

test('start uses an unref timer and stop cancels polling idempotently', async () => {
  const timers = [];
  const cleared = [];
  const setTimeout = (callback, delay) => {
    const handle = {
      callback,
      delay,
      unrefCalled: false,
      unref() { this.unrefCalled = true; },
    };
    timers.push(handle);
    return handle;
  };
  const clearTimeout = (handle) => { cleared.push(handle); };
  const supabase = scriptedSupabase([]);
  const worker = workerFor(supabase, { setTimeout, clearTimeout, pollMs: 250 });

  assert.equal(worker.start(), true);
  assert.equal(worker.start(), false, 'start must not create a second poll loop');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 0);
  assert.equal(timers[0].unrefCalled, true);

  await worker.stop();
  await worker.stop();
  assert.equal(worker.running, false);
  assert.deepEqual(cleared, [timers[0]]);

  await timers[0].callback();
  assert.equal(supabase.calls.length, 0, 'a cleared timer callback must observe stop and do no work');
  assert.equal(timers.length, 1, 'stop must prevent rescheduling');
});
