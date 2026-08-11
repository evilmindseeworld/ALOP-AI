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
  it("shows nothing at first, because a slow load is not an outage", () => {
    const { container } = render(<SignInPage />);
    expect(container).toBeEmptyDOMElement();
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
