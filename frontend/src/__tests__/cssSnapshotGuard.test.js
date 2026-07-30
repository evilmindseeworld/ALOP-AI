import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildSnapshot, readStylesheet } from "../test/cssSnapshot";

const CSS = readStylesheet(join(dirname(fileURLToPath(import.meta.url)), "..", "App.css"));
const BASELINE = buildSnapshot(CSS);

/**
 * Does the guard actually guard?
 *
 * cssSnapshot.test.js only ever asserts that nothing changed. A harness that
 * has never failed is indistinguishable from one that cannot fail — and the
 * whole !important refactor is trusting it. So each case here mutates the real
 * stylesheet in a way that a careless fold could plausibly produce, and
 * requires the snapshot to notice.
 *
 * The first version of this file found a genuine hole: the initial harness
 * recorded declarations per element without resolving var(), so changing a
 * token's value moved nothing in the output. Every colour in the app is a
 * token. That mutation is case 1 below.
 */
const mutate = (find, replace) => {
  expect(CSS.includes(find), `fixture drift: the stylesheet no longer contains ${JSON.stringify(find)}`).toBe(true);
  return buildSnapshot(CSS.replace(find, replace));
};

describe("the cascade snapshot notices", () => {
  it("a changed token value, everywhere it is referenced", () => {
    // The Obsidian value, not the :root one. `:root`'s --surface-2 turns out to
    // be shadowed on every element that renders, which the harness correctly
    // reports as no change at all — a small piece of dead CSS found for free.
    expect(mutate("--surface-2: #1a1a24;", "--surface-2: #ff0000;")).not.toBe(BASELINE);
  });

  it("a token that stops being defined", () => {
    expect(mutate("--radius-lg:", "--radius-lg-renamed:")).not.toBe(BASELINE);
  });

  it("a deleted rule", () => {
    expect(mutate(".sidebar-footer {", ".sidebar-footer-deleted {")).not.toBe(BASELINE);
  });

  it("!important winning from an earlier rule, and not winning without it", () => {
    // Both directions in one case, and constructed rather than borrowed from
    // the file. The first version of this test anchored on a real declaration
    // that the cleanup then deleted, so it started passing for the wrong
    // reason. A guard that depends on the thing it guards being unchanged is
    // not a guard.
    const rule = ".sidebar-footer { padding: 99px";

    // Prepended, so it loses on source order and can only win by force.
    expect(buildSnapshot(`${rule} !important; }\n${CSS}`)).not.toBe(BASELINE);
    expect(buildSnapshot(`${rule}; }\n${CSS}`)).toBe(BASELINE);
  });

  it("keeps the prefers-reduced-motion overrides forced", () => {
    // Not a mutation — a standing invariant. The audit that drove the bulk
    // removal originally classified these three as redundant, because the
    // resolver did not yet model `animation` shorthand against
    // `animation-duration`. Deleting them ships an app that ignores the user's
    // reduced-motion setting.
    expect(CSS).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(CSS).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(CSS).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });

  it("a changed breakpoint", () => {
    expect(mutate("@media (max-width: 768px)", "@media (max-width: 1024px)")).not.toBe(BASELINE);
  });

  it("a declaration moving to a lower-specificity selector", () => {
    expect(mutate(".app-root.light .panel-overlay", ".panel-overlay")).not.toBe(BASELINE);
  });

  it("a changed z-index token", () => {
    expect(mutate("--z-panel:", "--z-panel-renamed:")).not.toBe(BASELINE);
  });

  it("but NOT a rule being split in place, which is the refactor's own shape", () => {
    // Folding an appended override into the rule it overrides is this operation
    // run backwards. If the snapshot flagged it, it would fail on every correct
    // commit and be switched off inside a day.
    // Two rules where there was one, same selector, same position — so the
    // second still wins and nothing renders differently.
    const split = CSS.replace(".sidebar-footer {", ".sidebar-footer { padding: 12px; }\n.sidebar-footer {");
    expect(split).not.toBe(CSS);
    expect(buildSnapshot(split)).toBe(BASELINE);
  });

  it("but NOT a REDUNDANT !important being added", () => {
    // Force on a declaration nothing contests changes no rendered value. This
    // is stated as an addition rather than a removal because the cleanup left
    // no redundant !important in the file to remove — all 52 survivors decide
    // something.
    const forced = CSS.replace(/(\.sidebar-footer \{\s*padding: 12px);/, "$1 !important;");
    expect(forced).not.toBe(CSS);
    expect(buildSnapshot(forced)).toBe(BASELINE);
  });

  it("but NOT a comment or whitespace change", () => {
    const reformatted = `/* a new comment */\n\n${CSS.replace(/\n/g, "\n\n")}`;
    expect(buildSnapshot(reformatted)).toBe(BASELINE);
  });
});
