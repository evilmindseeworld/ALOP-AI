/**
 * Small AbortSignal helpers shared by the council's deadlines and its
 * provider adapters.
 *
 * A timeout signal by itself cannot see a request disconnect, and a request
 * signal by itself cannot enforce a provider's own patience. These helpers
 * join the two without relying on AbortSignal.any, which is not available on
 * every Node version this service declares support for.
 */

function childAbortController(parentSignal) {
  const controller = new AbortController();
  let detach = () => {};

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      const forward = () => controller.abort(parentSignal.reason);
      parentSignal.addEventListener("abort", forward, { once: true });
      detach = () => parentSignal.removeEventListener("abort", forward);
    }
  }

  return {
    controller,
    signal: controller.signal,
    dispose() {
      detach();
      detach = () => {};
    },
  };
}

function timeoutSignal(parentSignal, timeoutMs) {
  const child = childAbortController(parentSignal);
  const timer = Number.isFinite(timeoutMs)
    ? setTimeout(() => {
        child.controller.abort(new DOMException(`Timed out after ${timeoutMs}ms`, "TimeoutError"));
      }, Math.max(0, timeoutMs))
    : null;
  timer?.unref?.();

  return {
    signal: child.signal,
    dispose() {
      if (timer) clearTimeout(timer);
      child.dispose();
    },
  };
}

module.exports = { childAbortController, timeoutSignal };
