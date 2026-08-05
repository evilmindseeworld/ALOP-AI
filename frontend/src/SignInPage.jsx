import { SignIn, useUser } from "@clerk/react";
import SakuraFrame from "./components/SakuraFrame";
import { COUNCIL, FREE_COUNT } from "./constants/council";
import "./SignInPage.css";

/**
 * The sign-in screen.
 *
 * THE THESIS: the most characteristic thing about this product is that seven
 * models answer separately and then have to agree. The old page described that
 * in a sentence and then showed four emoji in cards — which is the shape of
 * every AI landing page, and says nothing a competitor could not copy.
 *
 * So the hero IS the council: the real roster, ordered by temperature, low to
 * high. That ordering is not decoration and it is not "01 / 02 / 03" wearing a
 * disguise — the spread from 0.2 to 0.8 is the actual reason a council works.
 * A panel of seven identical models would return one answer seven times. The
 * ladder shows why it does not, using the product's own numbers, and it could
 * not be lifted onto any other product.
 *
 * The convergence rule beneath it is the single signature element: seven dim
 * voices, one bright line. Everything else on the page is deliberately quiet.
 *
 * Cut on the way: the "ONLINE" status pill (invented telemetry — nothing was
 * measuring anything), the "Secure authentication / No card required" trust
 * line (emoji, plus reassurance about a fear nobody arrived with), and the four
 * feature cards.
 */
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
          <img src="/logo.png" alt="" className="signin-logo-mark" />
          <span className="signin-logo-text">ALOP-AI</span>
        </div>

        <div className="signin-grid">
          <section className="signin-thesis">
            <p className="signin-eyebrow">The council</p>
            <h1 className="signin-title">
              Seven answers.<span className="signin-title-accent">One reply.</span>
            </h1>

            {/* The roster is the argument. Each row is a real model and its real
                temperature; the column of numbers is what makes the claim
                checkable rather than atmospheric. */}
            <ol className="council-ladder">
              {COUNCIL.map((m) => (
                <li key={m.model} className={`council-row ${m.free ? "" : "is-pro"}`}>
                  <span className="council-temp">{m.temperature.toFixed(1)}</span>
                  <span className="council-name">{m.model}</span>
                  {!m.free && <span className="council-tag">Pro</span>}
                </li>
              ))}
            </ol>

            <p className="council-resolve">One reply, reconciled.</p>

            {/* The previous line explained the temperature column — "runs 0.2 to
                0.8, literal to lateral". It was true and it was the wrong
                sentence: to anyone who does not already know what a sampling
                temperature is, "temperature" is the weather. The numbers can
                stay as texture for people who recognise them; the caption has
                to work for everyone, so it says what the product does instead
                of what the column means. */}
            <p className="signin-tagline">
              They disagree on purpose. You get what they agreed on — and where they didn&rsquo;t.
            </p>
          </section>

          <section className="signin-card">
            <div className="signin-card-inner">
              <SignIn fallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" />
            </div>
            <p className="signin-plan">
              {FREE_COUNT} models free. All {COUNCIL.length} on Pro.
            </p>
            <div className="signin-links">
              <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy</a>
              <span className="signin-dot">·</span>
              <a href="/terms.html" target="_blank" rel="noreferrer">Terms</a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
