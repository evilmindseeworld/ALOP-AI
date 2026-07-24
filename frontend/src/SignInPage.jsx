import { SignIn, useUser } from "@clerk/react";
import "./SignInPage.css";

const FEATURES = [
  { icon: "🧠", name: "AI Council models", free: "4", pro: "8" },
  { icon: "🔍", name: "Real-time web search", free: false, pro: true },
  { icon: "🖼️", name: "Image Generation", free: false, pro: true },
  { icon: "👁️", name: "Vision & Files", free: false, pro: true },
  { icon: "🎙️", name: "Voice Input", free: false, pro: true },
  { icon: "☁️", name: "Cloud Sync", free: true, pro: true },
  { icon: "💬", name: "Unlimited Messages", free: false, pro: true },
];

export default function SignInPage() {
  const { isSignedIn, isLoaded } = useUser();
  if (!isLoaded) return null;
  if (isSignedIn) return null;

  return (
    <div className="signin-root">
      <div className="signin-noise" />
      <div className="signin-orb signin-orb-1" />
      <div className="signin-orb signin-orb-2" />

      <div className="signin-content">
        <div className="signin-top">
          <div className="signin-logo">
            <div className="signin-logo-mark">A</div>
            <span className="signin-logo-text">ALOP-AI</span>
          </div>
          <div className="signin-status">
            <span className="signin-status-dot" />
            <span>ONLINE</span>
          </div>
        </div>

        <div className="signin-hero">
          <div className="signin-left">
            <h1 className="signin-title">
              One council.<br />Every frontier model.
            </h1>
            <p className="signin-desc">
              Chat with multiple AI models working together. Generate images,
              analyze your screen, and build a knowledge base — all in one place.
            </p>

            <div className="signin-table">
              {FEATURES.map((f, i) => (
                <div className="signin-row" key={i}>
                  <div className="signin-row-name">
                    <span className="signin-row-icon">{f.icon}</span>
                    <span>{f.name}</span>
                  </div>
                  <span className="signin-row-val">
                    {typeof f.free === "boolean"
                      ? (f.free ? "✓" : "—")
                      : f.free}
                  </span>
                  <span className="signin-row-val pro">
                    {typeof f.pro === "boolean"
                      ? (f.pro ? "✓" : "—")
                      : f.pro}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="signin-right">
            <div className="signin-card">
              <div className="signin-card-body">
                <SignIn fallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" />
              </div>
              <div className="signin-trust">
                <span>🔒 Secure authentication</span>
                <span className="signin-dot">•</span>
                <span>No card required</span>
              </div>
              <div className="signin-links">
                <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy</a>
                <span className="signin-dot">•</span>
                <a href="/terms.html" target="_blank" rel="noreferrer">Terms</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
