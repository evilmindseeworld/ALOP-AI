import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "App.css"),
  "utf8"
);

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
const IMPORTANT_BUDGET = 49;
const DUPLICATE_BUDGET = 63;
const FIX_SECTION_BUDGET = 0;

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
  it(`uses no more than ${IMPORTANT_BUDGET} !important declarations`, () => {
    const count = (CSS.match(/!important/g) || []).length;
    expect(
      count,
      `!important went up to ${count}. Reach for specificity or the cascade instead — ` +
      `if a rule needs !important, something above it is probably a duplicate.`
    ).toBeLessThanOrEqual(IMPORTANT_BUDGET);
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
