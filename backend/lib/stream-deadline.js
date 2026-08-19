'use strict';

/**
 * THE TURN DEADLINE, ENFORCED FOR THE WHOLE STREAM AND NOT ONLY ITS HANDSHAKE.
 *
 * `fetchOpenRouterStream` arms one timer from `deadlineAt` and clears it in a
 * `finally` that also runs on the successful return — so at handoff the
 * deadline is gone, by design ("It bounds opening the stream, not reading it").
 * The parent-abort listener is deliberately kept alive past handoff, which
 * means the parent signal is the ONLY thing that can still stop a body being
 * read. In `server.js` the only `turnController.abort(...)` is the
 * client-disconnect handler, so nothing at all fired at `turnDeadlineAt`.
 *
 * Measured consequence, production: three turns outlived the 75 000 ms budget,
 * the worst at 115 703 ms with a 108 699 ms synthesis, every one of them
 * recorded `aborted: false` because nothing had aborted them.
 *
 * This composes the two signals that already exist rather than inventing a
 * third timeout: the caller's turn signal, and the caller's own deadline. Hand
 * the result to `fetchOpenRouterStream` as the parent signal and the abort link
 * it keeps past handoff carries a deadline abort as well as a user abort.
 *
 * `dispose()` releases the timer AND the parent listener together. A stream
 * that finished normally must leave neither behind, and a released composite
 * must be inert — a deadline that fires after its stream is over would abort
 * whatever is holding the signal next.
 *
 * The timer table is injectable so the deadline can be tested at its real
 * 75-second scale without waiting 75 seconds, and so a test can assert the
 * timer was CLEARED rather than merely never seen to fire.
 *
 * @param {AbortSignal|null|undefined} parentSignal the turn signal
 * @param {number|null} deadlineAt epoch ms; null means no deadline
 * @returns {{signal: AbortSignal, dispose: () => void}}
 */
function deadlineSignal(parentSignal, deadlineAt, timers = {}) {
  const now = timers.now || Date.now;
  const setTimer = timers.setTimer || setTimeout;
  const clearTimer = timers.clearTimer || clearTimeout;

  const controller = new AbortController();
  let timer = null;
  let released = false;

  const dispose = () => {
    if (released) return;
    released = true;
    if (timer !== null) { clearTimer(timer); timer = null; }
    parentSignal?.removeEventListener?.('abort', onParentAbort);
  };

  /* The parent's reason travels unchanged. A user closing a tab and a turn
   * running out of budget are different events with different fixes, and
   * relabelling one as the other is how a telemetry field starts lying. */
  function onParentAbort() {
    if (released) return;
    controller.abort(parentSignal?.reason ?? new DOMException('Aborted', 'AbortError'));
    dispose();
  }

  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason ?? new DOMException('Aborted', 'AbortError'));
    return { signal: controller.signal, dispose };
  }
  parentSignal?.addEventListener?.('abort', onParentAbort, { once: true });

  if (Number.isFinite(Number(deadlineAt))) {
    const remaining = Number(deadlineAt) - now();
    const expire = () => {
      timer = null;
      const error = new Error('Stream exceeded the turn deadline');
      error.code = 'OPENROUTER_DEADLINE';
      controller.abort(error);
      dispose();
    };
    if (remaining <= 0) expire();
    else {
      timer = setTimer(expire, remaining);
      /* Never hold the process open for a deadline that no longer matters. */
      if (timer && typeof timer.unref === 'function') timer.unref();
    }
  }

  return { signal: controller.signal, dispose };
}

module.exports = { deadlineSignal };
