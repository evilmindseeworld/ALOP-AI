import { SignIn, useUser } from "@clerk/react";
import SakuraFrame from "./components/SakuraFrame";
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
      <SakuraFrame />

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

        {/* The same display treatment as the app's empty state — sans, then an
            italic serif for the turn. A user who signs in should recognise the
            screen they land on. */}
        <p className="signin-eyebrow">The AI Council</p>
        <h1 className="signin-title">
          One council.<span className="signin-title-accent">Every model.</span>
        </h1>
        <p className="signin-tagline">
          Several models answer separately, read each other, then agree on one reply.
          Tell it when it is wrong and it remembers.
        </p>

        {/* Was four emoji in bevelled cards. Emoji render differently on every
            platform, carry no meaning to a screen reader, and four of them
            stacked is the visual signature of a template. A plain list, set
            quietly, says the same thing and survives being read aloud. */}
        <ul className="signin-features">
          <li>Models debate before they answer</li>
          <li>Reads your screen, your images, your files</li>
          <li>Generates images from a prompt</li>
          <li>Learns from what you tell it</li>
        </ul>

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
