'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createBrain } = require('./brain');
const { CURATED_QUESTION_TEXTS, createBrainQuestions } = require('./brain-questions');

const HOUR_MS = 60 * 60 * 1000;

function clock(start = Date.UTC(2026, 7, 14, 0, 0, 0)) {
  let time = start;
  return {
    now: () => time,
    advance(ms) { time += ms; },
  };
}

function immediateTimeout(fn) {
  queueMicrotask(fn);
  return { unref() {} };
}

function due(question, expiresAt, patch = {}) {
  return {
    question,
    lang: 'English',
    country: 'AE',
    plan: 'free',
    detailed: false,
    branch: 'turn:tools-off',
    searched: true,
    expiresAt,
    ...patch,
  };
}

function quietLog() {
  return { info() {}, warn() {}, error() {} };
}

test('refresh selects only search rows expiring inside the next two hours', async () => {
  const c = clock();
  const asked = [];
  let selection;
  const cache = {
    async dueForRefresh(options) {
      selection = options;
      return [
        due('already expired', c.now() - 1),
        due('due search answer', c.now() + HOUR_MS),
        due('stable answer', c.now() + HOUR_MS, { searched: false }),
        due('too early', c.now() + 3 * HOUR_MS),
        due('missing replay inputs', c.now() + HOUR_MS, { branch: '' }),
      ];
    },
    keyFor: ({ question }) => question,
  };
  const brain = createBrain({
    cache,
    questions: [],
    now: c.now,
    setTimeoutFn: immediateTimeout,
    log: quietLog(),
    runQuestion: async (input) => { asked.push(input.question); return { answer: 'ok', searched: true, fresh: false }; },
  });

  await brain.runRefresh();

  assert.deepEqual(selection, { before: c.now() + 2 * HOUR_MS, limit: 2 });
  assert.deepEqual(asked, ['due search answer']);
});

test('pre-compute skips an entry that is already fresh', async () => {
  const asked = [];
  const cache = {
    keyFor: ({ question }) => `key:${question}`,
    get: async (key) => key === 'key:already cached' ? { answer: 'fresh', storedAt: 1 } : null,
  };
  const questions = [
    due('already cached', Number.MAX_SAFE_INTEGER),
    due('uncached question', Number.MAX_SAFE_INTEGER),
  ];
  const brain = createBrain({
    cache,
    questions,
    log: quietLog(),
    setTimeoutFn: immediateTimeout,
    runQuestion: async (input) => { asked.push(input.question); return { answer: 'ok', searched: false, fresh: false }; },
  });

  await brain.runPrecompute();

  assert.deepEqual(asked, ['uncached question']);
});

test('a 429 pauses the brain instead of continuing at full rate', async () => {
  const c = clock();
  let calls = 0;
  const rateLimited = Object.assign(new Error('rate limited'), {
    status: 429,
    limitSource: 'openrouter_free_tier_per_minute',
  });
  const cache = {
    dueForRefresh: async () => [due('first', c.now() + HOUR_MS), due('second', c.now() + HOUR_MS)],
    keyFor: ({ question }) => question,
  };
  const brain = createBrain({
    cache,
    questions: [],
    now: c.now,
    setTimeoutFn: immediateTimeout,
    log: quietLog(),
    runQuestion: async () => { if (++calls === 1) throw rateLimited; return { answer: 'ok', searched: true, fresh: false }; },
  });

  await brain.runRefresh();
  assert.equal(calls, 1, 'the next row was attempted immediately after a 429');
  await brain.runRefresh();
  assert.equal(calls, 1, 'the next tick ignored the active back-off');

  c.advance(15 * 60 * 1000);
  await brain.runRefresh();
  assert.equal(calls, 2, 'work did not resume after the back-off elapsed');
});

test('an already-latched daily refusal abandons work until the next UTC day', async () => {
  const c = clock();
  let calls = 0;
  const dailyRefusal = Object.assign(
    new Error('The council is out of model requests for today. It resets at midnight UTC.'),
    { status: 503 },
  );
  const cache = {
    dueForRefresh: async () => [due('first', c.now() + HOUR_MS), due('second', c.now() + HOUR_MS)],
    keyFor: ({ question }) => question,
  };
  const brain = createBrain({
    cache,
    questions: [],
    now: c.now,
    setTimeoutFn: immediateTimeout,
    log: quietLog(),
    runQuestion: async () => { calls++; throw dailyRefusal; },
  });

  await brain.runRefresh();
  assert.equal(calls, 1);
  c.advance(15 * 60 * 1000);
  await brain.runRefresh();
  assert.equal(calls, 1, 'a daily latch was treated like a short 429 back-off');

  c.advance(24 * HOUR_MS);
  await brain.runRefresh();
  assert.equal(calls, 2, 'the local daily pause did not clear on a new UTC day');
});

test('the refresh per-run ceiling holds even when the cache returns more', async () => {
  const c = clock();
  const asked = [];
  const cache = {
    dueForRefresh: async () => Array.from({ length: 8 }, (_, i) => due(`question ${i}`, c.now() + HOUR_MS)),
    keyFor: ({ question }) => question,
  };
  const brain = createBrain({
    cache,
    questions: [],
    now: c.now,
    setTimeoutFn: immediateTimeout,
    log: quietLog(),
    runQuestion: async (input) => { asked.push(input.question); return { answer: 'ok', searched: true, fresh: false }; },
  });

  await brain.runRefresh();

  assert.equal(asked.length, 2);
});

test('COUNCIL_BRAIN off schedules nothing', () => {
  const previous = process.env.COUNCIL_BRAIN;
  process.env.COUNCIL_BRAIN = '0';
  const scheduled = [];
  try {
    const brain = createBrain({
      cache: {},
      questions: [],
      runQuestion: async () => ({ answer: 'ok', searched: false, fresh: false }),
      log: quietLog(),
      setTimeoutFn: (fn, ms) => { scheduled.push({ fn, ms }); return { unref() {} }; },
    });
    const stop = brain.start();
    assert.equal(typeof stop, 'function');
    assert.deepEqual(scheduled, []);
    stop();
  } finally {
    if (previous === undefined) delete process.env.COUNCIL_BRAIN;
    else process.env.COUNCIL_BRAIN = previous;
  }
});

test('start schedules both jobs on unref timers and stop makes callbacks inert', async () => {
  const previous = process.env.COUNCIL_BRAIN;
  process.env.COUNCIL_BRAIN = '1';
  const scheduled = [];
  let dueReads = 0;
  try {
    const brain = createBrain({
      cache: {
        dueForRefresh: async () => { dueReads++; return []; },
        keyFor: ({ question }) => question,
      },
      questions: [],
      runQuestion: async () => ({ answer: 'ok', searched: false, fresh: false }),
      log: quietLog(),
      setTimeoutFn: (fn, ms) => {
        const handle = { fn, ms, unrefCalls: 0, unref() { this.unrefCalls++; } };
        scheduled.push(handle);
        return handle;
      },
    });

    const stop = brain.start();
    assert.equal(scheduled.length, 2);
    assert.ok(scheduled.every((timer) => timer.unrefCalls === 1));
    stop();
    await Promise.all(scheduled.map((timer) => timer.fn()));
    assert.equal(dueReads, 0);
  } finally {
    if (previous === undefined) delete process.env.COUNCIL_BRAIN;
    else process.env.COUNCIL_BRAIN = previous;
  }
});

test('one failed question does not abort the rest of the run', async () => {
  const c = clock();
  const asked = [];
  const cache = {
    dueForRefresh: async () => [due('broken', c.now() + HOUR_MS), due('healthy', c.now() + HOUR_MS)],
    keyFor: ({ question }) => question,
  };
  const brain = createBrain({
    cache,
    questions: [],
    now: c.now,
    setTimeoutFn: immediateTimeout,
    log: quietLog(),
    runQuestion: async (input) => {
      asked.push(input.question);
      if (input.question === 'broken') throw new Error('provider failed');
      return { answer: 'ok', searched: true, fresh: false };
    },
  });

  await assert.doesNotReject(brain.runRefresh());
  assert.deepEqual(asked, ['broken', 'healthy']);
});

test('runQuestion owns the cache write; the brain never double-writes', async () => {
  const c = clock();
  let writes = 0;
  const cache = {
    dueForRefresh: async () => [due('refresh me', c.now() + HOUR_MS)],
    keyFor: ({ question }) => question,
    set() { writes++; },
  };
  const brain = createBrain({
    cache,
    questions: [],
    now: c.now,
    setTimeoutFn: immediateTimeout,
    log: quietLog(),
    runQuestion: async () => ({ answer: 'x'.repeat(200), searched: true, fresh: false }),
  });

  await brain.runRefresh();
  assert.equal(writes, 0);
});

test('successful work logs only the required hashed question labels', async () => {
  const c = clock();
  const lines = [];
  const log = { info: (line) => lines.push(line), warn() {}, error() {} };
  const cache = {
    dueForRefresh: async () => [due('refresh this answer', c.now() + HOUR_MS)],
    keyFor: ({ question }) => question,
    get: async () => null,
  };
  const brain = createBrain({
    cache,
    questions: [due('precompute this answer', Number.MAX_SAFE_INTEGER)],
    now: c.now,
    setTimeoutFn: immediateTimeout,
    log,
    runQuestion: async () => ({ answer: 'x'.repeat(200), searched: false, fresh: false }),
  });

  await brain.runRefresh();
  await brain.runPrecompute();

  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\[BRAIN\] refresh: [a-f0-9]{12}$/);
  assert.match(lines[1], /^\[BRAIN\] pre-compute: [a-f0-9]{12}$/);
  assert.doesNotMatch(lines.join('\n'), /refresh this|precompute this/);
});

test('the curated source contains 20-30 non-personalised product questions', () => {
  assert.ok(CURATED_QUESTION_TEXTS.length >= 20 && CURATED_QUESTION_TEXTS.length <= 30);
  assert.ok(CURATED_QUESTION_TEXTS.some((q) => /Canva/i.test(q)));
  assert.ok(CURATED_QUESTION_TEXTS.some((q) => /AI classroom/i.test(q)));
  assert.ok(CURATED_QUESTION_TEXTS.some((q) => /council/i.test(q)));
  assert.ok(CURATED_QUESTION_TEXTS.some((q) => /price|cost|Pro/i.test(q)));
  assert.equal(new Set(CURATED_QUESTION_TEXTS).size, CURATED_QUESTION_TEXTS.length);
  for (const question of CURATED_QUESTION_TEXTS) {
    assert.doesNotMatch(question, /\b(my|me|I|our|we)\b/i, question);
  }

  const rows = createBrainQuestions({ branch: 'turn:tools-off' });
  assert.equal(rows.length, CURATED_QUESTION_TEXTS.length);
  assert.ok(rows.every((row) => row.branch === 'turn:tools-off' && row.plan === 'free'));
});
