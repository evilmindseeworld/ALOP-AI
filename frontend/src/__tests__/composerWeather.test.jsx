import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The composer sky carries a sun by day and a crescent by night.
 *
 * Asserted against the SOURCE rather than a render, and the reason is worth
 * stating because it bounds what these tests can prove: jsdom does no layout
 * and applies no stylesheet, so it cannot tell which disc is visible. What it
 * CAN check is the pair of invariants that make the swap safe — that both discs
 * share the sun's measured geometry, and that exactly one of them is shown per
 * theme. A rendering test would prove neither.
 */
const SRC = readFileSync(
  join(__dirname, "..", "components", "SakuraFrame.jsx"),
  "utf8",
);
const CSS = readFileSync(join(__dirname, "..", "styles", "composer.css"), "utf8");

/** `<circle className="composer-sun" cx="96" cy="11" r="9" />` → the numbers. */
const discOf = (name) => {
  const re = new RegExp(`className="${name}"([^/]*)/`);
  const attrs = re.exec(SRC)?.[1] ?? "";
  return {
    cx: /cx="([\d.]+)"/.exec(attrs)?.[1],
    cy: /cy="([\d.]+)"/.exec(attrs)?.[1],
    r: /r="([\d.]+)"/.exec(attrs)?.[1],
  };
};

describe("the composer sky", () => {
  test("the moon occupies exactly the sun's disc", () => {
    // THE LOAD-BEARING ONE. Every clearance in ComposerSkyline's comments is
    // measured against one disc at (96, 11) r=9: 5.46 units to the nearest
    // cloud bar, 11 units of sky above the town, and a focus-within lift that
    // must not clip the crown. Drawing the night disc anywhere else silently
    // invalidates all of it — and it would look fine in light mode, so nobody
    // would find it.
    const sun = discOf("composer-sun");
    const moon = discOf("composer-moon");
    expect(sun.cx).toBeDefined();
    expect(moon.cx).toBeDefined();
    expect(moon).toEqual(sun);
  });

  test("the crescent is cut from the disc, not drawn beside it", () => {
    // The bite is a masked second circle. If this ever became a hand-authored
    // path, the equality above would still pass while the shape drifted.
    expect(SRC).toMatch(/mask id="composer-moon-bite"/);
    expect(SRC).toMatch(/className="composer-moon"[^/]*mask="url\(#composer-moon-bite\)"/);
  });

  test("exactly one disc is visible per theme", () => {
    expect(CSS).toMatch(/\.composer-moon\s*\{\s*display:\s*none/);
    expect(CSS).toMatch(/\.app-root\.dark\s+\.composer-sun\s*\{\s*display:\s*none/);
    expect(CSS).toMatch(/\.app-root\.dark\s+\.composer-moon\s*\{\s*display:\s*block/);
  });

  test("the sun is the default, so a missing theme class is not an empty sky", () => {
    // App.jsx always sets one of .light/.dark, but a drawing that vanishes when
    // a class is absent is a worse failure than one that shows the wrong disc.
    const moonHidden = CSS.indexOf(".composer-moon { display: none; }");
    const darkRule = CSS.indexOf(".app-root.dark .composer-moon");
    expect(moonHidden).toBeGreaterThan(-1);
    expect(darkRule).toBeGreaterThan(moonHidden);
  });

  test("both discs take the focus-within lift", () => {
    // The sun rises 2px when the composer takes focus. A moon that stayed put
    // would be the one ornament in the set that ignores focus.
    const lift = /:focus-within \.composer-sun,\s*\.input-wrapper:focus-within \.composer-moon \{/;
    expect(CSS).toMatch(lift);
  });
});
