import { useCallback } from "react";

export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000";

/**
 * How long any single API call may take before it is abandoned.
 *
 * MEASURED, not picked: a cold Render free-tier boot takes 22.5s, so anything
 * at or below that would turn a slow start into a fake failure. 45s is that
 * number with margin, and it is the knob to turn if the hosting plan changes.
 */
export const API_TIMEOUT_MS = 45_000;

/** A promise that rejects when `signal` aborts, and never resolves. */
function untilAborted(signal) {
  return new Promise((_, reject) => {
    const fail = () => reject(new Error("aborted"));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

/**
 * An authenticated `fetch` bound to the API base.
 *
 * The Clerk token is fetched per call rather than held: it is short-lived, and
 * a cached one is exactly how a long-lived tab starts 401ing.
 *
 * EVERY call is bounded, and that is the point rather than a nicety. Callers
 * clear their loading state in a `finally` — `loadChats` is the one that bit
 * us — so a request that never settles leaves the app on skeleton loaders
 * indefinitely, with no error, no toast and nothing to click. A sleeping
 * backend produced exactly that. The bound belongs here, in the one function
 * every route goes through, rather than in each caller.
 *
 * Both phases are covered: `getToken()` can hang on its own if Clerk is
 * unreachable, and it is not a fetch, so the signal cannot cancel it. It is
 * raced against the same deadline instead of being given a second timer.
 */
export function useApi(getToken) {
  return useCallback(
    async (path, options = {}) => {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, API_TIMEOUT_MS);

      // A caller's own signal still has to work, so relay it rather than
      // replace it. Without this, passing `signal` would silently do nothing.
      const external = options.signal;
      const relay = () => controller.abort();
      external?.addEventListener("abort", relay, { once: true });

      try {
        const token = await Promise.race([getToken(), untilAborted(controller.signal)]);
        return await fetch(`${API_BASE}${path}`, {
          ...options,
          signal: controller.signal,
          headers: {
            ...options.headers,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
      } catch (e) {
        // Only OUR deadline becomes a timeout. A caller who aborted on purpose
        // gets their own abort back, not a message blaming the network.
        if (timedOut) throw new Error(`Request timed out after ${API_TIMEOUT_MS / 1000}s`);
        throw e;
      } finally {
        clearTimeout(timer);
        external?.removeEventListener("abort", relay);
      }
    },
    [getToken]
  );
}

/**
 * Wake the backend, as early as possible, without blocking anything.
 *
 * MEASURED, not guessed: /health takes 22.5s on the first request after the
 * service has been idle, and 0.21s once warm. Render's free tier spins the
 * instance down after inactivity, and the next caller pays the whole boot.
 *
 * That cost is unavoidable here — it is a hosting plan, not a code path — but
 * WHEN it is paid is entirely up to us. It used to land after Clerk finished,
 * when the app made its first real request, so the user watched a spinner for
 * 22 seconds having already signed in. Firing this at module load runs the
 * boot CONCURRENTLY with loading Clerk, rendering the sign-in page, and the
 * user typing their credentials — all of which is dead time the server can
 * spend starting up.
 *
 * Deliberately fire-and-forget: nothing awaits it, a failure is ignored, and
 * it can never delay or break a render. `keepalive` lets it outlive the
 * navigation that started it.
 */
/**
 * The IANA timezone this browser is set to, or null.
 *
 * The one location signal the server cannot see for itself. It is stable,
 * user-correctable, and far more specific than a language tag — `Asia/Dubai`
 * is one country, while `en-GB` is spoken in dozens.
 *
 * Deliberately NOT geolocation: no permission prompt, no coordinates, nothing
 * the user has to agree to. A timezone is a device setting, it is already sent
 * to every analytics script on the web, and the server turns it into a country
 * and a currency and then forgets it.
 */
export function clientTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function warmBackend() {
  try {
    fetch(`${API_BASE}/health`, { method: "GET", mode: "cors", keepalive: true }).catch(() => {});
  } catch {
    /* never let a warm-up break boot */
  }
}

export default useApi;
