import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import ErrorBoundary from "../components/ErrorBoundary";

const Boom = () => {
  throw new Error("kaboom in render");
};

describe("ErrorBoundary", () => {
  // React logs the caught error to console.error by design. Silencing it keeps
  // the run readable; asserting on our own console.error would be asserting on
  // React's noise, so the boundary's behaviour is checked through the DOM.
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("renders children untouched when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("all good")).toBeInTheDocument();
  });

  it("shows a screen instead of a white page when a child throws", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something broke on our side.")).toBeInTheDocument();
    // The message, so a support request carries something findable.
    expect(screen.getByText(/kaboom in render/)).toBeInTheDocument();
  });

  it("offers a way out, and Reload actually reloads", () => {
    const reload = vi.fn();
    const original = window.location;
    // jsdom's location is read-only; replacing the object is the supported way
    // to observe a reload without navigating the test environment.
    delete window.location;
    window.location = { ...original, reload, href: "/" };

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    screen.getByRole("button", { name: "Reload" }).click();
    expect(reload).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Start a new chat" })).toBeInTheDocument();

    window.location = original;
  });

  it("the crash screen is itself accessible", async () => {
    const { container } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    const { violations } = await axe(container, { rules: { "color-contrast": { enabled: false } } });
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});
