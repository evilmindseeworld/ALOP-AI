import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const STYLES = join(dirname(fileURLToPath(import.meta.url)), "..", "styles");
const FILES = readdirSync(STYLES).filter((f) => f.endsWith(".css"));

/**
 * WCAG 2.1 SC 1.4.10 Reflow: content must be usable at a 320px viewport
 * without horizontal scrolling.
 *
 * WHAT THIS CAN AND CANNOT PROVE. It cannot lay anything out — there is no
 * browser here. What it can do is catch the two declarations that make reflow
 * impossible no matter what the rest of the stylesheet says: a `min-width`
 * larger than the viewport, and a fixed `width` in px on something that has
 * to fit inside it. Everything else (a long unbreakable string, a table, a
 * flex row that will not wrap) still needs a real 320px window — see the
 * manual checklist in AGENTS.md.
 *
 * The current sheets pass with no exemptions, which is the point of adding it
 * now rather than after the first violation.
 */
const VIEWPORT = 320;

const rules = FILES.flatMap((file) => {
  const css = readFileSync(join(STYLES, file), "utf8")
    // Comments hold example values and measurements; they are not declarations.
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
    file,
    selector: m[1].trim().split("\n").pop().trim(),
    body: m[2],
  }));
});

describe("320px reflow", () => {
  it("declares no min-width wider than the viewport", () => {
    const offenders = rules.flatMap(({ file, selector, body }) => {
      const m = body.match(/min-width:\s*(\d+)px/);
      return m && Number(m[1]) > VIEWPORT ? [`${file} ${selector}: min-width ${m[1]}px`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it("pins no element to a fixed px width wider than the viewport", () => {
    const offenders = rules.flatMap(({ file, selector, body }) => {
      // `max-width` is fine — that is the correct way to cap a measure. Only a
      // bare `width` forces a box to stay wide.
      const m = body.match(/(?:^|[;\s])width:\s*(\d+)px/);
      return m && Number(m[1]) > VIEWPORT ? [`${file} ${selector}: width ${m[1]}px`] : [];
    });
    expect(offenders).toEqual([]);
  });
});
