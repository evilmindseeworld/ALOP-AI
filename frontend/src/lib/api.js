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

export default useApi;
