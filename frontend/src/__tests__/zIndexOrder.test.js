import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "App.css"),
  "utf8"
);

/**
 * Nine commits were spent guessing earring z-index values because nothing
 * recorded the intended stacking order. These tests ARE that record. If you
 * change the scale in App.css and a test here fails, the failure names the
 * exact pair that inverted.
 */

/** Parse the --z-* token definitions out of :root. */
const tokens = (() => {
  const root = CSS.slice(CSS.indexOf(":root"), CSS.indexOf("--shadow-xs"));
  const found = {};
  for (const [, name, value] of root.matchAll(/(--z-[a-z-]+)\s*:\s*(\d+)\s*;/g)) {
    found[name] = Number(value);
  }
  return found;
})();

/** Every z-index declaration outside the :root block. */
const declarations = (() => {
  const body = CSS.slice(CSS.indexOf("--shadow-xs"));
  return [...body.matchAll(/z-index:\s*([^;]+);/g)].map((m) => m[1].trim());
})();

describe("z-index token scale", () => {
  it("defines every layer in the scale", () => {
    expect(Object.keys(tokens).sort()).toEqual(
      [
        "--z-backdrop",
        "--z-behind",
        "--z-camera",
        "--z-chat",
        "--z-earring",
        "--z-fab",
        "--z-in-chat-control",
        "--z-panel",
        "--z-panel-overlay",
        "--z-quick-ask",
        "--z-sidebar",
        "--z-sidebar-mobile",
        "--z-toast",
      ].sort()
    );
  });

  it("finds the z-index declarations it expects to govern", () => {
    // A guard on the parser itself: if this drops to zero the other tests
    // would vacuously pass and the scale would be unprotected.
    expect(declarations.length).toBeGreaterThanOrEqual(13);
  });

  // The rule that keeps the scale honest. A bare number is how every previous
  // regression entered: someone nudged a value in place instead of the scale.
  it("never uses a bare z-index number outside the token block", () => {
    const bare = declarations.filter((d) => /^-?\d+$/.test(d));
    expect(bare, `bare z-index values found: ${bare.join(", ")}`).toEqual([]);
  });

  it("only references tokens that actually exist", () => {
    const referenced = declarations
      .map((d) => d.match(/var\((--z-[a-z-]+)\)/)?.[1])
      .filter(Boolean);
    const undefinedRefs = referenced.filter((name) => !(name in tokens));
    expect(undefinedRefs, `undefined tokens: ${undefinedRefs.join(", ")}`).toEqual([]);
  });
});

describe("stacking order invariants", () => {
  // Ascending order the UI depends on. Each pair is asserted individually so a
  // failure names the two layers that inverted rather than dumping the array.
  const ascending = [
    "--z-behind",
    "--z-backdrop",
    "--z-chat",
    "--z-earring",
    "--z-sidebar",
    "--z-sidebar-mobile",
    "--z-panel-overlay",
    "--z-panel",
    "--z-camera",
    "--z-toast",
    "--z-fab",
    "--z-quick-ask",
  ];

  for (let i = 0; i < ascending.length - 1; i++) {
    const below = ascending[i];
    const above = ascending[i + 1];
    it(`${below} sits below ${above}`, () => {
      expect(tokens[below]).toBeLessThan(tokens[above]);
    });
  }

  // The specific invariant that nine commits kept breaking, stated outright so
  // its intent survives even if someone rewrites the loop above.
  it("earrings sit ABOVE the chat window", () => {
    expect(tokens["--z-earring"]).toBeGreaterThan(tokens["--z-chat"]);
  });

  it("earrings sit BELOW every menu and panel", () => {
    expect(tokens["--z-earring"]).toBeLessThan(tokens["--z-sidebar"]);
    expect(tokens["--z-earring"]).toBeLessThan(tokens["--z-panel-overlay"]);
    expect(tokens["--z-earring"]).toBeLessThan(tokens["--z-panel"]);
  });

  it("a toast clears every panel, because it can appear while one is open", () => {
    expect(tokens["--z-toast"]).toBeGreaterThan(tokens["--z-panel"]);
    expect(tokens["--z-toast"]).toBeGreaterThan(tokens["--z-camera"]);
  });

  it("the click-away scrim sits directly beneath its panel", () => {
    expect(tokens["--z-panel-overlay"]).toBeLessThan(tokens["--z-panel"]);
  });
});

describe("in-chat controls are contained by a stacking context", () => {
  // --z-in-chat-control (80) is numerically higher than --z-panel (70), which
  // looks like a bug and has been "fixed" before. It is not one: .chat-main is
  // positioned at --z-chat, creating a stacking context that traps its
  // children below --z-earring regardless of their number. This test documents
  // that so the next reader does not "correct" it.
  it("keeps .chat-main positioned, which is what provides the containment", () => {
    const block = CSS.match(/\.chat-main\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(block).toMatch(/position:\s*(relative|absolute|fixed|sticky)/);
    expect(block).toMatch(/z-index:\s*var\(--z-chat\)/);
  });

  it("documents why the in-chat control may exceed --z-panel", () => {
    expect(tokens["--z-in-chat-control"]).toBeGreaterThan(tokens["--z-panel"]);
    expect(CSS).toMatch(/stacking context/i);
  });
});
