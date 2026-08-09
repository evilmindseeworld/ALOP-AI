import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import CouncilInk from "../components/CouncilInk";

/**
 * The ensō.
 *
 * Three of these are about the drawing being right and three are about the
 * motion being rare. The motion half matters more: the ornament this replaced
 * had three infinite decorative loops running at once, and the whole argument
 * for the new one is that it holds still unless it has something to report.
 */

const draw = (props = {}) => render(<CouncilInk {...props} />).container.querySelector("svg");

// The once-per-session flag lives at module scope, so every test that cares
// about the draw-in has to start from a fresh copy of the module.
const freshInk = async () => {
  vi.resetModules();
  return (await import("../components/CouncilInk")).default;
};

beforeEach(() => cleanup());

describe("the drawing", () => {
  it("is seven arcs, because the council is seven models", () => {
    // If the roster ever changes, this fails and the drawing gets updated with
    // it — the number is a fact about the product, not a composition choice.
    expect(draw().querySelectorAll(".ink-arc")).toHaveLength(7);
  });

  it("leaves the ring open", () => {
    // An ensō that closes is just a circle, and a closed circle on an empty
    // state is a loading spinner. The gap is the question nobody has asked yet.
    const arcs = [...draw().querySelectorAll(".ink-arc")];
    const ends = arcs.map((a) => a.getAttribute("d"));
    // First and last arc endpoints must not coincide.
    const firstStart = ends[0].match(/M([\d.-]+) ([\d.-]+)/).slice(1).map(Number);
    const lastEnd = ends[6].match(/([\d.-]+) ([\d.-]+)$/).slice(1).map(Number);
    const gap = Math.hypot(firstStart[0] - lastEnd[0], firstStart[1] - lastEnd[1]);
    expect(gap, "the ring closed — that is a spinner, not an ensō").toBeGreaterThan(20);
  });

  it("uses exactly one colour, on the stroke that finishes the ring", () => {
    const arcs = [...draw().querySelectorAll(".ink-arc")];
    const primary = arcs.filter((a) => a.getAttribute("stroke") === "var(--primary)");
    expect(primary).toHaveLength(1);
    expect(primary[0], "the colour belongs to the last stroke laid down").toBe(arcs[6]);
    for (const a of arcs.slice(0, 6)) expect(a.getAttribute("stroke")).toBe("var(--ink)");
  });

  it("normalises every arc's length so one offset draws them all evenly", () => {
    // Without pathLength the arcs have different real lengths, so a shared
    // dashoffset would draw the short ones faster and the ring would arrive in
    // pieces instead of as one continuous hand.
    for (const a of draw().querySelectorAll(".ink-arc")) {
      expect(a.getAttribute("pathLength")).toBe("100");
    }
  });

  it("is decoration, and says so to a screen reader", () => {
    expect(draw().getAttribute("aria-hidden")).toBe("true");
    expect(draw().getAttribute("focusable")).toBe("false");
  });
});

describe("when it moves", () => {
  it("draws itself once per session, not once per empty state", async () => {
    const Ink = await freshInk();
    const first = render(<Ink />);
    // It starts undrawn, so there is something for the transition to move from.
    expect(first.container.querySelector("svg").getAttribute("class")).not.toContain("is-drawn");

    // Two frames, which is what the component waits for. They have to run
    // BEFORE unmount: the effect's cleanup cancels the pending frame, so a
    // component torn down mid-flourish correctly leaves the flag unset.
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    expect(first.container.querySelector("svg").getAttribute("class")).toContain("is-drawn");

    cleanup();
    // A later empty state in the same session renders already finished.
    // Opening a new chat is a many-times-a-day action, and a flourish on each
    // one wears through fast.
    const second = render(<Ink />).container.querySelector("svg");
    expect(second.getAttribute("class"), "the flourish replayed on a second mount").toContain(
      "is-drawn"
    );
  });

  it("only marks itself active when the council is actually working", () => {
    // is-active is the one class that starts an infinite animation. It must be
    // tied to real state, or the ornament becomes the thing it replaced.
    expect(draw().getAttribute("class")).not.toContain("is-active");
    expect(draw({ active: true }).getAttribute("class")).toContain("is-active");
  });

  it("steps back once there is a conversation to read", () => {
    expect(draw({ dim: true }).getAttribute("class")).toContain("is-dim");
    expect(draw().getAttribute("class")).not.toContain("is-dim");
  });
});
