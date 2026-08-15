'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runDag, DeadlineExceeded } = require('./execution-dag');

/** A clock the graph reads through `now`, so no assertion here waits in real time. */
const fakeClock = () => {
  let clock = 0;
  return { now: () => clock, advance: (ms) => { clock += ms; } };
};

const step = (name, extra = {}) => ({ name, run: async () => name, ...extra });

/* ---- shape and validation ------------------------------------------------ */

test('a step without a name or a run function is refused before anything runs', async () => {
  await assert.rejects(() => runDag([{ name: 'a' }]), TypeError);
  await assert.rejects(() => runDag([{ run: async () => 1 }]), TypeError);
});

test('a duplicate step name is refused', async () => {
  await assert.rejects(() => runDag([step('a'), step('a')]), /duplicate step: a/);
});

test('a dependency on a step that does not exist is refused', async () => {
  await assert.rejects(
    () => runDag([step('a', { needs: ['ghost'] })]),
    /needs unknown step "ghost"/,
  );
});

/* A cycle presents as a run that hangs until the turn's own deadline, which
 * looks exactly like a slow provider. It has to be named up front. */
test('a dependency cycle is named rather than hung on', async () => {
  await assert.rejects(
    () => runDag([step('a', { needs: ['b'] }), step('b', { needs: ['a'] })]),
    /dependency cycle:/,
  );
});

/* ---- ordering ------------------------------------------------------------ */

test('independent steps start in the same wave; dependants wait', async () => {
  const order = [];
  const gate = { a: null, b: null };
  const res = await runDag([
    { name: 'a', run: async () => { order.push('a:start'); await new Promise((r) => { gate.a = r; setImmediate(r); }); order.push('a:end'); return 1; } },
    { name: 'b', run: async () => { order.push('b:start'); await new Promise((r) => { gate.b = r; setImmediate(r); }); order.push('b:end'); return 2; } },
    { name: 'c', needs: ['a', 'b'], run: async ({ results }) => { order.push('c:start'); return results.a + results.b; } },
  ]);

  assert.equal(res.ok, true);
  assert.equal(res.results.c, 3);
  // Both independents are running before either finishes — that is the claim.
  assert.deepEqual(order.slice(0, 2).sort(), ['a:start', 'b:start']);
  assert.equal(order.at(-1), 'c:start');
});

test('a dependant reads its dependencies out of results', async () => {
  const res = await runDag([
    { name: 'first', run: async () => 'value' },
    { name: 'second', needs: ['first'], run: async ({ results }) => `${results.first}!` },
  ]);
  assert.equal(res.results.second, 'value!');
});

/* ---- budgets: rule 8, a lower layer may not re-expand a ceiling ---------- */

test("a step's own budget is clamped to what is LEFT of the run's deadline", async () => {
  const clock = fakeClock();
  let seen = null;
  const res = await runDag(
    [
      { name: 'slow', run: async () => { clock.advance(700); return 'done'; } },
      {
        name: 'after',
        needs: ['slow'],
        // Asks for five seconds inside a run that has 300ms left.
        budgetMs: 5000,
        run: async ({ remainingMs }) => { seen = remainingMs; return 'ok'; },
      },
    ],
    { deadlineAt: 1000, now: clock.now },
  );

  assert.equal(res.ok, true);
  assert.equal(seen, 300, 'the step must see the remaining budget, not its own');
});

test('a step that outlives its budget is reported as a deadline, not a failure', async () => {
  const res = await runDag([
    { name: 'hang', budgetMs: 10, run: () => new Promise(() => {}), optional: true, fallback: 'fell-back' },
  ]);
  assert.equal(res.ok, true);
  assert.equal(res.results.hang, 'fell-back');
  assert.equal(res.steps[0].outcome, 'deadline');
});

test('a step starting with no budget left never runs its body', async () => {
  const clock = fakeClock();
  let ran = false;
  const res = await runDag(
    [
      { name: 'spender', run: async () => { clock.advance(1000); return 1; } },
      { name: 'starved', needs: ['spender'], optional: true, run: async () => { ran = true; return 2; } },
    ],
    { deadlineAt: 1000, now: clock.now },
  );
  assert.equal(ran, false);
  assert.equal(res.steps.find((s) => s.name === 'starved').outcome, 'deadline');
});

/* ---- optional vs required ------------------------------------------------ */

test('an optional step that throws resolves to its fallback and the graph carries on', async () => {
  const res = await runDag([
    { name: 'facts', optional: true, fallback: [], run: async () => { throw new Error('supabase down'); } },
    { name: 'answer', needs: ['facts'], run: async ({ results }) => `${results.facts.length} facts` },
  ]);
  assert.equal(res.ok, true);
  assert.equal(res.results.answer, '0 facts');
  assert.equal(res.steps[0].outcome, 'failed');
});

test('a required step that throws stops the run and reports the first error', async () => {
  const res = await runDag([
    { name: 'must', run: async () => { throw new Error('no'); } },
    { name: 'later', needs: ['must'], run: async () => 'never' },
  ]);
  assert.equal(res.ok, false);
  assert.equal(res.error.message, 'no');
  assert.equal(res.results.later, undefined);
});

/* ---- when: skipping work the turn does not need (item 14's mechanism) ---- */

test('a step whose `when` is false is skipped and takes its fallback', async () => {
  let ran = false;
  const res = await runDag([
    { name: 'vision', when: () => false, fallback: null, run: async () => { ran = true; return 'described'; } },
  ]);
  assert.equal(ran, false);
  assert.equal(res.results.vision, null);
  assert.equal(res.steps[0].outcome, 'skipped');
});

test('`when` sees the results of the steps it depends on', async () => {
  const res = await runDag([
    { name: 'route', run: async () => ({ searched: false }) },
    {
      name: 'search',
      needs: ['route'],
      when: ({ results }) => results.route.searched,
      fallback: 'no-search',
      run: async () => 'searched',
    },
  ]);
  assert.equal(res.results.search, 'no-search');
});

/* ---- cancellation -------------------------------------------------------- */

test('an already-aborted signal stops every step from running its body', async () => {
  const controller = new AbortController();
  controller.abort(new Error('client went away'));
  let ran = false;
  const res = await runDag(
    [{ name: 'a', run: async () => { ran = true; return 1; } }],
    { signal: controller.signal },
  );
  assert.equal(ran, false);
  assert.equal(res.ok, false);
  assert.equal(res.steps[0].outcome, 'aborted');
});

test('aborting mid-flight rejects a step that would otherwise hang', async () => {
  const controller = new AbortController();
  const run = runDag(
    [{ name: 'hang', optional: true, fallback: 'gone', run: () => new Promise(() => {}) }],
    { signal: controller.signal },
  );
  setImmediate(() => controller.abort(new Error('client went away')));
  const res = await run;
  assert.equal(res.results.hang, 'gone');
  assert.equal(res.steps[0].outcome, 'aborted');
});

/* ---- reporting ----------------------------------------------------------- */

test('every step is reported once, in settle order, through onStep and the result', async () => {
  const seen = [];
  const res = await runDag(
    [step('a'), step('b', { needs: ['a'] })],
    { onStep: (row) => seen.push(row.name) },
  );
  assert.deepEqual(seen, ['a', 'b']);
  assert.deepEqual(res.steps.map((s) => s.name), ['a', 'b']);
  assert.deepEqual(res.steps.map((s) => s.outcome), ['ok', 'ok']);
});

test('DeadlineExceeded carries the step name and a stable code', async () => {
  const error = new DeadlineExceeded('vision', 250);
  assert.equal(error.code, 'STEP_DEADLINE');
  assert.equal(error.step, 'vision');
  assert.match(error.message, /vision.*250ms/);
});
