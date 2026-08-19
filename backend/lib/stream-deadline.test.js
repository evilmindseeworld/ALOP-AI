'use strict';

/**
 * THE TURN DEADLINE STOPPED BEING ENFORCED THE MOMENT THE HEADERS ARRIVED.
 *
 * `fetchOpenRouterStream` builds ONE timer from `deadlineAt`:
 *
 *     const timer = setTimeout(() => controller.abort('timeout'), remainingMs);
 *     ...
 *     if (response.ok) { handedOff = true; return response; }
 *     } finally { clearTimeout(timer); if (!handedOff) parentSignal?.removeEventListener(...) }
 *
 * `finally` runs on the success return too, so the deadline timer is destroyed
 * at handoff — by design, and the comment says so: "It bounds opening the
 * stream, not reading it". The parent-abort listener is deliberately KEPT, so
 * after handoff the only route left to stop the body is `parentSignal`. And in
 * `server.js` the only `turnController.abort(...)` is the client-disconnect
 * handler. Nothing fires at `turnDeadlineAt`.
 *
 * So a stream whose headers arrive one millisecond before the deadline may then
 * consume tokens for as long as the provider keeps sending them.
 *
 * MEASURED IN PRODUCTION, not theorised. Three turns outlived
 * `STREAM_TURN_BUDGET_MS` (75 000):
 *
 *     2026-08-18T14:14:00Z  turnMs=115703  synthesisMs=108699  aborted=false
 *     2026-08-13T21:24:57Z  turnMs=113864  synthesisMs= 91055  aborted=false
 *     2026-08-14T14:55:22Z  turnMs= 87442  synthesisMs= 52214  aborted=false
 *
 * Worst overrun 40 703 ms past a budget the code calls a deadline, with
 * `aborted: false` and no cancellation recorded — because nothing cancelled it.
 *
 * THE FIX IS NOT A NEW TIMEOUT. It composes the deadline the caller already
 * passes with the turn signal it already has, so the abort link that
 * `fetchOpenRouterStream` deliberately keeps alive past handoff now carries a
 * deadline abort as well as a user abort. Timer and listener are released
 * together, so neither outlives the stream.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { deadlineSignal } = require('./stream-deadline');

/* A hand-driven clock and timer table: a real 75-second deadline is not a
 * thing a unit test may wait for, and `setTimeout` under a fake clock is the
 * only way to assert the timer is CLEARED rather than merely never observed. */
const fakeTimers = () => {
  let now = 1_000_000;
  const live = new Map();
  let nextId = 1;
  return {
    now: () => now,
    setTimer: (fn, ms) => { const id = nextId++; live.set(id, { fn, at: now + ms }); return id; },
    clearTimer: (id) => { live.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...live]) if (t.at <= now) { live.delete(id); t.fn(); }
    },
    outstanding: () => live.size,
  };
};

test('a stream that opens before the deadline is still aborted when it expires mid-body', () => {
  const timers = fakeTimers();
  const parent = new AbortController();
  const { signal } = deadlineSignal(parent.signal, timers.now() + 75_000, timers);

  /* The handshake completes with a millisecond to spare — the exact case the
   * old code stopped caring about. */
  timers.advance(74_999);
  assert.equal(signal.aborted, false, 'a stream inside its budget is left alone');

  timers.advance(2);
  assert.equal(signal.aborted, true, 'and the body cannot outlive the deadline');
  assert.equal(signal.reason?.code, 'OPENROUTER_DEADLINE');
});

test('body consumption cannot continue indefinitely past the deadline', () => {
  const timers = fakeTimers();
  const { signal } = deadlineSignal(new AbortController().signal, timers.now() + 75_000, timers);
  timers.advance(10 * 60_000); // the 108.7s synthesis, and then some
  assert.equal(signal.aborted, true);
});

test('a normally completing stream is untouched, and releases its timer', () => {
  const timers = fakeTimers();
  const { signal, dispose } = deadlineSignal(new AbortController().signal, timers.now() + 75_000, timers);
  timers.advance(9_601); // the same model, measured out of band
  dispose();
  assert.equal(signal.aborted, false, 'a healthy stream is never aborted mid-word');
  assert.equal(timers.outstanding(), 0, 'and no timer is left armed behind it');
  timers.advance(10 * 60_000);
  assert.equal(signal.aborted, false, 'a released deadline cannot fire later');
});

test('a user abort still cancels the stream, immediately and with its own reason', () => {
  const timers = fakeTimers();
  const parent = new AbortController();
  const { signal } = deadlineSignal(parent.signal, timers.now() + 75_000, timers);
  const why = new DOMException('Client disconnected', 'AbortError');
  parent.abort(why);
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason, why, 'a user leaving is not a deadline, and must not be relabelled as one');
});

test('a parent that has already aborted is honoured without waiting for a tick', () => {
  const timers = fakeTimers();
  const parent = new AbortController();
  parent.abort(new DOMException('Aborted', 'AbortError'));
  const { signal } = deadlineSignal(parent.signal, timers.now() + 75_000, timers);
  assert.equal(signal.aborted, true);
});

test('dispose detaches the parent listener, so a finished stream leaks nothing', () => {
  const timers = fakeTimers();
  const parent = new AbortController();
  const { signal, dispose } = deadlineSignal(parent.signal, timers.now() + 75_000, timers);
  dispose();
  parent.abort(new DOMException('Aborted', 'AbortError'));
  assert.equal(signal.aborted, false, 'a released composite is inert');
  assert.equal(timers.outstanding(), 0);
});

/* No deadline is a real configuration — `streamOnce` passes null when the
 * caller has no turn budget — and it must not invent one. */
test('no deadline arms no timer', () => {
  const timers = fakeTimers();
  const parent = new AbortController();
  const { signal, dispose } = deadlineSignal(parent.signal, null, timers);
  assert.equal(timers.outstanding(), 0, 'a missing deadline is not a new arbitrary timeout');
  parent.abort(new DOMException('Aborted', 'AbortError'));
  assert.equal(signal.aborted, true, 'and the user abort still works');
  dispose();
});

/* A deadline already in the past aborts at once rather than scheduling into it. */
test('a deadline that has already passed aborts immediately', () => {
  const timers = fakeTimers();
  const { signal } = deadlineSignal(new AbortController().signal, timers.now() - 1, timers);
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason?.code, 'OPENROUTER_DEADLINE');
});
