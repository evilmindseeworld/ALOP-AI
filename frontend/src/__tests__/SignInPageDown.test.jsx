import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

/**
 * What a user sees when Clerk cannot be reached.
 *
 * Its own file because SignInPage.test.jsx mocks `isLoaded: true` at module
 * scope, and the whole subject here is the case where it never becomes true.
 *
 * THE BUG THIS EXISTS FOR was live: a rewrite swallowed /__clerk, every
 * sign-in POST came back 405, `isLoaded` stayed false forever, and the page
 * returned `null` on that — so the user got a BLANK WHITE PAGE. The only
 * evidence anything had happened was in the browser console.
 */
vi.mock("@clerk/react", () => ({
  useUser: () => ({ isSignedIn: false, isLoaded: false }),
  SignIn: () => <div data-testid="clerk-sign-in" />,
  SignUp: () => <div data-testid="clerk-sign-up" />,
}));


let SignInPage;
beforeEach(async () => {
  vi.useFakeTimers();
  ({ default: SignInPage } = await import("../SignInPage"));
});
afterEach(() => vi.useRealTimers());

describe("SignInPage when Clerk never loads", () => {
  /* This asserted `toBeEmptyDOMElement()` — the page rendered NOTHING until
   * Clerk had loaded, and the test was pinning that in place.
   *
   * The behaviour changed deliberately: everything on this screen except the
   * form is ours and needs no network, so withholding the wordmark, the
   * headline and the roster until a third-party bundle initialises was seconds
   * of blank first screen for nothing. The contract the test defends is the
   * one that actually matters, and it is unchanged: a slow load is NOT an
   * outage, so no alert appears and the form is not faked. */
  it("renders the page but not the form, because a slow load is not an outage", () => {
    render(<SignInPage />);

    // Ours, and up immediately.
    expect(screen.getByText("Ask once. Several models answer.")).toBeInTheDocument();
    expect(screen.getByText("One reply, reconciled.")).toBeInTheDocument();

    // Clerk's, and correctly absent.
    expect(screen.queryByTestId("clerk-sign-in")).not.toBeInTheDocument();
    expect(screen.queryByTestId("clerk-sign-up")).not.toBeInTheDocument();

    // A wait is not a failure: the outage screen must not appear yet.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stops rendering nothing once the wait is unreasonable", () => {
    render(<SignInPage />);
    act(() => vi.advanceTimersByTime(10_000));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Sign-in isn’t responding.")).toBeInTheDocument();
    // The reassurance is the point: a failed sign-in is the moment a user
    // starts wondering whether their account still exists.
    expect(screen.getByText(/nothing has been lost/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("does not leave a timer running after unmount", () => {
    const { unmount } = render(<SignInPage />);
    unmount();
    // Would throw a React act/state-update-after-unmount warning if the
    // timeout were not cleared.
    expect(() => act(() => vi.advanceTimersByTime(10_000))).not.toThrow();
  });
});
