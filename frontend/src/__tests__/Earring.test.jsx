import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Earring from "../components/Earring";

// The earrings are decoration. Everything worth asserting is about them staying
// out of the way: out of the accessibility tree, out of the way of pointer
// input, and out of the way of the UI's stacking order.
//
// They were a <model-viewer> rendering a 9.4MB model.glb — roughly 47x the
// gzipped JS bundle — served alongside a runtime pulled from an unpinned unpkg
// URL. They are now an inline SVG of about a kilobyte.
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

  it("does not set an inline z-index, so App.css stays the source of truth", () => {
    render(<Earring side="left" />);
    // A regression here means the stylesheet has been silently overridden
    // again, which caused the earlier run of duelling z-index commits.
    expect(screen.getByTestId("earring-left").style.zIndex).toBe("");
  });

  it("renders an inline SVG rather than a 3D model", () => {
    render(<Earring side="left" />);
    const wrap = screen.getByTestId("earring-left");

    expect(wrap.querySelector("svg.crescent")).toBeInTheDocument();
    expect(wrap.querySelector("model-viewer")).not.toBeInTheDocument();
  });

  // The theme switch is CSS, so BOTH ornaments have to be in the DOM for it to
  // have anything to switch between. If a future refactor picks one in React,
  // this is the test that should stop it — the class on `.app-root` would then
  // no longer be the source of truth, and the wrong ornament paints for a frame
  // before the hook resolves.
  it("hangs both ornaments so the stylesheet can choose", () => {
    render(<Earring side="left" />);
    const wrap = screen.getByTestId("earring-left");

    expect(wrap.querySelector("svg.crescent")).toBeInTheDocument();
    expect(wrap.querySelector("svg.sun")).toBeInTheDocument();
  });

  it("draws the sun to the crescent's box, so the pair hangs at one height", () => {
    render(<Earring side="left" />);
    const wrap = screen.getByTestId("earring-left");
    const box = (sel) => wrap.querySelector(sel).getAttribute("viewBox");

    expect(box("svg.sun")).toBe(box("svg.crescent"));
  });

  it("loads no external asset", () => {
    render(<Earring side="left" />);
    const wrap = screen.getByTestId("earring-left");

    // The whole point of the swap: no .glb, no CDN runtime, no network at all.
    expect(wrap.querySelector("img, [src]")).toBeNull();
    expect(wrap.innerHTML).not.toMatch(/\.glb|unpkg|http/);
  });

  // Two earrings render at once. Duplicate gradient/mask ids would make the
  // second instance dereference the first's defs, and in some browsers the
  // right-hand crescent would silently render as a plain disc.
  it("gives each side unique SVG def ids", () => {
    render(
      <>
        <Earring side="left" />
        <Earring side="right" />
      </>
    );

    // Across BOTH ornaments and both sides — four SVGs share one document, so
    // the sun's gradient ids have to be distinct from the crescent's too.
    const ids = [...document.querySelectorAll("svg.crescent [id], svg.sun [id]")].map((n) => n.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size, `duplicate ids: ${ids.join(", ")}`).toBe(ids.length);
  });

  it("resolves its own mask and gradient references", () => {
    render(<Earring side="left" />);

    for (const svg of document.querySelectorAll("svg.crescent, svg.sun")) {
      for (const attr of ["mask", "fill", "stroke"]) {
        for (const node of svg.querySelectorAll(`[${attr}^="url("]`)) {
          const id = node.getAttribute(attr).match(/url\(#(.+?)\)/)?.[1];
          expect(svg.querySelector(`#${id}`), `${attr} points at missing #${id}`).toBeTruthy();
        }
      }
    }
  });
});

/**
 * The ornament is the app's one piece of motion that carries information
 * rather than decorating: it swings wider while the council is working, so
 * the periphery reports activity without another spinner mid-page.
 */
describe("Earring — the working state", () => {
  it("is idle by default", () => {
    const { container } = render(<Earring side="left" />);
    expect(container.querySelector(".earring-wrap").className).not.toContain("is-active");
  });

  it("marks itself active while an answer is arriving", () => {
    const { container } = render(<Earring side="left" active />);
    expect(container.querySelector(".earring-wrap").className).toContain("is-active");
  });

  it("stays decorative to a screen reader in both states", () => {
    // Motion that reports status must NOT become an announcement: the live
    // region in MessageList already says an answer is in progress, and a
    // second voice saying it is redundant noise.
    const { container } = render(<Earring side="right" active />);
    expect(container.querySelector(".earring-wrap")).toHaveAttribute("aria-hidden", "true");
  });
});
