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
