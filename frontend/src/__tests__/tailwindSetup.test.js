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
    expect(TAILWIND_CSS).toMatch(/@import\s+["']tailwindcss\/utilities\.css["']\s+layer\(utilities\)/);
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
    expect(TAILWIND_CSS).toMatch(/--z-index-earring:\s*var\(--z-earring\)/);
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
