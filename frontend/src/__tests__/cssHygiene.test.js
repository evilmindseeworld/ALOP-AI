import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readStylesheet } from "../test/cssSnapshot";

// App.css is an import manifest now, so read it with its imports inlined —
// in manifest order, which is the cascade.
const CSS = readStylesheet(join(dirname(fileURLToPath(import.meta.url)), "..", "App.css"));

// Declarations, not prose. A comment explaining why a rule once needed
// !important contains the word, and counting it would push the budget up for
// documenting the very thing the budget exists to discourage.
const DECLARATIONS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * App.css grew append-only: every fix was pasted at the bottom rather than
 * edited in place, then given !important when the duplicate above it didn't
 * appear to win. That produced sections literally named "FIX: header buttons
 * horizontal" and "FIX: HEADER HORIZONTAL" — the same fix, twice — and
 * .header-actions defined three times with every declaration !important.
 *
 * These are ratchets. They do not demand the file be clean today; they demand
 * it not get worse, and they fail loudly if the old habit returns.
 */

// These are ratchets: set to what the file is today, lowered by every commit
// that improves it, never raised. They were committed at 193/5 against an older
// revision of App.css and were already failing at 195/7 when this work started.
//
// The floor for IMPORTANT_BUDGET is 3, not 0. The prefers-reduced-motion block
// keeps its !important because overriding an author's animation for a user with
// a vestibular disorder is the one thing the keyword is actually for.
const IMPORTANT_BUDGET = 3;
// Restyling Clerk's shipped components. Tracked separately — see the test.
const CLERK_IMPORTANT_BUDGET = 52;
const DUPLICATE_BUDGET = 14;
const FIX_SECTION_BUDGET = 0;

/**
 * Drop every rule whose selector mentions a Clerk class.
 *
 * Selector-based, not file-based: a `.cl-*` override could be written anywhere,
 * and a rule of ours could sit in signin.css. What matters is what a
 * declaration is fighting, not which file it lives in.
 */
const withoutClerkRules = (css) => css.replace(/[^{}]*\.cl-[^{}]*\{[^}]*\}/g, "");

/** Rule blocks at top level, with at-rule context tracked by brace depth. */
const topLevelBlocks = () => {
  const out = [];
  let i = 0;
  let depth = 0; // how many at-rules we are nested inside

  while (i < CSS.length) {
    if (CSS.startsWith("/*", i)) {
      const e = CSS.indexOf("*/", i);
      if (e === -1) break;
      i = e + 2;
      continue;
    }
    const brace = CSS.indexOf("{", i);
    const close = CSS.indexOf("}", i);

    if (close !== -1 && (brace === -1 || close < brace)) {
      if (depth > 0) depth--;
      i = close + 1;
      continue;
    }
    if (brace === -1) break;

    const prelude = CSS.slice(i, brace).trim().replace(/\s+/g, " ");
    if (prelude.startsWith("@") && !prelude.startsWith("@import")) {
      depth++;
      i = brace + 1;
      continue;
    }

    const end = CSS.indexOf("}", brace);
    if (end === -1) break;
    if (depth === 0) {
      for (const sel of prelude.split(",").map((s) => s.trim()).filter(Boolean)) {
        out.push(sel);
      }
    }
    i = end + 1;
  }
  return out;
};

describe("App.css hygiene", () => {
  it(`uses no more than ${IMPORTANT_BUDGET} !important declarations OUTSIDE the Clerk overrides`, () => {
    // Rules targeting .cl-* are excluded, and the distinction is the whole
    // point of the budget rather than a hole in it.
    //
    // This budget exists because App.css grew append-only and !important was
    // how each new paste beat the duplicate above it. Every one of those was a
    // fight with OUR OWN stylesheet, and every one was winnable by deleting the
    // duplicate instead.
    //
    // The Clerk overrides are a different thing: Clerk ships its own CSS at a
    // specificity we do not control and cannot reliably out-specify, and
    // !important is the documented way to restyle it. Counting those against
    // the same budget would either force the number up — making it stop
    // meaning anything — or block the sign-in page from ever joining the
    // manifest, which is what left it unguarded for months in the first place.
    //
    // They are counted separately below, so the number is still visible and
    // still cannot grow unnoticed.
    const ours = withoutClerkRules(DECLARATIONS);
    const count = (ours.match(/!important/g) || []).length;
    expect(
      count,
      `!important went up to ${count} outside the Clerk overrides. Reach for specificity ` +
      `or the cascade instead — if a rule needs !important, something above it is ` +
      `probably a duplicate.`
    ).toBeLessThanOrEqual(IMPORTANT_BUDGET);
  });

  it(`uses no more than ${CLERK_IMPORTANT_BUDGET} !important declarations inside the Clerk overrides`, () => {
    // A ratchet like the others: it records what restyling Clerk currently
    // costs, and fails if that cost grows quietly. If Clerk ever ships a real
    // theming API, this number should fall to zero.
    const clerkOnly = DECLARATIONS.length - withoutClerkRules(DECLARATIONS).length;
    expect(clerkOnly).toBeGreaterThan(0); // guard on the guard: the matcher still matches
    const count = ((DECLARATIONS.match(/!important/g) || []).length)
      - ((withoutClerkRules(DECLARATIONS).match(/!important/g) || []).length);
    expect(
      count,
      `Clerk overrides now use ${count} !important declarations, up from ${CLERK_IMPORTANT_BUDGET}.`
    ).toBeLessThanOrEqual(CLERK_IMPORTANT_BUDGET);
  });

  it(`defines no more than ${DUPLICATE_BUDGET} redundant top-level selector blocks`, () => {
    const seen = new Map();
    for (const sel of topLevelBlocks()) seen.set(sel, (seen.get(sel) || 0) + 1);
    const redundant = [...seen.values()].reduce((n, c) => n + (c - 1), 0);

    const worst = [...seen.entries()]
      .filter(([, c]) => c > 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([s, c]) => `${s} x${c}`)
      .join(", ");

    expect(
      redundant,
      `redundant top-level blocks rose to ${redundant}. Edit the existing rule ` +
      `instead of appending another copy. Worst offenders: ${worst}`
    ).toBeLessThanOrEqual(DUPLICATE_BUDGET);
  });

  // The append-only habit is self-documenting: it leaves sections named "FIX:".
  it(`does not accumulate more than ${FIX_SECTION_BUDGET} 'FIX:' sections`, () => {
    const fixes = CSS.match(/\/\*\s*=+\s*FIX:/gi) || [];
    expect(
      fixes.length,
      `${fixes.length} "FIX:" sections. A fix belongs in the section that owns ` +
      `the selector, not appended at the bottom of the file.`
    ).toBeLessThanOrEqual(FIX_SECTION_BUDGET);
  });

  it("keeps every z-index on the token scale", () => {
    // Duplicated from zIndexOrder.test.js on purpose: that suite guards the
    // ordering, this one guards the file's hygiene, and both should fail if a
    // bare number reappears.
    const body = CSS.slice(CSS.indexOf("--shadow-xs"));
    const bare = [...body.matchAll(/z-index:\s*(-?\d+)\s*;/g)].map((m) => m[1]);
    expect(bare, `bare z-index values: ${bare.join(", ")}`).toEqual([]);
  });
});
