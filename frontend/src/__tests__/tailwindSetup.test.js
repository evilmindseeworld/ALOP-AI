import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readStylesheet } from "../test/cssSnapshot";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(src, f), "utf8");

const TAILWIND_CSS = read("tailwind.css");
// Comments in tailwind.css explain at length why Preflight is excluded, so any
// check for the word itself has to look at real declarations only.
const TAILWIND_CODE = TAILWIND_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const MAIN = read("main.jsx");
// App.css is an import manifest now; the tokens live in src/styles/tokens.css.
// Read the whole stylesheet so the bridge is checked against every token the
// app actually defines, wherever it was split to.
const APP_CSS = readStylesheet(join(src, "App.css"));

/**
 * Tailwind is additive here. App.css is 2,892 hand-written lines whose base
 * styling Preflight would reset out from under it — the app would look broken
 * in a way that reads as "the CSS died", not "a reset ran". These tests keep
 * that from happening by accident.
 */
describe("Tailwind is additive, not a takeover", () => {
  // The one-line change that would break everything: `@import "tailwindcss"`
  // pulls in Preflight. The setup imports theme and utilities separately to
  // avoid exactly that.
  it("never imports the tailwindcss bundle wholesale", () => {
    const wholesale = /@import\s+["']tailwindcss["']\s*;/;
    expect(
      wholesale.test(TAILWIND_CODE),
      'found `@import "tailwindcss"` — this pulls in Preflight and will reset App.css'
    ).toBe(false);
  });

  it("never imports Preflight directly", () => {
    expect(TAILWIND_CODE).not.toMatch(/preflight/i);
  });

  it("does import theme and utilities, so the utilities still exist", () => {
    expect(TAILWIND_CSS).toMatch(/@import\s+["']tailwindcss\/theme\.css["']\s+layer\(theme\)/);
    // Utilities are imported UNLAYERED on purpose. See the block at the bottom
    // of this file: layering them made every padding and margin utility a
    // no-op against base.css's `* { margin: 0; padding: 0 }`.
    expect(TAILWIND_CSS).toMatch(/@import\s+["']tailwindcss\/utilities\.css["']\s*;/);
  });

  it("declares the layer order explicitly", () => {
    expect(TAILWIND_CSS).toMatch(/@layer\s+theme\s*,\s*base\s*,\s*components\s*,\s*utilities\s*;/);
  });
});

describe("the token bridge", () => {
  // Every bridged colour must dereference the App.css variable rather than
  // restating a hex value. A literal here is how the two systems would drift:
  // the utility and the hand-written rule would render different colours and
  // the theme toggle would only move one of them.
  it("maps colours to var(--…) rather than duplicating literals", () => {
    const theme = TAILWIND_CSS.slice(TAILWIND_CSS.indexOf("@theme"));
    const colours = [...theme.matchAll(/(--color-[a-z0-9-]+)\s*:\s*([^;]+);/g)];

    expect(colours.length).toBeGreaterThan(10);
    for (const [, name, value] of colours) {
      expect(value.trim(), `${name} should reference a token, got "${value.trim()}"`)
        .toMatch(/^var\(--[a-z0-9-]+\)$/);
    }
  });

  it("bridges the stacking scale so Tailwind cannot disagree with App.css", () => {
    // z-index utilities resolve to the same variables zIndexOrder.test.js guards.
    expect(TAILWIND_CSS).toMatch(/--z-index-panel:\s*var\(--z-panel\)/);
    expect(TAILWIND_CSS).toMatch(/--z-index-ornament:\s*var\(--z-ornament\)/);
  });

  it("only bridges tokens that App.css actually defines", () => {
    const theme = TAILWIND_CSS.slice(TAILWIND_CSS.indexOf("@theme"));
    const referenced = [...theme.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
    const missing = [...new Set(referenced)].filter(
      (token) => !new RegExp(`${token}\\s*:`).test(APP_CSS)
    );
    expect(missing, `bridged tokens missing from App.css: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("import order", () => {
  it("loads tailwind.css before App.jsx", () => {
    const tw = MAIN.indexOf("./tailwind.css");
    const app = MAIN.indexOf("./App.jsx");
    expect(tw).toBeGreaterThan(-1);
    expect(app).toBeGreaterThan(-1);
    expect(tw).toBeLessThan(app);
  });

  it("no longer references the deleted index.css", () => {
    expect(MAIN).not.toMatch(/index\.css/);
  });
});

/**
 * The bug this suite did not catch, and now does.
 *
 * Utilities were imported with `layer(utilities)`. Unlayered CSS beats layered
 * CSS regardless of specificity, and styles/base.css opens with
 * `* { margin: 0; padding: 0 }` — so every padding and margin utility silently
 * did nothing. `bg-primary` and `h-9` worked and `px-4` did not, which is
 * invisible until you measure it: shadcn buttons rendered with clipped labels.
 *
 * The invariant is checkable statically: if the hand-written stylesheet has an
 * unlayered global reset touching a property, utilities must be unlayered too,
 * or they cannot win.
 */
describe("utilities can actually beat the global reset", () => {
  const RESET = readStylesheet(join(src, "App.css"));

  const globalResetProperties = () => {
    // The `* { ... }` rule at the top of base.css, if it still exists.
    const match = RESET.match(/[\r\n]\s*\*\s*\{([^}]*)\}/);
    if (!match) return [];
    return [...match[1].matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
  };

  it("still has the global reset this depends on", () => {
    // If someone removes it, this suite should be revisited rather than
    // quietly passing for a new reason.
    expect(globalResetProperties()).toContain("padding");
  });

  it("imports utilities WITHOUT a layer, so they outrank that reset", () => {
    const code = TAILWIND_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const utilities = code.match(/@import\s+"tailwindcss\/utilities\.css"([^;]*);/);

    expect(utilities, "utilities.css is not imported at all").toBeTruthy();
    expect(
      utilities[1].trim(),
      "utilities are layered again — every padding and margin utility will silently stop working"
    ).toBe("");
  });

  it("keeps the theme layered, since nothing competes with custom properties", () => {
    expect(TAILWIND_CODE).toMatch(/@import\s+"tailwindcss\/theme\.css"\s+layer\(theme\)/);
  });
});
