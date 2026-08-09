import { describe, it, expect } from "vitest";
import { clerkAppearance } from "../lib/clerkAppearance";

/**
 * The focus ring on the sign-in email input was CLIPPED, and only a real
 * browser could see it.
 *
 * Clerk's `cardBox` ships `overflow: hidden`. The email input is full-bleed to
 * it — measured 1px OUTSIDE its left edge in production — and the focus ring is
 * a 3px box-shadow spread. A box-shadow is clipped by an ancestor's overflow,
 * so the ring was sliced flat on both sides: the indicator lost its left and
 * right edges on the one control a signed-out visitor lands on.
 *
 * Nothing static caught it. `a11y.test.jsx` runs axe, which checks that a focus
 * style EXISTS, not that it survives its ancestors' geometry. The rule was
 * declared correctly and rendered wrong, which is the same class of failure as
 * the contrast bug: correct in isolation, broken as composed.
 *
 * This test cannot see geometry either, so it guards the one line that fixes
 * it. If `overflow` stops being visible here, the ring is being clipped again.
 * Verified in a browser when written: `getComputedStyle(cardBox).overflow` is
 * "visible" and the ring renders with its corner radius intact on all four
 * sides.
 */
describe("Clerk cardBox does not clip the focus ring", () => {
  it("sets overflow visible", () => {
    expect(clerkAppearance.elements.cardBox.overflow).toBe("visible");
  });

  it("still resets the card chrome, which is why the clipping is safe to drop", () => {
    // overflow: hidden would be load-bearing if this element painted a
    // background or rounded a corner. It does neither, and that is precisely
    // what makes turning it off safe rather than a trade.
    const { cardBox } = clerkAppearance.elements;
    expect(cardBox.background).toBe("transparent");
    expect(cardBox.borderRadius).toBe(0);
  });
});
