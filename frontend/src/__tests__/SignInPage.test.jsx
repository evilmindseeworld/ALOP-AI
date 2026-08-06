import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

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

describe("what has to be on the page whichever card is showing", () => {
  // The age confirmation is MORE load-bearing on the sign-up side: the whole
  // argument for stating it here rather than only inside the linked Terms is
  // that registration is the moment it has to be seen.
  for (const [label, path] of [["sign-in", "/"], ["sign-up", "/sign-up"]]) {
    it(`states the minimum age and links both documents on ${label}`, () => {
      at(path);
      render(<SignInPage />);
      expect(screen.getByText(/at least 13 years old/i)).toBeInTheDocument();
      expect(screen.getByText(/16 in the EEA and UK/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /terms/i })).toHaveAttribute("href", "/terms.html");
      expect(screen.getByRole("link", { name: /privacy policy/i })).toHaveAttribute(
        "href",
        "/privacy.html",
      );
    });

    it(`shows the council roster on ${label}`, () => {
      at(path);
      render(<SignInPage />);
      // The roster is the page's argument and it is asserted to survive the
      // branch, because the sign-up card is the one a new visitor sees first.
      expect(screen.getByText("glm-5.2")).toBeInTheDocument();
      expect(screen.getByText("minimax-m3")).toBeInTheDocument();
      expect(screen.getAllByRole("listitem")).toHaveLength(7);
    });
  }
});
