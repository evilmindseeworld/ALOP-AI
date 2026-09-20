import { useEffect, useState } from "react";
import { SignIn, SignUp, useUser } from "@clerk/react";
import Earring from "./components/Earring";
import { Seal } from "./components/SakuraFrame";
import { COUNCIL, FREE_COUNT } from "./constants/council";
import { Storage } from "./lib/storage";

const themeClass = () => (Storage.get("alop-dark-mode") !== "false" ? "dark" : "light");

const wantsSignUp = () => {
  if (typeof window === "undefined") return false;
  const p = window.location.pathname.replace(/\/+$/, "");
  // Keep Clerk's nested sign-up routes and exclude paths like /sign-upgrade.
  return p === "/sign-up" || p.startsWith("/sign-up/");
};

const CLERK_LOAD_TIMEOUT_MS = 10_000;

/** Signed-out sign-in and sign-up entry screen. */
export default function SignInPage() {
  const { isSignedIn, isLoaded } = useUser();
  const [timedOut, setTimedOut] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (isLoaded) return;
    const t = setTimeout(() => setTimedOut(true), CLERK_LOAD_TIMEOUT_MS);
    const s = setTimeout(() => setSlow(true), 700);
    return () => { clearTimeout(t); clearTimeout(s); };
  }, [isLoaded]);

  if (!isLoaded && timedOut) {
    return (
      <div className={`app-root ${themeClass()} signin-root`}>
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
    <div className={`app-root ${themeClass()} signin-root`}>
      <div className="signin-noise" />

      <div className="signin-lattice" aria-hidden="true" />

      <Earring side="left" />
      <Earring side="right" />

      <div className="signin-wrap">
        <div className="signin-brand">
          <img src="/favicon.png" alt="" className="signin-logo-mark" />
          <span className="signin-logo-text">ALOP-AI</span>
        </div>

        <div className="signin-grid">
          <section className="signin-intro">
<h1 className="signin-title">
              Ask once. Several models answer.
            </h1>

            <p className="signin-tagline">
              They disagree on purpose. You get what they agreed on, and where they didn&rsquo;t.
            </p>
          </section>

          <section className="signin-card">
            <h2 className="signin-card-title">
              {signUp ? "Create your account" : "Sign in"}
            </h2>
            <div className="signin-card-inner">
              {isLoaded ? (
                signUp ? (
                  <SignUp signInUrl="/" fallbackRedirectUrl="/" />
                ) : (
                  <SignIn signUpUrl="/sign-up" fallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" />
                )
              ) : (
                <div className="signin-card-loading" {...(slow ? { role: "status" } : { "aria-hidden": "true" })}>
                  {slow ? "Preparing secure sign-in…" : null}
                </div>
              )}
            </div>
            <p className="signin-plan">
              {FREE_COUNT} models free. All {COUNCIL.length} on Pro.
            </p>

            <p className="signin-legal">
              {signUp ? (
                <>
                  By creating an account you confirm you are at least 13 years old
                  (16 in the EEA and UK) and agree to our{" "}
                </>
              ) : (
                <>
                  By continuing you confirm you are at least 13 years old
                  (16 in the EEA and UK) and agree to our{" "}
                </>
              )}
              <a href="/terms.html" target="_blank" rel="noreferrer">Terms</a> and{" "}
              <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>.
            </p>
          </section>

          <section className="signin-proof" aria-labelledby="council-proof-title">
            <h2 id="council-proof-title" className="sr-only">
              How the council is composed
            </h2>
<p id="council-scale" className="sr-only">
              Five seats, ordered from the most literal to the most lateral.
              Each row begins with that seat&rsquo;s sampling temperature, from
              0.2 to 0.7.
            </p>

<ol className="council-ladder" aria-describedby="council-scale">
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

<p className="council-resolve">
              One reply, reconciled.
              <Seal className="sakura-seal signin-seal" id="signin-seal" />
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
