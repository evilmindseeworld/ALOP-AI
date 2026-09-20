import SidePanel from "../SidePanel";
import { formatPrice } from "../../lib/format";
import { COUNCIL, FREE_COUNT } from "../../constants/council";

const COUNCIL_COMPANIES = [...new Set(COUNCIL.map(({ company }) => company))].join(", ");

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
 *
 * THE THIRD STATE, plain waiting, used to be handled the same way as those two
 * and should never have been. It replaced the entire panel with the words
 * "Loading plans" while the request was out — but the plan comparison is
 * STATIC. Which models each tier gets is compiled into this file. The only
 * thing the server contributes is two price strings, and the panel was hiding
 * everything it already knew in order to wait for them.
 *
 * So waiting now renders the real panel with the two figures placeholdered.
 * Nothing moves when they land, because the shape was right from the first
 * frame, and a user who opened this to find out what Pro includes gets that
 * answer immediately whatever Stripe is doing.
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
  // Only the two states where checkout genuinely cannot happen take over the
  // panel. Plain waiting falls through to the real one below.
  if (open && !prices && (pricesUnavailable || pricesError)) {
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
          ) : (
            <>
              <p className="plan-state-title">Couldn&rsquo;t load the plans.</p>
              <p className="plan-state-body">
                This request failed. Your plan and your billing are unaffected.
              </p>
              <button className="plan-state-retry" onClick={onRetryPrices}>
                Try again
              </button>
            </>
          )}
        </div>
      </SidePanel>
    );
  }

  const awaitingPrices = !prices;

  return (
    <SidePanel open={open} title="Upgrade to Pro" onClose={onClose}>
      <div className="plan-grid">
        <div className="plan-col">
          <div className="plan-name">Free</div>
          <ul className="plan-feats">
            <li>{FREE_COUNT} models in the council</li>
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
              <strong>All {COUNCIL.length} models</strong>, including {COUNCIL_COMPANIES}
            </li>
            <li>Higher-quality vision model</li>
            <li>Everything in Free</li>
          </ul>
        </div>
      </div>

      {/* Disabled while the price is unknown, not merely placeholdered: a
          checkout button that can be clicked before the app knows what it
          charges is the one control here that must not be optimistic. */}
      <div className="plan-buttons" aria-busy={awaitingPrices}>
        <button className="plan-buy" disabled={billingBusy || awaitingPrices} onClick={() => onCheckout("monthly")}>
          {billingBusy ? (
            "Opening checkout..."
          ) : awaitingPrices ? (
            <>
              Monthly <span className="price-pending" />
            </>
          ) : (
            `Monthly ${formatPrice(prices.monthly)}`
          )}
        </button>
        <button
          className="plan-buy is-secondary"
          disabled={billingBusy || awaitingPrices}
          onClick={() => onCheckout("yearly")}
        >
          {billingBusy ? (
            "Opening checkout..."
          ) : awaitingPrices ? (
            <>
              Yearly <span className="price-pending" />
            </>
          ) : (
            `Yearly ${formatPrice(prices.yearly)}`
          )}
        </button>
      </div>

      {/* Announced, because the visual placeholder says nothing to a screen
          reader and the buttons are disabled for a reason worth stating. */}
      <span className="sr-only" role="status" aria-live="polite">
        {awaitingPrices ? "Loading prices" : ""}
      </span>

      <div className="plan-note">Secure checkout by Stripe. Cancel any time.</div>
    </SidePanel>
  );
}
