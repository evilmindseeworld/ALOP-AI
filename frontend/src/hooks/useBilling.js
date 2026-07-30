import { useState, useCallback, useEffect } from "react";

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
  const [prices, setPrices] = useState(null);
  const [billingBusy, setBillingBusy] = useState(false);

  const fetchPlan = useCallback(async () => {
    try {
      const r = await apiCall("/api/user/plan");
      setUserPlan((await r.json()).plan || "free");
    } catch (e) {
      console.error(e.message);
    }
  }, [apiCall]);

  // A non-OK response is not an error worth surfacing.
  const fetchPrices = useCallback(async () => {
    try {
      const r = await apiCall("/api/billing/prices");
      if (!r.ok) return;
      setPrices(await r.json());
    } catch (e) {
      console.error(e.message);
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
            setToast("Pro is active — all 7 models unlocked.");
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

  return { userPlan, setUserPlan, prices, billingBusy, startCheckout, openBillingPortal };
}

export default useBilling;
