import { SignIn, SignUp, useUser } from "@clerk/react";
import SakuraFrame from "./components/SakuraFrame";
import SakuraBough from "./components/SakuraBough";
import { COUNCIL, FREE_COUNT } from "./constants/council";

/**
 * Whether the visitor asked to register.
 *
 * THERE WAS NO WAY TO SIGN UP. `ClerkProvider` had `signUpUrl="/"`, and `/`
 * renders this page, which rendered `<SignIn>` unconditionally — so Clerk's
 * own "Sign up" link went to the sign-in form. Verified against the live site:
 * clicking it reloaded `https://alop-ai.com/` and came back to "Sign in to
 * ALOP-AI". Email registration was unreachable; only the Google button could
 * create an account, because OAuth signs up and signs in through one flow.
 *
 * That was survivable while the three development-instance accounts existed.
 * It is not survivable through the production cutover, because a production
 * Clerk instance is a separate user store and EVERY user has to register again.
 *
 * Read from the path rather than from state so the URL is shareable and a
 * refresh keeps you where you were. `vercel.json` is what makes that safe —
 * without a rewrite to index.html, `/sign-up` is a 404 on Vercel, which is
 * exactly what the live site returned before this commit.
 */
const wantsSignUp = () =>
  typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === "/sign-up";

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
  const signUp = wantsSignUp();

  return (
    <div className="signin-root">
      <div className="signin-noise" />
      <div className="signin-orb signin-orb-1" />
      <div className="signin-orb signin-orb-2" />
      <SakuraFrame />
      <SakuraBough />

      <div className="signin-wrap">
        <div className="signin-brand">
          <img src="/logo.png" alt="" className="signin-logo-mark" />
          <span className="signin-logo-text">ALOP-AI</span>
        </div>

        <div className="signin-grid">
          <section className="signin-thesis">
            <p className="signin-eyebrow">The Council</p>
            <h1 className="signin-title">
              Seven answers.<span className="signin-title-accent">One reply.</span>
            </h1>

            {/* The roster is still the argument — seven seats, each held at its
                own temperature — but a seat is named for what it DOES, and
                credited to the company behind it rather than to a model id.
                The titles run the same axis as the numbers beside them: The
                Architect holds to what is literally there, The Explorer is
                furthest from it. The second line is the COMPANY and nothing
                more — constants/council.js records why there is no superlative
                on it, and why one must not be added back. */}
            <ol className="council-ladder">
              {COUNCIL.map((m) => (
                <li key={m.model} className={`council-row ${m.free ? "" : "is-pro"}`}>
                  <span className="council-temp">{m.temperature.toFixed(1)}</span>
                  <span className="council-seat">
                    <span className="council-name">{m.title}</span>
                    <span className="council-blurb">{m.company}</span>
                  </span>
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
            {/* One shell, two cards. The hero, the plan line and the age
                confirmation below are identical either way and are all MORE
                load-bearing on the sign-up side — the whole argument for
                stating the minimum age here rather than only inside the linked
                Terms is that registration is the moment it has to be seen. */}
            <div className="signin-card-inner">
              {signUp ? (
                <SignUp signInUrl="/" fallbackRedirectUrl="/" />
              ) : (
                <SignIn signUpUrl="/sign-up" fallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" />
              )}
            </div>
            <p className="signin-plan">
              {FREE_COUNT} models free. All {COUNCIL.length} on Pro.
            </p>
            {/* The Terms set a minimum age of 13, and 16 in the EEA and UK.
                A minimum age that appears only inside a linked document is a
                promise the product does not make — the point of stating it at
                the moment of sign-up is that the claim becomes something the
                user actually saw, which is what turns it from paper into a
                defensible position. COPPA attaches to collecting a child's
                email, not to what the app is for, and Clerk collects one. */}
            <p className="signin-legal">
              By continuing you confirm you are at least 13 years old (16 in the EEA and UK) and
              agree to our{" "}
              <a href="/terms.html" target="_blank" rel="noreferrer">Terms</a> and{" "}
              <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
