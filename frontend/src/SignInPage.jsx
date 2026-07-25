import { SignIn, useUser } from "@clerk/react";
import "./SignInPage.css";

export default function SignInPage() {
  const { isSignedIn, isLoaded } = useUser();
  if (!isLoaded) return null;
  if (isSignedIn) return null;

  return (
    <div className="signin-root">
      <div className="signin-noise" />
      <div className="signin-orb signin-orb-1" />
      <div className="signin-orb signin-orb-2" />

      <div className="signin-wrap">
        <div className="signin-brand">
          <div className="signin-logo-mark">
            <img src="/logo.png" alt="ALOP-AI" />
          </div>
          <span className="signin-logo-text">ALOP-AI</span>
          <div className="signin-status">
            <span className="signin-status-dot" />
            <span>ONLINE</span>
          </div>
        </div>

        <h1 className="signin-title">One council. Every frontier model.</h1>
        <p className="signin-tagline">
          Chat with multiple AI models working together. Generate images,
          analyze your screen, and build a knowledge base.
        </p>

        <div className="signin-card">
          <div className="signin-card-inner">
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
  );
}
