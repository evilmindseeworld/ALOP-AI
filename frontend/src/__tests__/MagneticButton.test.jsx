import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  it("RENDERS A WORKING BUTTON BEFORE THE MOTION CHUNK ARRIVES", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <MagneticButton className="icon-btn" ariaLabel="Theme" onClick={onClick}>
        <span>icon</span>
      </MagneticButton>,
    );

    // Synchronously after render this is the fallback, not the lazy component.
    const fallback = screen.getByRole("button", { name: "Theme" });
    expect(fallback).toHaveClass("icon-btn");

    await user.click(fallback);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("still works once the real one has loaded", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <MagneticButton className="upgrade-btn" ariaLabel="Upgrade to Pro" onClick={onClick}>
        <span>Upgrade</span>
      </MagneticButton>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Upgrade to Pro" })).toHaveClass("upgrade-btn");
    });
    await user.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
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
