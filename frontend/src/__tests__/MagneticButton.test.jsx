import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MagneticButton from "../components/ui/MagneticButton";

// MagneticButton is a Suspense wrapper whose only job is to keep framer-motion
// (40.75 KB gzipped) off the critical path. It is the app's four header
// buttons, so the thing worth asserting is not the magnet — it is that the
// button is a fully working button during the moment before the chunk lands.
//
// The failure this guards against is quiet: a fallback that renders but drops
// onClick gives you a header whose buttons do nothing for the first few
// hundred milliseconds, on the slow connections where the split matters most
// and where nobody testing on localhost would ever see it.
describe("MagneticButton", () => {
  it("RENDERS A WORKING BUTTON BEFORE THE MOTION CHUNK ARRIVES", () => {
    const onClick = vi.fn();

    render(
      <MagneticButton className="icon-btn" ariaLabel="Theme" onClick={onClick}>
        <span>icon</span>
      </MagneticButton>,
    );

    // Synchronously after render this is the fallback, not the lazy component.
    const fallback = screen.getByRole("button", { name: "Theme" });
    expect(fallback).toHaveClass("icon-btn");

    /* SYNCHRONOUS ON PURPOSE, and this is the whole point of the test.
     *
     * `fallback` is the node Suspense rendered while the chunk was still in
     * flight. The moment this test awaits anything, the lazy import is free to
     * resolve, React commits the real component, and that node is REPLACED --
     * `fallback.isConnected` goes false. A click on a detached node reaches no
     * React handler, so the assertion below failed with "expected 1, got 0"
     * roughly 1 run in 30, and once in CI on PR #4. The component was never
     * wrong; the test was holding a stale reference across an await.
     *
     * `fireEvent.click` runs start to finish without yielding, so the chunk
     * provably cannot land between the query above and the assertion below --
     * which is the only way to assert something about the pre-chunk state. Do
     * not "modernise" this to `await user.click(fallback)`; that is the bug.
     * The loaded state is covered by the next test, which re-queries. */
    fireEvent.click(fallback);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(fallback.isConnected).toBe(true);
  });

  it("still works once the real one has loaded", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <MagneticButton className="upgrade-btn" ariaLabel="Upgrade to Pro" onClick={onClick}>
        <span>Upgrade</span>
      </MagneticButton>,
    );

    /* WAIT FOR THE SWAP, NOT FOR A CLASS BOTH STATES RENDER.
     *
     * The fallback and the motion version are deliberately identical in tag,
     * class and layout -- that is the point of the fallback -- so a `waitFor`
     * on `.upgrade-btn` matched the FALLBACK on the first tick and waited for
     * nothing. The click that followed could then land mid-swap on a node
     * React had already detached, and the handler never fired.
     *
     * Node identity is the one thing that does change, so it is what "the real
     * one has loaded" actually means here. Once it has, no further swap is
     * pending and awaiting a real user click is safe. */
    const fallback = screen.getByRole("button", { name: "Upgrade to Pro" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Upgrade to Pro" })).not.toBe(fallback);
    });

    const loaded = screen.getByRole("button", { name: "Upgrade to Pro" });
    expect(loaded).toHaveClass("upgrade-btn");
    await user.click(loaded);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("a disabled button is disabled in both states", async () => {
    // The settings button ships disabled in the gallery, and a fallback that
    // forgot the attribute would be clickable for exactly as long as the
    // chunk takes.
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <MagneticButton className="icon-btn" ariaLabel="Settings" disabled onClick={onClick}>
        <span>gear</span>
      </MagneticButton>,
    );

    expect(screen.getByRole("button", { name: "Settings" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Settings" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Settings" })).toBeDisabled();
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not submit a surrounding form", async () => {
    // A bare <button> defaults to type="submit". The motion version renders a
    // <button> too, so the fallback matching it matters less than both being
    // safe inside the panels' forms.
    const onSubmit = vi.fn((e) => e.preventDefault());
    const user = userEvent.setup();

    render(
      <form onSubmit={onSubmit}>
        <MagneticButton ariaLabel="Theme" onClick={() => {}}>
          <span>icon</span>
        </MagneticButton>
      </form>,
    );

    await user.click(screen.getByRole("button", { name: "Theme" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
