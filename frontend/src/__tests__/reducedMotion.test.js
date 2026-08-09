import { describe, it, expect } from "vitest";
import { readStylesheet } from "../test/cssSnapshot";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Reduced motion must quiet the interface, not blind it.
 *
 * This app has shipped the over-broad version of this once already: progressive
 * text reveal was gated on prefers-reduced-motion, so it was dead on exactly
 * the machines that set the preference, and it was reported as "the messages
 * just pop in". The lesson was that the preference is about MOVEMENT, and that
 * a signal telling the user something is still arriving is not movement.
 *
 * The global rule in utilities.css collapses every animation to 0.01ms with one
 * iteration. Applied without exception it makes a skeleton a grey box, a
 * pending tool row identical to a finished one, and a streaming caret static.
 * These tests pin the exceptions, and pin that they do not smuggle movement
 * back in.
 */

const CSS = readStylesheet(join(dirname(fileURLToPath(import.meta.url)), "..", "App.css"));

/** The single reduced-motion block that carries the exceptions. */
const exceptionBlock = () => {
  const at = CSS.indexOf("THE EXCEPTIONS, AND WHY THERE HAVE TO BE SOME");
  expect(at, "the reduced-motion exception block is gone").toBeGreaterThan(-1);
  const end = CSS.indexOf("@keyframes reducedPulse", at);
  return CSS.slice(at, end);
};

describe("reduced motion", () => {
  it("still collapses animation globally", () => {
    // The exceptions must not have become the rule.
    expect(CSS).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
  });

  it("keeps every loading signal alive", () => {
    const block = exceptionBlock();
    for (const selector of [
      ".skeleton-block",
      ".fact-text-pending",
      ".price-pending",
      ".tool-trail-row.is-pending svg",
      ".bubble.is-streaming::after",
    ]) {
      expect(block, `${selector} lost its reduced-motion exception`).toContain(selector);
    }
    // The shorthand, not four longhands: the !important budget in
    // cssHygiene.test.js is what makes that distinction worth pinning, since
    // the longhand form costs four against it for one idea.
    expect(block).toMatch(/animation:\s*reducedPulse[^;]*infinite\s*!important/);
  });

  it("replaces them with something that does not move", () => {
    // The whole justification for the exception. A pulse that translated,
    // scaled, or swept a gradient would be the thing the preference exists to
    // stop, re-added under a friendlier name.
    const pulse = CSS.slice(CSS.indexOf("@keyframes reducedPulse"));
    const body = pulse.slice(0, pulse.indexOf("}", pulse.indexOf("50%")) + 2);
    expect(body).toContain("opacity");
    expect(body).not.toMatch(/transform|translate|scale|rotate|background-position/);
  });

  it("declares the keyframes outside the media query", () => {
    // A @keyframes inside a media query is still global, but reading as though
    // it were scoped invites someone tidying the block to delete it and break
    // every selector that names it.
    const keyframesAt = CSS.indexOf("@keyframes reducedPulse");
    const blockAt = CSS.indexOf("THE EXCEPTIONS, AND WHY THERE HAVE TO BE SOME");
    expect(keyframesAt).toBeGreaterThan(blockAt);
    // Nothing between the end of the media query and the keyframes should
    // re-open a block: the closing braces have to come first.
    expect(CSS.slice(blockAt, keyframesAt)).toContain("}");
  });

  it("names only animations that actually exist", () => {
    // A selector kept alive by name, pointing at keyframes nobody defines, is a
    // static box that looks intentional.
    for (const name of ["skeletonShimmer", "toolPending", "pricePulse", "caretBlink"]) {
      expect(CSS, `@keyframes ${name} is referenced but not defined`).toContain(`@keyframes ${name}`);
    }
  });
});
