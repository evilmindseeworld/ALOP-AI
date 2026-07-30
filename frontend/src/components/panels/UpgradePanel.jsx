import SidePanel from "../SidePanel";
import { formatPrice } from "../../lib/format";

/**
 * The upgrade path.
 *
 * Only rendered when `prices` is non-null. That is deliberate: the prices
 * endpoint 503s when a deployment has no Stripe price IDs configured, and
 * showing a checkout that cannot complete is worse than showing none.
 */
export default function UpgradePanel({ open, onClose, prices, billingBusy, onCheckout }) {
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
