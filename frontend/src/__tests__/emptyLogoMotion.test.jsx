import { describe, it, expect } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { createDraggable } from "animejs";

/**
 * THE EMPTY-STATE LOGO CRASHED THE APP, AND THE MESSAGE NAMED NOTHING.
 *
 *   TypeError: this.animate[this.xProp] is not a function
 *
 * No file, no element, no selector. The cause is one line of animejs:
 * Draggable resolves its target with `parseTargets(target)[0]`, which is
 * `undefined` when a SELECTOR matches nothing. `new Animatable(undefined, ...)`
 * then returns before defining any property method, and the first call to
 * `this.animate.translateX(...)` throws.
 *
 * It shipped because the motion was driven from App.jsx by an effect keyed on
 * the message list, which is not the same condition as "the empty state is on
 * screen". Two paths disagreed: MessageList is a lazy chunk, so on first paint
 * the Suspense fallback is mounted and the logo is not; and `status` leaves
 * "idle" the instant a message is sent, which unmounts EmptyState while the
 * list is still empty. Every fresh sign-in hit the first one.
 *
 * The first test is the mechanism, so the next person to reach for a selector
 * sees what it costs. The second is the fix: EmptyState animates a ref, and a
 * ref cannot point at an element that is not in the document.
 */

/* The geometry and observer stubs Draggable needs live in src/test/setup.js —
 * every test that renders the empty state needs them, not just this one. */

describe("the empty-state logo", () => {
  it("reproduces the production crash: a selector that matches nothing", () => {
    expect(document.querySelector(".empty-logo")).toBeNull();
    expect(() => createDraggable(".empty-logo")).toThrowError(/is not a function/);
  });

  it("does not crash when the target is an element", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(() => createDraggable(el)).not.toThrow();
    el.remove();
  });

  it("mounts EmptyState with real animejs and does not throw", async () => {
    const { EmptyState } = await import("../components/MessageList");
    const { container, unmount } = render(<EmptyState onPick={() => {}} />);
    // The element the effect binds to has to actually be there, or this test
    // passes for the wrong reason — a ref that stayed null skips the work.
    expect(container.querySelector(".empty-logo")).toBeTruthy();
    // Unmount runs pulse.revert() and drag.revert(); a missing revert only
    // fails here, which is where it belongs rather than as a later flake.
    expect(() => unmount()).not.toThrow();
    cleanup();
  });
});
