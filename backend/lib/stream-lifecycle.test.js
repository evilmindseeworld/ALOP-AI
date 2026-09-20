'use strict';

/**
 * THE DEADLINE, EXERCISED END TO END RATHER THAN ASSERTED ON BY SHAPE.
 *
 * `lib/stream-deadline.test.js` proves the composer in isolation and the wiring
 * tests prove server.js calls it. Neither proves the thing that actually broke:
 * a stream whose HEADERS arrive in time and whose BODY then never stops.
 *
 * So this drives the real `streamOnce`/`streamModel` — sliced out of server.js
 * and given its dependencies by name, the way `council-runtime-contract.test.js`
 * already does — against a fake gateway whose body stalls, completes, or dies
 * on command. Real timers at a small scale, because the property under test is
 * "the abort actually reaches a blocked reader", and a fake clock would prove
 * only that a callback fires.
 *
 * The bug being regressed, measured in production: three turns outlived the
 * 75 000 ms budget, worst 115 703 ms with a 108 699 ms synthesis, every one
 * recorded `aborted: false` because nothing had aborted them.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { deadlineSignal } = require('./stream-deadline');
const { fetchOpenRouterStream, parseOpenRouterSseLine } = require('./openrouter');
const { rescueReasoning } = require('./reasoning-rescue');
const { createTurnTelemetry } = require('./turn-telemetry');
const { canRetryStream } = require('./stream-retry-policy');

const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

const NL = String.fromCharCode(10);

/* A gateway whose body is under the test's control. `stall` never sends another
 * frame, which is the 108-second synthesis reduced to its essence; the reader
 * blocks in `reader.read()` and only an abort can free it. */
const fakeGateway = ({ frames = [], stall = false, openDelayMs = 0, onRequest = null }) => async (_url, options) => {
  onRequest?.(options);
  if (openDelayMs) await new Promise((r) => setTimeout(r, openDelayMs));
  const signal = options && options.signal;
  const body = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(f));
      if (stall) {
        if (signal && signal.aborted) return controller.error(signal.reason);
        if (signal) signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        return; // never closes on its own
      }
      controller.close();
    },
  });
  return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, body };
};

const sse = (text) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + NL + NL;
const done = () => 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + NL + NL
  + 'data: [DONE]' + NL + NL;

const fakeRes = () => ({
  locals: {},
  writes: [],
  writableEnded: false,
  writableFinished: false,
  write(chunk) { this.writes.push(String(chunk)); return true; },
  end() { this.writableEnded = true; },
});

/* The policy, with every free variable named. The parameter list is the honest
 * statement of what the streaming lifecycle depends on from the rest of
 * server.js — and `deadlineSignal` is wrapped so a test can assert the disposer
 * ran, which is the difference between "cleaned up" and "not observed to leak". */
const loadPolicy = (fetchImpl) => {
  const policy = SOURCE.slice(SOURCE.indexOf('const normaliseResetEpoch'), SOURCE.indexOf('const callGeminiVision'));
  const composed = [];
  const spyDeadline = (parent, deadlineAt, timers) => {
    const made = deadlineSignal(parent, deadlineAt, timers);
    const record = { disposed: 0, signal: made.signal };
    composed.push(record);
    return { signal: made.signal, dispose: () => { record.disposed += 1; made.dispose(); } };
  };
  const gateway = async (...args) => {
    const real = global.fetch;
    global.fetch = fetchImpl;
    try { return await fetchOpenRouterStream(...args); } finally { global.fetch = real; }
  };
  const api = Function(
    'fetch', 'fetchOpenRouterStream', 'OPENROUTER_HOST', 'OPENROUTER_API_KEY', 'PRIMARY_MODEL', 'SMART_MODEL',
    'parseOpenRouterSseLine', 'looksLikeProtocolOpening', 'sanitizeAnswerText', 'STREAM_USAGE_ACCOUNTING',
    'deadlineSignal', 'requiredCitationSuffix', 'providerHealth', 'rescueReasoning', 'canRetryStream',
    policy + NL + 'return { streamModel, streamOnce };',
  )(
    fetchImpl, gateway, 'https://openrouter.test', 'secret', 'primary:free', 'smart:free',
    parseOpenRouterSseLine, () => false, (text) => ({ text, rejected: false }), false,
    spyDeadline, () => '', { record() {} }, rescueReasoning, canRetryStream,
  );
  return Object.assign(api, { composed });
};

/* Routed through the REAL recorder, exactly as production wires it
 * (`onStreamTiming = (row) => telemetry.recordStreamTiming({ ...row, phase })`),
 * so the rows asserted on are the rows an audit row would carry — including
 * `streamTotalMs`, which is derived there so the three boundaries can never
 * disagree. Asserting on the raw callback argument would test a shape that
 * nothing ever persists. */
const run = async (gatewayOpts, {
  deadlineIn = 200,
  abortAfterMs = null,
  answerOptions = {},
  modelOptions = {},
} = {}) => {
  const { streamModel, composed } = loadPolicy(fakeGateway(gatewayOpts));
  const telemetry = createTurnTelemetry();
  const parent = new AbortController();
  if (abortAfterMs !== null) {
    setTimeout(() => parent.abort(new DOMException('Client disconnected', 'AbortError')), abortAfterMs);
  }
  const res = fakeRes();
  const startedAt = Date.now();
  let error = null;
  let answer = null;
  try {
    answer = await streamModel(
      res, 'primary:free', [], 0, parent.signal, 100, answerOptions,
      deadlineIn === null ? null : startedAt + deadlineIn,
      {
        onStreamTiming: (row) => telemetry.recordStreamTiming({ ...row, phase: 'synthesis' }),
        fallbackModels: [],
        ...modelOptions,
      },
    );
  } catch (err) {
    error = err;
  }
  return {
    rows: telemetry.snapshot({}).streamTimings,
    error,
    answer,
    elapsed: Date.now() - startedAt,
    composed,
    writes: res.writes,
  };
};

test('a stream that opens in time but stalls mid-body is aborted at the turn deadline', async () => {
  const { rows, error, elapsed } = await run({ frames: [sse('partial ')], stall: true }, { deadlineIn: 250 });
  assert.ok(error, 'a stalled body must not resolve');
  assert.ok(elapsed < 3000, `the reader must be freed by the deadline, not left blocked (took ${elapsed}ms)`);
  assert.equal(rows.length, 1, 'exactly one stream row, no double-settle');
  assert.equal(rows[0].outcome, 'aborted');
  assert.equal(rows[0].abortReason, 'turn_deadline');
  assert.equal(rows[0].completed, false);
  assert.equal(rows[0].aborted, true);
});

test('a stream that completes before the deadline behaves exactly as before', async () => {
  const { rows, error, answer } = await run({ frames: [sse('hello '), sse('world'), done()] }, { deadlineIn: 5000 });
  assert.equal(error, null, 'a healthy stream must not be disturbed by the deadline');
  assert.equal(answer, 'hello world');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, 'ok');
  assert.equal(rows[0].completed, true);
  assert.equal(rows[0].aborted, false);
  assert.equal(rows[0].abortReason, null);
});

test('open plus body equals total, within rounding', async () => {
  const { rows } = await run({ frames: [sse('x'), done()], openDelayMs: 40 }, { deadlineIn: 5000 });
  const r = rows[0];
  assert.ok(r.streamOpenMs >= 30, `open must capture the handshake, got ${r.streamOpenMs}ms`);
  assert.equal(r.streamOpenMs + r.streamBodyMs, r.streamTotalMs);
});

test('a deadline that has already expired aborts before any body is consumed', async () => {
  const { rows, error, answer } = await run({ frames: [sse('should not arrive'), done()] }, { deadlineIn: -1 });
  assert.ok(error, 'an expired budget cannot produce an answer');
  assert.equal(answer, null);
  assert.ok(rows.length <= 1, 'and cannot report twice');
});

test('a client disconnect before the deadline aborts at once and is labelled as the client', async () => {
  const { rows, error, elapsed } = await run({ frames: [sse('partial')], stall: true }, { deadlineIn: 5000, abortAfterMs: 60 });
  assert.ok(error);
  assert.ok(elapsed < 3000, `a user leaving must free the reader immediately (took ${elapsed}ms)`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].abortReason, 'client', 'a user leaving is not a deadline and must not be relabelled');
  assert.equal(rows[0].aborted, true);
});

test('a deadline abort stops the body clock at the abort, not at the provider eventually closing', async () => {
  const { rows } = await run({ frames: [sse('partial')], stall: true }, { deadlineIn: 200 });
  const r = rows[0];
  assert.ok(r.streamBodyMs < 3000, `body time must stop at the abort, got ${r.streamBodyMs}ms`);
  assert.ok(r.streamTotalMs < 3000);
  assert.equal(r.streamOpenMs + r.streamBodyMs, r.streamTotalMs);
});

test('the composed deadline is disposed after the reader finishes, on both outcomes', async () => {
  const ok = await run({ frames: [sse('x'), done()] }, { deadlineIn: 5000 });
  assert.ok(ok.composed.length >= 1, 'a composed signal must have been made');
  assert.ok(ok.composed.every((c) => c.disposed >= 1), 'a completed stream must release its deadline');

  const cut = await run({ frames: [sse('x')], stall: true }, { deadlineIn: 200 });
  assert.ok(cut.composed.every((c) => c.disposed >= 1), 'an aborted stream must release its deadline too');
});

/* A released composite must be inert, or a deadline belonging to a finished
 * stream fires into whatever holds the signal next. */
test('a disposed deadline never aborts afterwards', async () => {
  const { composed } = await run({ frames: [sse('x'), done()] }, { deadlineIn: 120 });
  await new Promise((r) => setTimeout(r, 260));
  assert.ok(composed.every((c) => !c.signal.aborted), 'the deadline must not fire after its stream is over');
});

/* An unref'd timer cannot hold the event loop open. Asserted directly rather
 * than by relying on the test runner hanging to reveal it. */
test('the deadline timer does not keep the process alive', () => {
  const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  const { dispose } = deadlineSignal(new AbortController().signal, Date.now() + 3_600_000);
  dispose();
  const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  assert.ok(after <= before, 'a disposed deadline must leave no timer handle behind');
});

const chunkWrites = (writes) => writes
  .filter((write) => write.startsWith('data: {'))
  .map((write) => JSON.parse(write.slice('data: '.length).trim()))
  .filter((event) => event.type === 'chunk')
  .map((event) => event.text);

test('deferred output commits exactly one validated answer and never leaks the discarded draft', async () => {
  const completions = [];
  const result = await run(
    { frames: [sse('draft A'), done()] },
    {
      deadlineIn: 5000,
      answerOptions: {
        deferOutput: true,
        answerGuard: (text) => ({ ok: text === 'draft B' }),
        outputFallback: 'draft B',
        onComplete: (event) => completions.push(event),
      },
    },
  );

  assert.equal(result.error, null);
  assert.equal(result.answer, 'draft B');
  assert.deepEqual(chunkWrites(result.writes), ['draft B']);
  assert.equal(completions.length, 1);
  assert.equal(completions[0].answer, 'draft B');
  assert.equal(completions[0].finishReason, null, 'the discarded stream finish reason cannot describe the fallback text');
  assert.deepEqual(completions[0].substitution, { used: true, reason: 'answer_contract' });
});

test('a local answer-contract rejection does not rerun the full model ladder', async () => {
  let requests = 0;
  const result = await run(
    { frames: [sse('unsupported draft'), done()], onRequest: () => { requests += 1; } },
    {
      deadlineIn: 5000,
      answerOptions: {
        deferOutput: true,
        answerGuard: () => ({ ok: false, problems: [{ kind: 'unsupported_claims' }] }),
      },
      modelOptions: { fallbackModels: ['recovery:free', 'last-resort:free'] },
    },
  );

  assert.equal(result.error?.code, 'ANSWER_OUTPUT_CONTRACT');
  assert.equal(requests, 1, 'a deterministic local gate must not spend the provider ladder again');
  assert.deepEqual(chunkWrites(result.writes), []);
});

test('an invalid substituted answer is neither displayed nor retried', async () => {
  let requests = 0;
  const result = await run(
    { frames: [sse('draft A'), done()], onRequest: () => { requests += 1; } },
    {
      deadlineIn: 5000,
      answerOptions: {
        deferOutput: true,
        answerGuard: () => ({ ok: false, problems: [{ kind: 'unsupported_citation' }] }),
        outputFallback: 'draft B',
      },
      modelOptions: { fallbackModels: ['recovery:free'] },
    },
  );

  assert.equal(result.error?.code, 'ANSWER_OUTPUT_CONTRACT');
  assert.equal(requests, 1);
  assert.deepEqual(chunkWrites(result.writes), []);
});

test('the normal deferred path reports the provider completion for the text it commits', async () => {
  const completions = [];
  const result = await run(
    { frames: [sse('draft A'), done()] },
    {
      deadlineIn: 5000,
      answerOptions: {
        deferOutput: true,
        answerGuard: () => ({ ok: true }),
        onComplete: (event) => completions.push(event),
      },
    },
  );

  assert.equal(result.error, null);
  assert.deepEqual(chunkWrites(result.writes), ['draft A']);
  assert.deepEqual(completions[0].substitution, null);
  assert.equal(completions[0].finishReason, 'stop');
});
