import { useEffect, useState } from "react";
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
const wantsSignUp = () => {
  if (typeof window === "undefined") return false;
  const p = window.location.pathname.replace(/\/+$/, "");
  // `/sign-up` AND its sub-paths.
  //
  // THE SUB-PATHS ARE THE WHOLE POINT, and leaving them out broke Google
  // sign-in the day it was switched on. Clerk's components are multi-step and
  // route by PATH: mounted at /sign-up they navigate to /sign-up/sso-callback,
  // /sign-up/continue, /sign-up/verify-email-address as the flow proceeds. An
  // exact match returned false for every one of those, so <SignIn> mounted in
  // the middle of a sign-up — the wrong component, with no idea what to do
  // with the OAuth result. The user came back from Google to a dead page.
  //
  // Verified against the live site: /sign-up/sso-callback rendered
  // .cl-signIn-root and the heading "Sign in to ALOP-AI".
  //
  // Still NOT a bare prefix test: `startsWith("/sign-up")` also swallows
  // /sign-upgrade. The boundary is the slash.
  return p === "/sign-up" || p.startsWith("/sign-up/");
};

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
/**
 * How long Clerk gets before we admit something is wrong.
 *
 * `isLoaded` stays false forever when the Frontend API cannot be reached, and
 * this page returned `null` on that — so an outage rendered a BLANK WHITE
 * PAGE with no message, no retry and nothing in the UI to react to. That is
 * exactly what happened when a rewrite swallowed /__clerk and every sign-in
 * POST came back 405: the console had the error and the user had nothing.
 *
 * Ten seconds is long enough that a slow phone on a cold cache is not accused
 * of being broken, and short enough that nobody sits in front of an empty
 * screen wondering whether to reload.
 */
const CLERK_LOAD_TIMEOUT_MS = 10_000;

export default function SignInPage() {
  const { isSignedIn, isLoaded } = useUser();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (isLoaded) return;
    const t = setTimeout(() => setTimedOut(true), CLERK_LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [isLoaded]);

  if (!isLoaded) {
    if (!timedOut) return null;
    return (
      <div className="signin-root">
        <div className="signin-down" role="alert">
          <h1 className="signin-down-title">Sign-in isn&rsquo;t responding.</h1>
          <p className="signin-down-body">
            We can&rsquo;t reach the service that signs you in. Your account and your chats are
            not affected &mdash; there is nothing to recover and nothing has been lost.
          </p>
          <p className="signin-down-body">
            This is usually brief. If reloading doesn&rsquo;t help, it is on our side, not yours.
          </p>
          <button className="signin-down-retry" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }

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
          {/* favicon.png, NOT logo-mark.png, and the reason is measurement.
              This renders at 34x34. logo-mark.png is 512x512 and 28 KB — a
              15x oversized image on the only page a signed-out visitor loads.
              favicon.png is the identical mark from the same generator at
              144px and 5.5 KB, which still covers 34px at 3x device pixels.

              It is also the URL the browser is ALREADY fetching for the tab
              icon, so on this page it costs nothing at all. */}
          <img src="/favicon.png" alt="" className="signin-logo-mark" />
          <span className="signin-logo-text">ALOP-AI</span>
        </div>

        <div className="signin-grid">
          <section className="signin-thesis">
            {/* No eyebrow above this title. "The Council" sat here in tracked
                uppercase and told a reader nothing the headline, the roster
                and the tagline below it do not already say — a label whose
                only function is to occupy the space above a heading. Same
                kicker came off the empty state and the social card. */}
            {/* "Seven answers. One reply." was replaced, and index.html already
                explains why in the note above <title>: a count followed by a
                contrast ("Seven X. One Y.") is a rhythm that reads as generated
                rather than written, and the number dates the product — the
                roster is three seats on free and seven on pro, so it was wrong
                for most of the people reading it. That reasoning was applied to
                the <title> and never to the heading the visitor actually sees.

                This says what happens instead, in the order it happens, and
                does not count anything. The italic-serif accent span is gone
                with it: two typefaces on one line was the decoration, not the
                argument. */}
            <h1 className="signin-title">
              Ask once. Several models answer.
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
              They disagree on purpose. You get what they agreed on, and where they didn&rsquo;t.
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
            {signUp ? (
              /* AGE ONLY on sign-up, because Clerk now renders a required
                 "I agree to the Terms of Service and Privacy Policy" checkbox
                 inside the form, with its own links to both documents.
                 Repeating the agreement here would state the same obligation
                 twice in two different wordings a few pixels apart, and the
                 weaker of the two — a sentence nobody acts on — sitting under
                 the stronger one that they do act on reads as the real terms
                 being somewhere else. The age line stays: the checkbox does not
                 carry it, and it is the reason this paragraph existed. */
              <p className="signin-legal">
                You must be at least 13 years old to use ALOP-AI &mdash; 16 in the EEA and the UK.
              </p>
            ) : (
              /* Sign-in has no consent checkbox: consent is taken once, at
                 registration. So this stays the full sentence AND the only
                 route to either document from this screen. */
              <p className="signin-legal">
                By continuing you confirm you are at least 13 years old (16 in the EEA and UK) and
                agree to our{" "}
                <a href="/terms.html" target="_blank" rel="noreferrer">Terms</a> and{" "}
                <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
