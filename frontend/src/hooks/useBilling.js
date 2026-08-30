import { useState, useCallback, useEffect } from "react";
import { COUNCIL } from "../constants/council";

/**
 * Plan, prices, checkout and the post-payment return.
 *
 * `prices` is null until proven otherwise, and null means "billing is not
 * configured on this deployment". The endpoint 503s when the Stripe price IDs
 * are unset, and the correct response is to hide the upgrade path entirely
 * rather than offer a checkout that would fail.
 */
export function useBilling({ apiCall, isReady, setToast }) {
  const [userPlan, setUserPlan] = useState("free");
  const [planError, setPlanError] = useState(null);
  const [prices, setPrices] = useState(null);
  const [billingBusy, setBillingBusy] = useState(false);
  /* Two failures worth telling apart, because they need different words.
   *
   * `pricesError` means the request failed and retrying may work.
   * `pricesUnavailable` means the server answered, correctly, that this
   * deployment has no Stripe price IDs — retrying will never help, and the
   * honest thing is to say checkout is not configured rather than to offer a
   * button that cannot complete. Collapsing them into one state produced a
   * Retry that looped forever against a 503. */
  const [pricesError, setPricesError] = useState(null);
  const [pricesUnavailable, setPricesUnavailable] = useState(false);

  /* A FAILURE HERE MUST NOT LOOK LIKE "free".
   *
   * This used to swallow the error and leave userPlan at its "free" initial
   * value, so a paying customer whose plan request failed was shown the free
   * tier and an upgrade prompt for something they had already bought. The
   * plan is only ever downgraded by a response that actually said so. */
  const fetchPlan = useCallback(async () => {
    setPlanError(null);
    try {
      const r = await apiCall("/api/user/plan");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setUserPlan((await r.json()).plan || "free");
    } catch (e) {
      console.error(e.message);
      setPlanError(e.message || "Request failed");
    }
  }, [apiCall]);

  const fetchPrices = useCallback(async () => {
    setPricesError(null);
    setPricesUnavailable(false);
    try {
      const r = await apiCall("/api/billing/prices");
      // 503 is the server saying this deployment has no price IDs. That is a
      // configuration fact, not a transport failure, and it is permanent
      // until someone changes an environment variable.
      if (r.status === 503) return setPricesUnavailable(true);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setPrices(await r.json());
    } catch (e) {
      console.error(e.message);
      setPricesError(e.message || "Request failed");
    }
  }, [apiCall]);

  const startCheckout = useCallback(
    async (plan) => {
      setBillingBusy(true);
      try {
        const r = await apiCall("/api/create-checkout-session", {
          method: "POST",
          body: JSON.stringify({ plan }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.url) throw new Error(d.error || "Couldn't start checkout.");
        window.location.href = d.url;
        // Deliberately leaves billingBusy set — we are navigating away, and
        // re-enabling the button would invite a second checkout session.
      } catch (e) {
        setToast(e.message);
        setBillingBusy(false);
      }
    },
    [apiCall, setToast]
  );

  const openBillingPortal = useCallback(async () => {
    setBillingBusy(true);
    try {
      const r = await apiCall("/api/create-portal-session", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error || "Couldn't open the billing portal.");
      window.location.href = d.url;
    } catch (e) {
      setToast(e.message);
      setBillingBusy(false);
    }
  }, [apiCall, setToast]);

  useEffect(() => {
    if (!isReady) return;
    fetchPlan();
    fetchPrices();
  }, [isReady, fetchPlan, fetchPrices]);

  /**
   * Stripe sends the customer back to `/?payment=success`, which nothing used
   * to read — a completed payment landed on an unchanged page with no
   * acknowledgement at all.
   */
  useEffect(() => {
    if (!isReady) return;

    const payment = new URLSearchParams(window.location.search).get("payment");
    if (!payment) return;

    // Strip it straight away so a refresh does not replay the toast.
    window.history.replaceState({}, "", window.location.pathname);

    if (payment === "cancelled") {
      setToast("Checkout cancelled — you haven't been charged.");
      return;
    }
    if (payment !== "success") return;

    setToast("Payment received. Activating Pro...");

    // The webhook that flips the plan can land after this redirect, so reading
    // the plan once would often still say "free" to someone who just paid.
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 6 && !cancelled; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        if (cancelled) return;
        try {
          const d = await (await apiCall("/api/user/plan")).json();
          if (d.plan === "pro") {
            setUserPlan("pro");
            setToast(`Pro is active — all ${COUNCIL.length} models unlocked.`);
            return;
          }
        } catch (e) {
          console.error(e.message);
        }
      }
      if (!cancelled) setToast("Payment received. Pro will activate shortly.");
    })();

    return () => {
      cancelled = true;
    };
  }, [isReady, apiCall, setToast]);

  return {
    userPlan,
    setUserPlan,
    planError,
    retryPlan: fetchPlan,
    prices,
    pricesError,
    pricesUnavailable,
    retryPrices: fetchPrices,
    billingBusy,
    startCheckout,
    openBillingPortal,
  };
}

export default useBilling;
