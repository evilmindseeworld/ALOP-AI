import { SignOutButton } from "@clerk/react";
import SidePanel from "../SidePanel";

export default function SettingsPanel({
  open,
  onClose,
  darkMode,
  onToggleTheme,
  onExport,
  onDeleteChat,
  canDeleteChat,
  userPlan,
  hasPrices,
  billingBusy,
  onManageBilling,
  onUpgrade,
  facts,
  factsError,
  factsBusy,
  onRetryFacts,
  onDeleteFact,
  onForgetAll,
}) {
  return (
    <SidePanel open={open} title="Settings" onClose={onClose}>
      <div className="setting-row">
        <div className="setting-label">Appearance</div>
        <button
          type="button"
          className={`theme-toggle ${darkMode ? "active" : ""}`}
          onClick={onToggleTheme}
          aria-pressed={darkMode}
          aria-label={darkMode ? "Switch to Bamboo Day" : "Switch to Sakura Night"}
        >
          <span className="theme-toggle-label">{darkMode ? "Sakura Night" : "Bamboo Day"}</span>
          <div className="theme-toggle-switch" />
        </button>
      </div>

      <div className="setting-row">
        <button onClick={onExport} className="theme-card" style={{ width: "100%" }}>
          Export chat as Markdown
        </button>
      </div>

      <div className="setting-row">
        <button onClick={onDeleteChat} className="theme-card" disabled={!canDeleteChat}>
          Delete Chat
        </button>
      </div>

      {/* WHAT THE ASSISTANT REMEMBERS.
          These are statements about a person, written by a model, replayed into
          every later conversation. Showing them is not a nicety: a wrong fact
          conditions every answer that follows, and the person is the only one
          who can tell that it is wrong.

          An error never renders as an empty list — that reads as "nothing
          stored", which is the same lie the chat list and the attachments list
          each told once. State it, keep what we have, offer the retry. */}
      <div className="setting-row setting-block">
        <div className="setting-label">What I remember about you</div>

        {factsError && (
          <div className="setting-note" role="alert">
            Couldn&apos;t load your memory. It has not been changed.{" "}
            <button type="button" className="link-button" onClick={onRetryFacts}>
              Retry
            </button>
          </div>
        )}

        {/* Three rows the shape of a remembered fact, rather than the word
            "Loading". The list that replaces this is short and its rows are a
            fixed height, so the panel does not resize when it arrives — which
            is the whole reason to draw a placeholder instead of a message. */}
        {!factsError && factsBusy && facts === null && (
          <ul className="fact-list" role="status" aria-label="Loading what I remember">
            {[80, 64, 72].map((width, i) => (
              <li key={i} className="fact-row is-pending">
                <span className="skeleton-block fact-text-pending" style={{ width: `${width}%` }} />
              </li>
            ))}
          </ul>
        )}

        {!factsError && facts !== null && facts.length === 0 && (
          <div className="setting-note">
            Nothing yet. Tell me something about yourself and I&apos;ll keep it across chats.
          </div>
        )}

        {facts !== null && facts.length > 0 && (
          <>
            <ul className="fact-list">
              {facts.map((f) => (
                <li key={f.id} className="fact-row">
                  <span className="fact-text">{f.fact}</span>
                  <button
                    type="button"
                    className="fact-forget"
                    onClick={() => onDeleteFact(f.id)}
                    aria-label={`Forget: ${f.fact}`}
                  >
                    Forget
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="theme-card"
              style={{ width: "100%" }}
              onClick={() => {
                if (confirm("Forget everything I know about you? This cannot be undone.")) onForgetAll();
              }}
            >
              Forget everything
            </button>
          </>
        )}
      </div>

      {/* Pro users get the billing portal; everyone else gets the upgrade path,
          and only when this deployment actually has Stripe prices configured. */}
      {userPlan === "pro" && (
        <div className="setting-row">
          <button onClick={onManageBilling} disabled={billingBusy} className="theme-card" style={{ width: "100%" }}>
            {billingBusy ? "Opening..." : "Manage subscription"}
          </button>
        </div>
      )}

      {userPlan !== "pro" && hasPrices && (
        <div className="setting-row">
          <button onClick={onUpgrade} className="theme-card" style={{ width: "100%" }}>
            Upgrade to Pro
          </button>
        </div>
      )}

      <div className="setting-row">
        <SignOutButton>
          <button className="theme-card" style={{ width: "100%" }}>
            Sign Out
          </button>
        </SignOutButton>
      </div>
    </SidePanel>
  );
}
