import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readStylesheet } from "../test/cssSnapshot";

// App.css is an import manifest now, so read it with its imports inlined —
// in manifest order, which is the cascade.
const CSS = readStylesheet(join(dirname(fileURLToPath(import.meta.url)), "..", "App.css"));

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
"--z-behind",
        "--z-camera",
        "--z-chat",
        // The grain sits ABOVE the wash and below every piece of content, so
        // it dithers the gradient rather than being dithered by it. Banding is
        // what happens when a gradient crosses many steps in few pixels; noise
        // on top is the standard fix, and it only works from on top.
        "--z-grain",
        "--z-cmdk",
        "--z-earring",
"--z-in-chat-control",
        "--z-panel",
        "--z-panel-overlay",
"--z-sidebar",
        "--z-sidebar-mobile",
        // Scoped INSIDE .chat-list, like --z-in-chat-control is scoped inside
        // .chat-main. It is not in the `ascending` array below because it is
        // not comparable with the root scale: sticky group headings only have
        // to beat the .chat-item rows they scroll past, and those rows are
        // positioned (for .chat-actions), so DOM order would otherwise let a
        // later row paint over an earlier heading.
        "--z-sticky-label",
        "--z-toast",
      ].sort()
    );
  });

  it("finds the z-index declarations it expects to govern", () => {
    // A guard on the parser itself: if this drops to zero the other tests
    // would vacuously pass and the scale would be unprotected.
    expect(declarations.length).toBeGreaterThanOrEqual(11);
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
    "--z-grain",
    "--z-chat",
    "--z-earring",
    "--z-sidebar",
    "--z-sidebar-mobile",
    "--z-panel-overlay",
    "--z-panel",
    "--z-camera",
    "--z-toast",
    "--z-cmdk",
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

/**
 * The hole this suite originally had.
 *
 * It asserted --z-earring (4) < --z-panel (70) and called the ordering safe.
 * But .side-panel was rendered INSIDE .chat-main, which is positioned at
 * --z-chat (3) and therefore creates a stacking context. The panel's 70 was
 * scoped inside that context — effectively "3.70" in the root context — while
 * the earring's 4 sat in the root context directly. The earrings visibly
 * covered the settings menu, and every number in the scale said they shouldn't.
 *
 * z-index values in DIFFERENT stacking contexts are not comparable. A numeric
 * assertion alone cannot catch this, so these tests check the DOM instead.
 */
describe("panels escape the chat stacking context", () => {
  const componentsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "components");
  const panelsDir = join(componentsDir, "panels");

  // The panels live in components/panels/ now, one file each. Reading the
  // directory rather than naming them means a fourth panel added inline is
  // caught, which is the whole point of the count assertion below.
  const PANEL_FILES = readdirSync(panelsDir).filter((f) => f.endsWith(".jsx"));
  const PANEL_SOURCE = PANEL_FILES.map((f) => readFileSync(join(panelsDir, f), "utf8"));
  const APP = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "App.jsx"), "utf8");
  const ALL = [APP, ...PANEL_SOURCE].join("\n");

  it("renders panels through SidePanel rather than inline in .chat-main", () => {
    // A literal `<div className="side-panel">` is the shape that trapped them
    // inside .chat-main's stacking context. Only SidePanel itself may write it.
    expect(APP).not.toMatch(/className="side-panel"/);
    for (const source of PANEL_SOURCE) expect(source).not.toMatch(/className="side-panel"/);
    expect(ALL).toMatch(/<SidePanel\b/);
  });

  it("portals SidePanel out of the chat stacking context", () => {
    // SidePanel delegates to the Radix-backed Sheet, which portals to
    // document.body. Asserted here at the source level so a refactor back to
    // an inline div is caught; SidePanel.test.jsx asserts the same property by
    // rendering, which is what actually proves it.
    const panel = readFileSync(join(componentsDir, "SidePanel.jsx"), "utf8");
    expect(panel).toMatch(/<SheetContent/);

    const sheet = readFileSync(join(componentsDir, "ui", "sheet.jsx"), "utf8");
    expect(sheet).toMatch(/DialogPrimitive\.Portal/);
  });

  it("keeps every panel on the portal path", () => {
    // Admin, Settings and Upgrade. Every file in components/panels must route
    // through SidePanel; one that does not inherits the original bug.
    expect(PANEL_FILES.length).toBeGreaterThanOrEqual(3);
    for (const [i, source] of PANEL_SOURCE.entries()) {
      expect(source, `${PANEL_FILES[i]} does not render through SidePanel`).toMatch(/<SidePanel\b/);
    }
  });

  // Now that panels are siblings of the earring in the root context, the
  // numeric comparison finally means what it claims to.
  it("panel outranks the earring once both are in the same context", () => {
    expect(tokens["--z-panel"]).toBeGreaterThan(tokens["--z-earring"]);
    expect(tokens["--z-panel-overlay"]).toBeGreaterThan(tokens["--z-earring"]);
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
