import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postcss from "postcss";

/* THE CASCADE SNAPSHOT CANNOT SEE A STYLESHEET THAT DOES NOT COMPILE.
 *
 * Found the hard way, 2026-08-12: an unterminated comment in decoration.css —
 * a `*` line left below its closing `* /` — made Vite return 500 for App.css
 * and the app mounted to an empty body. The full frontend suite passed, 636
 * green, including the cascade snapshot.
 *
 * It passes because of how the snapshot reads CSS: `readStylesheet` inlines the
 * @imports as TEXT and hands the result to jsdom's CSSOM, which is specified to
 * DROP rules it cannot parse rather than raise. So the broken file arrived as
 * slightly fewer rules, the baseline was regenerated from that, and the diff was
 * clean. Every property the test compares still resolved; the ones that had
 * vanished were not being asked about.
 *
 * That is the "make the evidence earn the claim" failure exactly — a green
 * suite standing in for a working build, where the check could pass while the
 * thing it checks was broken. This is the missing half: parse each stylesheet
 * with the same parser the dev server uses and fail on the error it would have
 * raised. It does not evaluate the cascade; the snapshot already does that.
 */
const here = dirname(fileURLToPath(import.meta.url));
const STYLES = join(here, "..", "styles");
const ENTRY = join(here, "..", "App.css");

const sheets = [
  ENTRY,
  ...readdirSync(STYLES)
    .filter((f) => f.endsWith(".css"))
    .map((f) => join(STYLES, f)),
];

describe("every stylesheet parses", () => {
  it.each(sheets.map((p) => [p.split(/[\\/]/).slice(-1)[0], p]))(
    "%s",
    (_name, path) => {
      const css = readFileSync(path, "utf8");
      expect(() => postcss.parse(css, { from: path })).not.toThrow();
    },
  );

  // A guard on the guard: the list is derived from the directory, so a new
  // stylesheet is covered without anyone remembering to add it — but an empty
  // or mis-resolved directory would make every assertion above vacuous.
  it("covers the whole styles directory and the entry point", () => {
    expect(sheets.length).toBeGreaterThan(10);
    expect(sheets).toContain(ENTRY);
  });
});
