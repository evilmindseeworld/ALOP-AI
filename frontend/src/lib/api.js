import { useCallback } from "react";

export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000";

/**
 * An authenticated `fetch` bound to the API base.
 *
 * The Clerk token is fetched per call rather than held: it is short-lived, and
 * a cached one is exactly how a long-lived tab starts 401ing.
 */
export function useApi(getToken) {
  return useCallback(
    async (path, options = {}) => {
      const token = await getToken();
      return fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
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
