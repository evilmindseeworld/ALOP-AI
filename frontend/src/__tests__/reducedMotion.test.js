import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * The animations a stylesheet cannot switch off.
 *
 * The reduced-motion story looked finished: there is a `@media
 * (prefers-reduced-motion: reduce)` block, nine components honour it, and
 * cssCascade even models the query as a test axis. None of that reaches
 * anime.js. It writes inline styles frame by frame from JavaScript, and a CSS
 * media query has no opinion about a value assigned to `element.style` — so
 * both `animate()` calls in App.jsx ran at full motion for a user who had
 * asked the entire operating system for less.
 *
 * The transcript one is the serious half: a row springs in on EVERY message,
 * and repetition is precisely what motion sensitivity reacts to.
 *
 * ASSERTED AS SOURCE, and this is a deliberate trade rather than laziness.
 * Proving it behaviourally means mounting the whole of App — which needs the
 * sixty lines of Clerk, chat, billing and animejs mocks that AppRenders.test
 * carries — and the mock for animejs would be the very thing under test. The
 * defect this guards against is a future edit DELETING the check, which is
 * visible in the source. `search-latency.test.js` in the backend makes the same
 * call for the same reason.
 */

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "App.jsx"),
  "utf8"
);

describe("prefers-reduced-motion reaches the JS-driven animations", () => {
  it("defines the check against matchMedia", () => {
    expect(source).toMatch(/matchMedia\(\s*["']\(prefers-reduced-motion: reduce\)["']\s*\)/);
  });

  it("reads the setting at call time, not once at module load", () => {
    // A value captured at import keeps animating until a reload, and this is a
    // system setting a user can change with the tab already open. The check
    // has to be a function that is called, not a const that was resolved.
    expect(source).toMatch(/const reducedMotion = \(\) =>/);
  });

  it("guards BOTH animate() call sites", () => {
    // Two calls, and the transcript one is the one that repeats. A guard on
    // only the button press would look like the box was ticked.
    const calls = [...source.matchAll(/animate\(/g)];
    expect(calls.length, "a new animate() call needs its own guard").toBe(2);
    expect(source).toContain("rows.length && !reducedMotion()");
    expect(source).toContain("if (reducedMotion()) return;");
  });
});
