import { useState, useCallback } from "react";

/**
 * What the assistant has stored about this user, across every chat.
 *
 * This exists because the memory exists. Facts are extracted from the user's
 * own messages and replayed into every later conversation, so a wrong one
 * quietly conditions every answer that follows — and it is self-reinforcing,
 * since the answers it shapes are what the next extraction reads. Memory a
 * person can neither see nor delete is not a feature, it is a door they cannot
 * open.
 *
 * Loaded on demand rather than at startup: nothing renders it until Settings is
 * open, and a request nobody is waiting for is latency on the path they are.
 *
 * FAILURE MUST NOT LOOK LIKE "NOTHING STORED". An empty list and a failed
 * request are indistinguishable to a reader, and the wrong one of those tells
 * someone their data was deleted. Same shape the other four surfaces settled
 * on: state the error, keep whatever list is already held, offer the retry.
 */
export function useUserFacts({ apiCall, setToast }) {
  const [facts, setFacts] = useState(null); // null = not loaded yet, [] = genuinely none
  const [factsError, setFactsError] = useState(null);
  const [factsBusy, setFactsBusy] = useState(false);

  const loadFacts = useCallback(async () => {
    setFactsBusy(true);
    setFactsError(null);
    try {
      const r = await apiCall("/api/user/facts");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setFacts(Array.isArray(d.facts) ? d.facts : []);
    } catch (e) {
      console.error(e.message);
      // Deliberately does NOT clear `facts`. A refresh that fails leaves the
      // last known list on screen with an error above it.
      setFactsError(e.message || "Request failed");
    } finally {
      setFactsBusy(false);
    }
  }, [apiCall]);

  const deleteFact = useCallback(
    async (id) => {
      // Optimistic, with the row restored on failure. Deleting one line out of
      // a list is the one case where waiting for a round trip feels broken, and
      // the rollback is cheap because we hold the row.
      const previous = facts;
      setFacts((cur) => (cur || []).filter((f) => f.id !== id));
      try {
        const r = await apiCall(`/api/user/facts/${id}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setToast?.("Forgotten.");
      } catch (e) {
        console.error(e.message);
        setFacts(previous);
        setToast?.("Couldn't delete that. Try again.");
      }
    },
    [apiCall, facts, setToast],
  );

  const forgetAll = useCallback(async () => {
    const previous = facts;
    setFacts([]);
    try {
      const r = await apiCall("/api/user/facts", { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setToast?.("Memory cleared.");
    } catch (e) {
      console.error(e.message);
      setFacts(previous);
      setToast?.("Couldn't clear memory. Try again.");
    }
  }, [apiCall, facts, setToast]);

  return { facts, factsError, factsBusy, loadFacts, deleteFact, forgetAll };
}
