import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { COUNCIL, MODEL_IDS } from "../constants/council";

/**
 * The first screen of the product had no test, and it was broken.
 *
 * `ClerkProvider` had `signUpUrl="/"`. `/` renders this page. This page
 * rendered `<SignIn>` unconditionally. So Clerk's own "Sign up" link went to
 * the sign-in form — verified against the live site, where clicking it
 * reloaded https://alop-ai.com/ and came back to "Sign in to ALOP-AI".
 *
 * Email registration was therefore unreachable. Only the Google button could
 * create an account, because OAuth signs up and signs in through one flow,
 * which is exactly why nobody noticed: the path the owner uses works.
 *
 * It becomes a launch blocker at the production cutover. A production Clerk
 * instance is a separate user store, so every existing account has to register
 * again — through a link that loops.
 *
 * These tests assert the ROUTING DECISION, not Clerk's internals. Clerk's
 * components are mocked down to a marker, because what broke was which one got
 * rendered, and a test that mounted the real widget would be testing Clerk.
 */

const clerkProps = { signIn: null, signUp: null };

vi.mock("@clerk/react", () => ({
  useUser: () => ({ isSignedIn: false, isLoaded: true }),
  SignIn: (props) => {
    clerkProps.signIn = props;
    return <div data-testid="clerk-sign-in">Sign in to ALOP-AI</div>;
  },
  SignUp: (props) => {
    clerkProps.signUp = props;
    return <div data-testid="clerk-sign-up">Create your account</div>;
  },
}));


const at = (pathname) => {
  window.history.replaceState({}, "", pathname);
};

let SignInPage;
beforeEach(async () => {
  clerkProps.signIn = null;
  clerkProps.signUp = null;
  ({ default: SignInPage } = await import("../SignInPage"));
});

afterEach(() => {
  at("/");
  vi.resetModules();
});

describe("which card the page renders", () => {
  it("shows sign-in at the root", () => {
    at("/");
    render(<SignInPage />);
    expect(screen.getByTestId("clerk-sign-in")).toBeInTheDocument();
    expect(screen.queryByTestId("clerk-sign-up")).not.toBeInTheDocument();
  });

  it("shows sign-up at /sign-up — the bug this file exists for", () => {
    at("/sign-up");
    render(<SignInPage />);
    expect(screen.getByTestId("clerk-sign-up")).toBeInTheDocument();
    expect(screen.queryByTestId("clerk-sign-in")).not.toBeInTheDocument();
  });

  it("tolerates a trailing slash, which is what a shared link usually has", () => {
    at("/sign-up/");
    render(<SignInPage />);
    expect(screen.getByTestId("clerk-sign-up")).toBeInTheDocument();
  });

  it("stays on sign-up through Clerk's own sub-paths", () => {
    // THE REGRESSION. Clerk's components are multi-step and route by path:
    // mounted at /sign-up they navigate to these as the flow proceeds. An exact
    // match returned false for every one, so <SignIn> mounted in the middle of
    // a sign-up and the user came back from Google to a dead page. It shipped
    // because this file only ever tested /sign-up itself.
    for (const p of [
      "/sign-up/sso-callback",
      "/sign-up/continue",
      "/sign-up/verify-email-address",
      "/sign-up/verify",
      "/sign-up/sso-callback/",
    ]) {
      at(p);
      const { unmount } = render(<SignInPage />);
      expect(screen.getByTestId("clerk-sign-up"), p).toBeInTheDocument();
      unmount();
    }
  });

  it("does not match a path that merely contains sign-up", () => {
    // A prefix or substring match would send /about-sign-up and /sign-uphill to
    // the registration form.
    for (const p of ["/about-sign-up", "/sign-upgrade", "/x/sign-up"]) {
      at(p);
      const { unmount } = render(<SignInPage />);
      expect(screen.getByTestId("clerk-sign-in"), p).toBeInTheDocument();
      unmount();
    }
  });
});

describe("the two cards link to each other", () => {
  it("sign-in offers a route to sign-up", () => {
    // The actual defect: this prop was absent, so Clerk fell back to the
    // provider's signUpUrl, which was "/" — this same page.
    at("/");
    render(<SignInPage />);
    expect(clerkProps.signIn.signUpUrl).toBe("/sign-up");
  });

  it("sign-up offers a route back to sign-in, so the loop is not merely moved", () => {
    at("/sign-up");
    render(<SignInPage />);
    expect(clerkProps.signUp.signInUrl).toBe("/");
  });

  it("both land on the app after they succeed", () => {
    at("/");
    render(<SignInPage />);
    expect(clerkProps.signIn.fallbackRedirectUrl).toBe("/");
    at("/sign-up");
    render(<SignInPage />);
    expect(clerkProps.signUp.fallbackRedirectUrl).toBe("/");
  });
});

describe("where the legal documents are reachable from", () => {
  it("sign-in links both documents, because it has no consent checkbox", () => {
    // Consent is taken once, at registration. On sign-in this sentence is the
    // only route to either document from the screen.
    at("/");
    render(<SignInPage />);
    expect(screen.getByRole("link", { name: /terms/i })).toHaveAttribute("href", "/terms.html");
    expect(screen.getByRole("link", { name: /privacy policy/i })).toHaveAttribute(
      "href",
      "/privacy.html",
    );
  });

  /* THIS TEST USED TO ASSERT THE BUG, and it is worth leaving the story in.
   *
   * It read "sign-up does NOT restate the agreement, because Clerk's checkbox
   * does", and asserted `.signin-legal` on `/sign-up` contained no "agree to"
   * and ZERO links. Both the test and the component comment were repeating a
   * belief about Clerk's markup that nobody had checked against the page.
   *
   * Checked, 2026-08-12: on `/sign-up` with Clerk mounted there are no Terms or
   * Privacy links in the card, no checkboxes, and no occurrence of "terms" or
   * "privacy" in its rendered text. So the flow where consent is actually taken
   * was the one flow with no route to either document — enforced by a passing
   * test.
   *
   * The rule now: our obligations do not depend on what a third-party component
   * is believed to render. If Clerk adds its own consent checkbox, the cost is a
   * duplicated sentence. The cost of the old contract was an account created
   * with no visible terms. */
  for (const [label, path] of [["sign-in", "/"], ["sign-up", "/sign-up"]]) {
    it(`${label} reaches Terms and Privacy from the page itself`, () => {
      at(path);
      const { container } = render(<SignInPage />);
      const ownLegal = container.querySelector(".signin-legal");
      expect(ownLegal.textContent).toMatch(/agree to/i);
      expect(ownLegal.querySelector('a[href="/terms.html"]')).toBeTruthy();
      expect(ownLegal.querySelector('a[href="/privacy.html"]')).toBeTruthy();
      // The age statement rides in the same sentence and must survive with it.
      expect(ownLegal.textContent).toMatch(/at least 13 years old/i);
    });
  }
});

describe("what has to be on the page whichever card is showing", () => {
  // The age confirmation is MORE load-bearing on the sign-up side: the whole
  // argument for stating it here rather than only inside the linked Terms is
  // that registration is the moment it has to be seen.
  for (const [label, path] of [["sign-in", "/"], ["sign-up", "/sign-up"]]) {
    it(`states the minimum age on ${label}`, () => {
      // The age line is on BOTH cards and is the reason this paragraph exists.
      // Clerk's consent checkbox does not carry it.
      at(path);
      render(<SignInPage />);
      expect(screen.getByText(/at least 13 years old/i)).toBeInTheDocument();
      expect(screen.getByText(/16 in the EEA and/i)).toBeInTheDocument();
    });

    it(`shows all five council seats on ${label}`, () => {
      at(path);
      const { container } = render(<SignInPage />);
      // The roster is the page's argument and it is asserted to survive the
      // branch, because the sign-up card is the one a new visitor sees first.
      expect(container.querySelectorAll(".council-ladder > .council-row")).toHaveLength(5);
      expect(screen.getByText("2 models free. All 5 on Pro.")).toBeInTheDocument();
      expect(screen.getByText("The Architect")).toBeInTheDocument();
      expect(screen.getByText("The Alchemist")).toBeInTheDocument();
    });

    it(`leaks no vendor model id into the DOM on ${label}`, () => {
      // The whole point of the display layer. `model` stays in the constant so
      // the backend parity test has something to compare against, which means
      // it is one careless {m.model} away from being rendered again.
      at(path);
      const { container } = render(<SignInPage />);
      const text = container.textContent;
      for (const id of MODEL_IDS) {
        expect(text, `"${id}" is on the page`).not.toContain(id);
      }
    });

    it(`credits a company for every seat on ${label}`, () => {
      at(path);
      const { container } = render(<SignInPage />);
      for (const m of COUNCIL) {
        expect(container.textContent, `no attribution for ${m.title}`).toContain(m.company);
      }
    });

    it(`makes no superlative claim about any seat on ${label}`, () => {
      // The attribution is the company and nothing else. An earlier draft read
      // "Powered by [company]'s most powerful model", which was false on two
      // seats, unverifiable on the other five, and did not describe how the
      // service routes — greetings never reach the council, search and fallback
      // answer from a single model, and the whip resolves at three of five.
      //
      // Under FTC standards that is a comparative performance claim needing
      // substantiation, on a page that exists to induce a AED 30/month purchase.
      // This test is here because the line is tempting and the objection is not
      // obvious from reading the page.
      at(path);
      const { container } = render(<SignInPage />);
      const ladder = container.querySelector(".council-ladder").textContent;
      for (const claim of [
        /most powerful/i,
        /best\b/i,
        /strongest/i,
        /smartest/i,
        /flagship/i,
        /world'?s leading/i,
        /#\s*1\b/,
      ]) {
        expect(ladder, `the roster is making a superlative claim: ${claim}`).not.toMatch(claim);
      }
    });
  }
});

/* THE ORDER A STRANGER MEETS THE PAGE IN, which had no test and was wrong.
 *
 * The mobile layout used `order: 2` on the thesis and `order: 1` on the card.
 * That moves boxes and leaves the DOM alone, so it bought a better VISUAL
 * sequence by giving screen-reader users the reverse one — and because the
 * headline lived in the same element as the roster, it pushed the product's
 * first sentence below the form. Measured at 320: card y=90–593, headline
 * y=617. The first consequential choice arrived before the first word about
 * what the product is.
 *
 * A screenshot cannot catch that and neither can a CSS snapshot; the failure is
 * a DISAGREEMENT between two orders, and only one of them is visible. So the
 * contract is asserted on the DOM, which is now the phone order, with
 * `grid-template-areas` doing the desktop rearrangement instead.
 */
describe("the order a first-time visitor meets the page in", () => {
  const order = (container) =>
    [...container.querySelectorAll(".signin-intro, .signin-card, .signin-proof")].map(
      (el) => el.className.match(/signin-(intro|card|proof)/)[1],
    );

  for (const [label, path] of [["sign-in", "/"], ["sign-up", "/sign-up"]]) {
    it(`is intro, then card, then proof on ${label}`, () => {
      at(path);
      const { container } = render(<SignInPage />);
      expect(order(container)).toEqual(["intro", "card", "proof"]);
    });
  }

  it("puts the plain-language sentence with the headline, not after the roster", () => {
    at("/");
    const { container } = render(<SignInPage />);
    const intro = container.querySelector(".signin-intro");
    expect(intro.querySelector("h1")).toBeTruthy();
    expect(intro.querySelector(".signin-tagline")).toBeTruthy();
    // The sentence written for someone who knows nothing must not be inside the
    // block that comes after the form.
    expect(container.querySelector(".signin-proof .signin-tagline")).toBeNull();
  });

  it("never reorders with CSS `order`, which is what split the two readings", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "styles", "signin.css"),
      "utf8",
    );
    /* `order:` anywhere in this file is the exact mechanism that made the
     * visual and DOM sequences disagree. If a future layout needs it, that is a
     * decision to argue for, not to slip in.
     *
     * THE FIRST VERSION OF THIS PATTERN WAS `/^\s*order:\s*\d/m` AND IT DID NOT
     * WORK. Reintroducing the bug as `.signin-card { order: 1; }` — inline
     * after the brace, which is how the deleted rule was actually written —
     * sailed straight past it, because the pattern demanded the declaration
     * start a line. The guard was tested by injecting the failure and watching
     * it NOT fail, which is the only reason it was caught; a guard verified
     * only against the formatting its author happened to imagine is not
     * verified.
     *
     * The lookbehind is what keeps `border: 1px` out — the last six characters
     * of that property are the whole pattern.
     *
     * COMMENTS ARE STRIPPED FIRST, and that is not a convenience. With them in,
     * the guard failed on the note in signin.css that QUOTES the deleted rule
     * to explain why it must not come back — so documenting the bug would have
     * been what tripped the alarm about it, and the obvious way out is to stop
     * documenting it. A guard that punishes its own explanation gets deleted
     * along with the explanation. Test the declarations, not the prose. */
    const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(
      /(?<![-\w])order:\s*-?\d/.test(declarations),
      "signin.css is reordering with `order:` again — the DOM order is the contract",
    ).toBe(false);
  });

  it("gives the roster a heading and explains the temperature column once", () => {
    at("/");
    const { container } = render(<SignInPage />);
    const proof = container.querySelector(".signin-proof");
    // Hidden, not absent: the outline needs the heading, the page does not want
    // a third visible title above the fold.
    const heading = container.querySelector("#council-proof-title");
    expect(heading).toBeTruthy();
    expect(heading.className).toContain("sr-only");
    expect(proof.getAttribute("aria-labelledby")).toBe("council-proof-title");
    // Every row starts with an unexplained decimal to a screen reader.
    const ladder = container.querySelector(".council-ladder");
    expect(ladder.getAttribute("aria-describedby")).toBe("council-scale");
    expect(container.querySelector("#council-scale").textContent).toMatch(/temperature/i);
  });
});

/* THE SIGNED-OUT SCREEN COULD NOT RENDER BAMBOO DAY.
 *
 * tokens.css declares the light palette at `.app-root.light`, and this page is
 * an early return ABOVE the element App.jsx puts that class on — so every token
 * fell through to `:root`, which is Sakura Night, whatever the user had chosen.
 * Sol measured `--bg: #0a0a0a` resolving under `prefers-color-scheme: light`.
 */
describe("the landing exemplar explains consequence without faking a live turn", () => {
  for (const path of ["/", "/sign-up"]) {
    it(`shows the reviewed council shape on ${path}`, () => {
      at(path);
      const { container } = render(<SignInPage />);
      const exemplar = container.querySelector(".council-exemplar");
      const heading = exemplar.querySelector(".council-exemplar-title");

      expect(exemplar).toBeTruthy();
      expect(exemplar.getAttribute("aria-live")).toBeNull();
      expect(exemplar.getAttribute("aria-labelledby")).toBe(heading.id);
      expect(exemplar.textContent).toMatch(/reviewed example.*not a live turn/i);
      expect(exemplar.textContent).toMatch(/Should a small team choose Postgres or MongoDB/i);
      expect(exemplar.textContent).toMatch(/Choose Postgres when relationships/i);
      expect(exemplar.querySelectorAll(".council-exemplar-step")).toHaveLength(2);
      expect(exemplar.textContent).toMatch(/after sign-in/i);
    });
  }
});

describe("the signed-out screen honours the saved theme", () => {
  afterEach(() => localStorage.clear());

  it("wraps itself in app-root so the light palette can apply at all", () => {
    localStorage.setItem("alop-dark-mode", "false");
    at("/");
    const { container } = render(<SignInPage />);
    const root = container.querySelector(".signin-root");
    expect(root.classList.contains("app-root")).toBe(true);
    expect(root.classList.contains("light")).toBe(true);
  });

  it("defaults to dark with no stored preference, the same way App.jsx does", () => {
    at("/");
    const { container } = render(<SignInPage />);
    expect(container.querySelector(".signin-root").classList.contains("dark")).toBe(true);
  });

  it("reads the same storage key App.jsx writes, so the two cannot drift", () => {
    localStorage.setItem("alop-dark-mode", "true");
    at("/");
    const { container } = render(<SignInPage />);
    expect(container.querySelector(".signin-root").classList.contains("dark")).toBe(true);
  });
});
