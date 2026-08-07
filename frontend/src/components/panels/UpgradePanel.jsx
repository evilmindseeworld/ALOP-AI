import SidePanel from "../SidePanel";
import { formatPrice } from "../../lib/format";

/**
 * The upgrade path.
 *
 * THE PANEL USED TO NOT OPEN AT ALL. App.jsx gated it on
 * `Boolean(billing.prices)`, so if the prices request failed, clicking
 * Upgrade did nothing — no panel, no message, no error. A dead button on the
 * one screen where the user is trying to give you money, and indistinguishable
 * from the app being broken.
 *
 * It opens now and says which of the two things happened, because they are
 * not the same and only one of them is worth retrying:
 *
 *   pricesUnavailable  the server answered 503 — this deployment has no
 *                      Stripe price IDs. Permanent until someone changes an
 *                      environment variable. No retry, because there is
 *                      nothing to retry.
 *   pricesError        the request failed. Retry.
 *
 * Showing a checkout that cannot complete is still worse than showing none,
 * so neither state renders the buttons.
 */
export default function UpgradePanel({
  open,
  onClose,
  prices,
  pricesError,
  pricesUnavailable,
  onRetryPrices,
  billingBusy,
  onCheckout,
}) {
  if (open && !prices) {
    return (
      <SidePanel open title="Upgrade to Pro" onClose={onClose}>
        <div className="plan-state" role="status">
          {pricesUnavailable ? (
            <>
              <p className="plan-state-title">Checkout isn&rsquo;t available right now.</p>
              <p className="plan-state-body">
                Payments are not configured on this deployment. Nothing is wrong with your
                account, and you have not been charged.
              </p>
            </>
          ) : pricesError ? (
            <>
              <p className="plan-state-title">Couldn&rsquo;t load the plans.</p>
              <p className="plan-state-body">
                This request failed. Your plan and your billing are unaffected.
              </p>
              <button className="plan-state-retry" onClick={onRetryPrices}>
                Try again
              </button>
            </>
          ) : (
            <p className="plan-state-body">Loading plans&hellip;</p>
          )}
        </div>
      </SidePanel>
    );
  }

  return (
    <SidePanel open={open} title="Upgrade to Pro" onClose={onClose}>
      <div className="plan-grid">
        <div className="plan-col">
          <div className="plan-name">Free</div>
          <ul className="plan-feats">
            <li>4 models in the council</li>
            <li>Image generation</li>
            <li>Voice input</li>
            <li>Vision &amp; screen analysis</li>
          </ul>
        </div>

        <div className="plan-col is-pro">
          <div className="plan-name">
            Pro <span className="plan-badge">Recommended</span>
          </div>
          <ul className="plan-feats">
            <li>
              <strong>All 7 models</strong>, including DeepSeek, Nemotron and MiniMax
            </li>
            <li>Higher-quality vision model</li>
            <li>Everything in Free</li>
          </ul>
        </div>
      </div>

      <div className="plan-buttons">
        <button className="plan-buy" disabled={billingBusy} onClick={() => onCheckout("monthly")}>
          {billingBusy ? "Opening checkout..." : `Monthly — ${formatPrice(prices?.monthly)}`}
        </button>
        <button className="plan-buy is-secondary" disabled={billingBusy} onClick={() => onCheckout("yearly")}>
          {billingBusy ? "Opening checkout..." : `Yearly — ${formatPrice(prices?.yearly)}`}
        </button>
      </div>

      <div className="plan-note">Secure checkout by Stripe. Cancel any time.</div>
    </SidePanel>
  );
}
