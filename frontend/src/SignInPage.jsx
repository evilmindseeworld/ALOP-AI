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
      <div className="signin-grid" />
      <div className="signin-orb signin-orb-1" />
      <div className="signin-orb signin-orb-2" />

      <div className="signin-content">
        <header className="signin-header">
          <div className="signin-logo-mark">A</div>
          <span className="signin-logo-text">ALOP-AI</span>
          <div className="signin-status">
            <span className="signin-status-dot" />
            OPERATIONAL
          </div>
        </header>

        <main className="signin-hero">
          <div className="signin-copy">
            <div className="signin-label">COGNITIVE INTERFACE v1.0</div>
            <h1 className="signin-title">
              One council.
              <br />
              Every frontier model.
            </h1>
            <p className="signin-description">
              Chat with multiple AI models working together. Generate images,
              analyze your screen, and build a knowledge base — all through a
              single interface.
            </p>

            <div className="signin-features">
              <div className="signin-features-title">CAPABILITY MATRIX</div>
              <div className="signin-feature-table">
                <div className="signin-feature-row signin-feature-header">
                  <span>Capability</span>
                  <span>Free</span>
                  <span>Pro</span>
                </div>
                {FEATURES.map((f, i) => (
                  <div className="signin-feature-row" key={i}>
                    <span>
                      <b>{f.icon}</b> {f.name}
                    </span>
                    <span>{typeof f.free === "boolean" ? (f.free ? "✓" : "—") : f.free}</span>
                    <span>{typeof f.pro === "boolean" ? (f.pro ? "✓" : "—") : f.pro}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="signin-card">
            <div className="signin-card-edge" />
            <div className="signin-card-header">
              <div className="signin-card-id">AUTHENTICATE</div>
              <div className="signin-card-lock">◈</div>
            </div>
            <div className="signin-card-body">
              <SignIn fallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" />
            </div>
            <div className="signin-card-footer">
              <span>🔒</span> Secure authentication via Clerk
              <span className="signin-card-sep">|</span>
              No card required
            </div>
          </div>
        </main>

        <footer className="signin-footer">
          <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>
          <span>•</span>
          <a href="/terms.html" target="_blank" rel="noreferrer">Terms of Service</a>
        </footer>
      </div>
    </div>
  );
}
