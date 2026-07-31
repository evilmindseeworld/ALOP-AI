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

/**
 * The selector four of the cases below mutate, named once.
 *
 * They used to spell `.sidebar-footer` out four separate times, and renaming
 * that rule broke three of them at once — which is the SECOND time this file
 * has been bitten by an anchor: the comments below record an earlier version
 * that anchored on `.sidebar-footer { padding: 12px` and broke when the
 * padding moved onto the spacing scale.
 *
 * A guard that mutates a real stylesheet needs a real selector, so this cannot
 * be avoided entirely — but it can be a one-line repair instead of a hunt.
 *
 * Requirements for whatever this points at:
 *   - it matches an element in test/fixtures/appMarkup.js, or a mutation
 *     changes nothing and every case here passes vacuously;
 *   - it declares a property something else also declares, so the !important
 *     case has a contest to win.
 *
 * `.chat-list` qualifies on both and is structural rather than decorative,
 * which makes it about as rename-proof as this file can get.
 */
const ANCHOR = ".chat-list";

describe("the cascade snapshot notices", () => {
  it("a changed token value, everywhere it is referenced", () => {
    // This used to have to name the Obsidian value rather than the :root one,
    // because obsidian.css redeclared --surface-2 on `.dark` and shadowed the
    // root declaration on every element that rendered. That file is gone and
    // there is exactly one declaration of the token again.
    expect(mutate("--surface-2: #17171f;", "--surface-2: #ff0000;")).not.toBe(BASELINE);
  });

  it("a token that stops being defined", () => {
    expect(mutate("--radius-lg:", "--radius-lg-renamed:")).not.toBe(BASELINE);
  });

  it("a deleted rule", () => {
    expect(mutate(`${ANCHOR} {`, `${ANCHOR}-deleted {`)).not.toBe(BASELINE);
  });

  it("!important winning from an earlier rule, and not winning without it", () => {
    // Both directions in one case, and constructed rather than borrowed from
    // the file. The first version of this test anchored on a real declaration
    // that the cleanup then deleted, so it started passing for the wrong
    // reason. A guard that depends on the thing it guards being unchanged is
    // not a guard.
    const rule = `${ANCHOR} { padding: 99px`;

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

  it("the wrong duplicate @keyframes being deleted", () => {
    // The stylesheet no longer contains a duplicate @keyframes to borrow —
    // floatGentle, typingBounce and emptyFloat were each defined twice, and the
    // UI overhaul removed the second copies along with the design passes that
    // introduced them. So the duplicate is constructed here, for the same
    // reason the !important case below constructs its own: a guard anchored on
    // a defect in the file it guards starts passing the moment that defect is
    // fixed, which is precisely when it stops meaning anything.
    //
    // The property under test is that the LAST definition of a name is the one
    // that renders, so deleting the later duplicate changes the app and
    // deleting the earlier one does not.
    const later = "@keyframes typingBounce { 0%, 80%, 100% { transform: scale(0.9); opacity: 0.9; } 40% { transform: scale(1); opacity: 1; } }";
    const withDuplicate = buildSnapshot(`${CSS}\n${later}`);

    // Appending a second definition renders differently: the later one wins.
    expect(withDuplicate, "a later @keyframes of the same name must win").not.toBe(BASELINE);

    // Delete the EARLIER one and the app is unchanged — the later still wins.
    const earlierDeleted = CSS.replace(/@keyframes typingBounce \{[^}]*\}[^}]*\}/, "");
    expect(earlierDeleted, "fixture drift: typingBounce is no longer declared").not.toBe(CSS);
    expect(buildSnapshot(`${earlierDeleted}\n${later}`)).toBe(withDuplicate);
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
    const split = CSS.replace(`${ANCHOR} {`, `${ANCHOR} { padding: 12px; }\n${ANCHOR} {`);
    expect(split).not.toBe(CSS);
    expect(buildSnapshot(split)).toBe(BASELINE);
  });

  it("but NOT a REDUNDANT !important being added", () => {
    // Force on a declaration nothing contests changes no rendered value.
    //
    // Both sides are appended rather than patched into an existing rule, so
    // the case does not depend on any particular declaration still being in the
    // file — the earlier version anchored on `.sidebar-footer { padding: 12px`
    // and broke the moment that padding moved onto the spacing scale. It now
    // routes through ANCHOR for the same reason.
    const appended = buildSnapshot(`${CSS}\n${ANCHOR} { padding: 12px; }`);
    const forced = buildSnapshot(`${CSS}\n${ANCHOR} { padding: 12px !important; }`);

    // Sanity: the appended rule has to actually win, or this proves nothing.
    expect(appended, "the appended rule should change rendering").not.toBe(BASELINE);
    expect(forced).toBe(appended);
  });

  it("but NOT a comment or whitespace change", () => {
    const reformatted = `/* a new comment */\n\n${CSS.replace(/\n/g, "\n\n")}`;
    expect(buildSnapshot(reformatted)).toBe(BASELINE);
  });
});
