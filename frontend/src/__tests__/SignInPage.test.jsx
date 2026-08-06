import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

vi.mock("../components/SakuraFrame", () => ({ default: () => <div data-testid="sakura" /> }));

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

  it("sign-up does NOT restate the agreement, because Clerk's checkbox does", () => {
    // Clerk renders a required "I agree to the Terms of Service and Privacy
    // Policy" checkbox inside the form, with its own links. Repeating it here
    // states the same obligation twice in two wordings a few pixels apart —
    // and the weaker one, a sentence nobody acts on, sitting under the stronger
    // one they do act on reads as the real terms being somewhere else.
    at("/sign-up");
    const { container } = render(<SignInPage />);
    const ownLegal = container.querySelector(".signin-legal");
    expect(ownLegal.textContent).not.toMatch(/agree to/i);
    expect(ownLegal.querySelectorAll("a")).toHaveLength(0);
    // But the age statement must survive — the checkbox does not carry it.
    expect(ownLegal.textContent).toMatch(/at least 13 years old/i);
  });
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

    it(`shows all seven council seats on ${label}`, () => {
      at(path);
      render(<SignInPage />);
      // The roster is the page's argument and it is asserted to survive the
      // branch, because the sign-up card is the one a new visitor sees first.
      expect(screen.getAllByRole("listitem")).toHaveLength(7);
      expect(screen.getByText("The Architect")).toBeInTheDocument();
      expect(screen.getByText("The Explorer")).toBeInTheDocument();
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
      // answer from a single model, and the whip resolves at three of seven.
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
