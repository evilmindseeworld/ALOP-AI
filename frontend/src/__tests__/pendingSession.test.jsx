import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import SessionPending from "../components/SessionPending";

/**
 * THE INFINITE LOADING SCREEN, and it was not a race or a slow request.
 *
 * Clerk's two hooks answer "is this user signed in?" differently, and the app
 * asked one of them at the gate and the other inside:
 *
 *   useAuth():  isSignedIn = session.status !== "pending" && !!session
 *   useUser():  isSignedIn = a user object exists. No session check at all.
 *
 * With `force_organization_selection: true` on the instance — which was set,
 * and is visible in the live /v1/environment payload — Clerk holds every
 * session at status "pending" until an organization is chosen. This app has
 * no organization UI, so that task could never be completed. The result:
 *
 *   useUser().isSignedIn  -> true   so the wrapper rendered AuthenticatedApp
 *   useAuth().isSignedIn  -> false  so isReady stayed false
 *   -> loadChats never ran, isInitialLoading never cleared, AppSkeleton forever
 *
 * The instance setting is the cure. This is the guard: a session the app
 * cannot use must produce a SCREEN, never a spinner. Any future cause of a
 * pending session lands here instead of hanging.
 */
describe("a pending session", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("says what is wrong instead of spinning", () => {
    render(<SessionPending onSignOut={() => {}} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Your session needs one more step.")).toBeInTheDocument();
  });

  it("names the task when Clerk provides one", () => {
    render(<SessionPending task={{ key: "org" }} onSignOut={() => {}} />);
    // The key is shown verbatim rather than translated into prose: an
    // unrecognised task must still produce something searchable rather than a
    // generic sentence that hides which task is blocking.
    // The <code> element specifically — "organization" also appears in the
    // administrator note below it.
    expect(screen.getByText("org", { selector: "code" })).toBeInTheDocument();
  });

  it("always offers a way out, because a stuck session cannot fix itself", async () => {
    const onSignOut = vi.fn();
    render(<SessionPending onSignOut={onSignOut} />);
    screen.getByRole("button", { name: "Sign out" }).click();
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("is accessible", async () => {
    const { axe } = await import("vitest-axe");
    const { container } = render(<SessionPending onSignOut={() => {}} />);
    const { violations } = await axe(container, { rules: { "color-contrast": { enabled: false } } });
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});
