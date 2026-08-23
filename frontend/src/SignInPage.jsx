import { useEffect, useState } from "react";
import { SignIn, SignUp, useUser } from "@clerk/react";
import Earring from "./components/Earring";
import CouncilExemplar from "./components/CouncilExemplar";
import { Seal } from "./components/SakuraFrame";
import { COUNCIL, FREE_COUNT } from "./constants/council";
import { Storage } from "./lib/storage";

/**
 * SIGN-IN COULD NOT RENDER BAMBOO DAY AT ALL, and nobody had noticed because
 * every screenshot of this page was taken in one theme.
 *
 * `App.jsx` puts the theme class on `.app-root`, and tokens.css declares the
 * light palette at `.app-root.light` (line 483). But this page is an EARLY
 * RETURN above that element — `if (!hasUser) return <SignInPage />` — so
 * `.signin-root` had no `.app-root` ancestor and every token fell through to
 * the `:root` block, which is Sakura Night. Measured by Sol: with
 * `prefers-color-scheme: light` the page still resolved `--bg: #0a0a0a`.
 *
 * So the signed-out screen was hard-wired dark while the app it leads into
 * honoured a saved preference, and a returning light-theme user was flipped
 * twice per visit.
 *
 * READ FROM THE SAME KEY App.jsx WRITES, and default the same way it does
 * (`!== "false"`, i.e. dark unless the user has explicitly chosen light), so
 * the two cannot drift into disagreeing about what "no preference" means. It is
 * read once at mount rather than watched: there is no theme toggle on this
 * screen, so there is nothing to keep in sync.
 *
 * Not `prefers-color-scheme`. The app does not honour the OS setting anywhere
 * else — the preference is the stored choice — and having the signed-out screen
 * obey a different signal from the signed-in one is the same split this fixes.
 */
const themeClass = () => (Storage.get("alop-dark-mode") !== "false" ? "dark" : "light");

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
  /* Two waits, two timers, and they are different questions. `timedOut` at ten
   * seconds means "this has failed, say so and offer a reload". `slow` at 700ms
   * means "this is taking long enough that an empty box is misleading, so
   * caption it". A single threshold cannot do both: at 700ms you would be
   * declaring an outage that usually is not one, and at ten seconds the caption
   * arrives at the same moment as the error that replaces it. */
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (isLoaded) return;
    const t = setTimeout(() => setTimedOut(true), CLERK_LOAD_TIMEOUT_MS);
    /* 700ms, so a warm load never flashes a caption on its way past. Below
     * about half a second a message that appears and vanishes is a glitch
     * rather than information. */
    const s = setTimeout(() => setSlow(true), 700);
    return () => { clearTimeout(t); clearTimeout(s); };
  }, [isLoaded]);

  /* THE PAGE NO LONGER WAITS ON CLERK TO RENDER AT ALL.
   *
   * `if (!isLoaded) return null` was here, so the whole screen was blank until
   * a third-party bundle had downloaded, parsed and initialised. Everything on
   * it except the card is ours and needs no network — the wordmark, the
   * headline, the roster, the lattice, the crescents — and all of it was being
   * withheld for as long as that took, which on a cold cache on a phone is
   * seconds of nothing on the first screen of the product.
   *
   * Now only the CARD waits, in the slot below. It is the cheapest latency win
   * on this page and it removes no information: what appears immediately is
   * the same shell that stays, and the form lands in a slot that was already
   * its size, so nothing reflows when Clerk arrives.
   *
   * The OUTAGE screen is deliberately NOT treated this way. Once the ten
   * seconds are up the message is the only thing that matters, and decoration
   * around an error reads as an app that has not noticed it is broken — see
   * the note in signin.css. */
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

      {/* THE ORBS ARE GONE, and so is the branch that hung above them.
          Two blurred gradient circles drifting on a loop behind a form is the
          single most reproduced background on the web right now; it arrives
          with the framework and it is on ten thousand other pages. Nothing
          about it was this product. The grain above stays — it is the app's own
          asset from the app's own token, which is the opposite argument.

          What replaces them is what the signed-in app is already made of, so
          that signing in is a continuation rather than a doorway into a
          different design: the asanoha lattice as ground, and the pair of
          crescents hanging in the gutters. */}
      <div className="signin-lattice" aria-hidden="true" />

      {/* THE OWNER'S QUESTION, and it was fair: "the earrings swing, but when I
          log in nothing's swinging."

          They were mounted in `.chat-main`, which is behind the sign-in wall,
          so the one piece of motion in this app was invisible until after you
          had already committed to it. It now runs on the first screen.

          Not `active` here: the wide, quick swing means the council is working,
          and nothing is working yet. This is the resting 7s arc — see
          decoration.css, which owns both and explains why the pair is two
          phases of one moon rather than a mirrored copy. */}
      <Earring side="left" />
      <Earring side="right" />

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

        {/* THE THESIS IS TWO SECTIONS NOW, AND THE FORM SITS BETWEEN THEM.
            Sol measured the reason at four viewports. It was one
            `.signin-thesis` block beside the card, which is right at 1440 and
            wrong the moment the grid collapses: at 768 the card occupied
            y=106–613 and the headline started at y=637, and at 320 the card ran
            y=90–593 with the headline at y=617. **The first consequential
            choice — Google or email — arrived before the first sentence saying
            what the product is.** A stranger was asked how they would like to
            sign in to something they had not been told about.

            Worse, and invisible in a screenshot: the DOM order was still thesis
            then card, so a sighted user met the form first and a screen-reader
            user met the argument first. Two different products depending on how
            you read.

            Splitting it into an INTRO (title + the plain-language tagline) and a
            PROOF (the ladder + the seal) fixes both at once, because DOM order
            can now be the mobile order — intro, card, proof — while
            `grid-template-areas` in signin.css puts intro and proof back in one
            left column at desktop. Nothing is duplicated and nothing new is
            written; the tagline simply moves up to where it answers the question
            it was always answering.

            The proof staying AFTER the card on a phone is deliberate. The
            roster is the argument for WHY, and it is worth scrolling to; the
            headline and one sentence are what somebody needs before choosing to
            act. */}
        <div className="signin-grid">
          <section className="signin-intro">
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

            {/* MOVED UP FROM BELOW THE LADDER, where it was the last thing on
                the page. It is the only sentence here written for someone who
                knows nothing yet, so it belongs directly under the headline and
                above the first choice — not 406px past it. Same words. */}
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
            {/* THE PAGE'S SECOND HEADING, AND THE REASON CLERK'S IS HIDDEN.
                There were two `<h1>`s here — the thesis title and Clerk's own
                "Sign in to ALOP-AI" — and no `<h2>` between them, so the
                outline had two page titles and a hole. `header` is now
                `display: none` in lib/clerkAppearance.js and this takes its
                place.

                It also stops the brand being asserted three times above the
                fold: the lockup says ALOP-AI, Clerk said "Sign in to ALOP-AI",
                and the thesis title is the actual argument. Two words are
                enough over a form with one email field. */}
            <h2 className="signin-card-title">
              {signUp ? "Create your account" : "Sign in"}
            </h2>
            <div className="signin-card-inner">
              {/* The one part of this page that genuinely has to wait. The
                  placeholder holds the card's height so the form does not
                  push the plan line and the legal text down when it arrives —
                  a slot that resizes on load is the layout shift the early
                  render would otherwise have introduced.

                  `aria-hidden`, and no "Loading…" text: a screen reader user
                  is served by the form's own labels a moment later, and an
                  announcement for a placeholder that is about to be replaced
                  is noise. Nothing here is interactive yet. */}
              {isLoaded ? (
                signUp ? (
                  <SignUp signInUrl="/" fallbackRedirectUrl="/" />
                ) : (
                  <SignIn signUpUrl="/sign-up" fallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" />
                )
              ) : (
                /* A BLANK 342px BOX CANNOT SAY WHICH STATE IT IS IN, and there
                   are two. Sol caught the middle of this page rendering as a
                   large empty well between the card title and the plan note,
                   with no visible or announced difference between "the secure
                   form is on its way" and "the form failed" — right up until
                   second ten, when the down-state finally admits the second one.
                   A slow dependency presented as a broken composition.

                   The sentence is literally true and does not invent progress:
                   no spinner, no shimmer, no skeleton of a form that does not
                   exist, no rotating status verbs. `role="status"` announces it
                   once; the earlier `aria-hidden` was right for a blank box and
                   wrong for one that now says something.

                   AFTER A GRACE PERIOD, so a fast load never flashes it. The
                   reserved height holds from the first paint either way, which
                   is what keeps the plan line and the legal text from being
                   pushed down when the form lands. */
                <div className="signin-card-loading" {...(slow ? { role: "status" } : { "aria-hidden": "true" })}>
                  {slow ? "Preparing secure sign-in…" : null}
                </div>
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
            {/* BOTH FLOWS CARRY BOTH LINKS, and the branch that used to withhold
                them from sign-up was the worst bug on this page.

                It read: "AGE ONLY on sign-up, because Clerk now renders a
                required 'I agree to the Terms of Service and Privacy Policy'
                checkbox inside the form, with its own links to both documents."
                That was a claim about third-party markup, and Sol checked it
                against the live page rather than against the comment. It is
                false in this Clerk configuration.

                Measured on `/sign-up` after Clerk mounted, twice and
                independently: **zero** Terms or Privacy links anywhere in the
                card, **zero** checkboxes, and no occurrence of the words
                "terms" or "privacy" in its rendered text. The only links were
                "Sign in" and the Clerk logo.

                So the one flow where consent is actually taken — registration —
                was the only one with no route to either document, while
                sign-in, where the account already exists, had both. Exactly
                inverted, and a real compliance gap rather than an aesthetic
                one. Duplicated consent copy would have been the lesser fault by
                a wide margin.

                THE LESSON IS BIGGER THAN THE BUG. A test pinned the same
                assumption, so the suite agreed with the comment and neither
                looked at the page. Do not condition OUR obligations on what a
                third-party component is believed to render: its markup changes
                on their release schedule, silently, and the failure is invisible
                from inside this repo. If Clerk ever does render its own consent
                checkbox, the cost is one duplicated sentence; the cost of this
                branch was an account created with no visible terms.

                The age line differs by flow because it is a statement about
                what you are agreeing TO at the moment you agree. */}
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
            {/* The heading the outline needs and the page does not want to show.
                Without it the ladder is an unlabelled list between two landmarks;
                with a visible one there are three competing titles above the
                fold. `.sr-only` is the honest resolution — see signin.css. */}
            <h2 id="council-proof-title" className="sr-only">
              How the council is composed
            </h2>
            {/* THE TEMPERATURE COLUMN IS TEXTURE TO THE EYE AND NOISE TO A
                SCREEN READER. Visually it now reads one step behind the seat
                name, which was today's fix. But a screen reader still meets
                every row as "zero point two, The Architect, Zhipu AI" — an
                unexplained decimal, seven times, with nothing saying what the
                number is. One hidden sentence explains the scale once, and the
                visual texture is unchanged. */}
            <p id="council-scale" className="sr-only">
              Seven seats, ordered from the most literal to the most lateral.
              Each row begins with that seat&rsquo;s sampling temperature, from
              0.2 to 0.8.
            </p>

            {/* The roster is still the argument — seven seats, each held at its
                own temperature — but a seat is named for what it DOES, and
                credited to the company behind it rather than to a model id.
                The titles run the same axis as the numbers beside them: The
                Architect holds to what is literally there, The Explorer is
                furthest from it. The second line is the COMPANY and nothing
                more — constants/council.js records why there is no superlative
                on it, and why one must not be added back. */}
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

            {/* THE SEAL CLOSES THE LADDER, and it is the one mark on this page
                drawn at full opacity.

                A hanko is applied at the END of a document, as the stroke that
                commits to what is above it — which is exactly what this line
                is doing to the seven above it. The drawing is already the
                argument: two strokes converging into a single point. It is the
                council mechanic, not a flower.

                It is also the only element here that asserts rather than
                hedges. Everything else on this screen sits between 0.16 and
                0.34 alpha, which is the definition of a watermark; see the
                note on `Seal` in SakuraFrame.jsx for why the family needed one
                thing that does not. */}
            <p className="council-resolve">
              One reply, reconciled.
              <Seal className="sakura-seal signin-seal" id="signin-seal" />
            </p>
          </section>
        </div>
        <CouncilExemplar />
      </div>
    </div>
  );
}
