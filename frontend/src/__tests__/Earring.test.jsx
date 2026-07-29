import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Earring } from "../App";

// The earrings are decoration. Everything worth asserting here is about them
// staying out of the way: out of the accessibility tree, out of the way of
// pointer input, and out of the way of the UI's stacking order.
describe("Earring", () => {
  it("renders one earring per side", () => {
    render(
      <>
        <Earring side="left" />
        <Earring side="right" />
      </>
    );

    expect(screen.getByTestId("earring-left")).toBeInTheDocument();
    expect(screen.getByTestId("earring-right")).toBeInTheDocument();
  });

  it("is hidden from assistive technology", () => {
    render(<Earring side="left" />);

    expect(screen.getByTestId("earring-left")).toHaveAttribute("aria-hidden", "true");
  });

  it("never intercepts pointer input or exposes camera controls", () => {
    render(<Earring side="left" />);
    const viewer = document.querySelector("model-viewer");

    expect(viewer).toBeInTheDocument();
    expect(viewer).not.toHaveAttribute("camera-controls");
    expect(viewer).toHaveStyle({ pointerEvents: "none" });
  });

  it("does not set an inline z-index, so App.css stays the source of truth", () => {
    render(<Earring side="left" />);

    // A regression here means the stylesheet has been silently overridden
    // again, which is what caused the earlier run of duelling z-index commits.
    expect(screen.getByTestId("earring-left").style.zIndex).toBe("");
  });
});
