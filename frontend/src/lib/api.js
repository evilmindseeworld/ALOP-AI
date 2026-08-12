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

/**
 * A promise that rejects when `signal` aborts, and never resolves.
 *
 * Exported because `getToken()` is not a fetch, so no signal can cancel it —
 * anywhere a token is awaited before a request, it has to be raced against
 * the abort that is supposed to be able to cancel that request. The council
 * stream in `useChats` is the other such place.
 */
export function untilAborted(signal) {
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
      // An ALREADY-aborted signal never fires the event, so subscribing alone
      // would ignore it for the full 45s. Real `fetch` rejects immediately on
      // a pre-aborted signal and this wrapper has to match that.
      if (external?.aborted) relay();
      else external?.addEventListener("abort", relay, { once: true });

      const release = () => {
        clearTimeout(timer);
        external?.removeEventListener("abort", relay);
      };
      // Only OUR deadline becomes a timeout. A caller who aborted on purpose
      // gets their own abort back, not a message blaming the network.
      const asTimeout = (e) =>
        timedOut ? new Error(`Request timed out after ${API_TIMEOUT_MS / 1000}s`) : e;

      let res;
      try {
        const token = await Promise.race([getToken(), untilAborted(controller.signal)]);
        res = await fetch(`${API_BASE}${path}`, {
          ...options,
          signal: controller.signal,
          headers: {
            ...options.headers,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
      } catch (e) {
        release();
        throw asTimeout(e);
      }

      // THE DEADLINE HAS TO OUTLIVE THIS RETURN, and getting that wrong is how
      // the first version of this fix still shipped the bug it was fixing.
      //
      // `fetch` resolves as soon as the response HEADERS arrive. The body has
      // not been read yet, and every caller reads it — `await res.json()` —
      // after this function has returned. Clearing the timer here left a
      // backend that answers headers and then stalls the body hanging the
      // caller exactly as before: `loadChats` waits at its `res.json()`, its
      // `finally` never runs, and the skeletons stay up forever.
      //
      // So the timer keeps running, and CONSUMING THE BODY is what releases
      // it. A caller that never reads the body (the DELETE and PUT routes)
      // simply lets the timer expire and abort a response that has already
      // completed, which does nothing.
      // Guarded: a wrapper whose whole job is to stop a hang must not become a
      // new way to throw. Anything without a `json` gets the timer released
      // now rather than a TypeError.
      if (typeof res?.json !== "function") {
        release();
        return res;
      }

      const readJson = res.json.bind(res);
      res.json = async () => {
        try {
          return await readJson();
        } catch (e) {
          throw asTimeout(e);
        } finally {
          release();
        }
      };
      return res;
    },
    [getToken]
  );
}

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
 * THIS IS THE FIRST THING TO SUSPECT for an intermittent failure that happens
 * "on start" and then goes away: a boot slower than API_TIMEOUT_MS reaches the
 * user as a failed request with no server-side error, because the request never
 * arrived. `warmBackend` shortens that window rather than closing it.
 *
 * Deliberately fire-and-forget: nothing awaits it, a failure is ignored, and
 * it can never delay or break a render. `keepalive` lets it outlive the
 * navigation that started it.
 */
export function warmBackend() {
  try {
    fetch(`${API_BASE}/health`, { method: "GET", mode: "cors", keepalive: true }).catch(() => {});
  } catch {
    /* never let a warm-up break boot */
  }
}

export default useApi;
