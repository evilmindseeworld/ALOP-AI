import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const MANIFEST = readFileSync(join(here, "..", "App.css"), "utf8");
const STYLES = join(here, "..", "styles");

const imported = [...MANIFEST.matchAll(/@import\s+"\.\/styles\/([\w-]+)\.css"/g)].map((m) => m[1]);

/**
 * App.css is an import manifest, and THE ORDER OF THOSE IMPORTS IS THE CASCADE.
 *
 * Two of the files exist specifically to override what comes before them:
 * `skeuomorphism` is a pass giving every surface physical depth, and `obsidian`
 * is a later pass laying a darker palette over it. Both win by being imported
 * late. Reorder the manifest and the app renders differently — silently, and
 * everywhere at once.
 *
 * This test is the record of the intended order, in the same spirit as
 * zIndexOrder.test.js. If you add a file, add it here and say where it goes.
 */
const EXPECTED = [
  "tokens",         // must be first: everything below dereferences these
  "base",
  "layout",
  "sidebar",
  "chat",
  "composer",
  "palette",
  "chat-controls",
  "panels",
  "overlay",
  "utilities",      // media queries, which must beat the component defaults
  "skeuomorphism",  // design pass 1 — overrides components above
  "obsidian",       // design pass 2 — overrides skeuomorphism
  "decoration",
  "code-blocks",
];

describe("stylesheet manifest", () => {
  it("imports every style file, in the documented order", () => {
    expect(imported).toEqual(EXPECTED);
  });

  it("imports every file that exists in src/styles, and no file that does not", () => {
    const onDisk = readdirSync(STYLES)
      .filter((f) => f.endsWith(".css"))
      .map((f) => f.replace(/\.css$/, ""))
      .sort();
    expect(onDisk).toEqual([...EXPECTED].sort());
  });

  it("keeps tokens first and the two design passes in order", () => {
    // Stated separately from the full list so the failure names the invariant
    // rather than dumping a fifteen-item array diff.
    expect(imported[0]).toBe("tokens");
    expect(imported.indexOf("skeuomorphism")).toBeGreaterThan(imported.indexOf("layout"));
    expect(imported.indexOf("obsidian")).toBeGreaterThan(imported.indexOf("skeuomorphism"));
  });

  it("contains nothing but imports and comments", () => {
    // The whole point of the split is that there is no bottom of App.css to
    // append a rule to. A rule here would recreate it.
    const withoutComments = MANIFEST.replace(/\/\*[\s\S]*?\*\//g, "");
    const stray = withoutComments.replace(/@import\s+"[^"]+"\s*;/g, "").trim();
    expect(stray, `App.css should hold only imports, found: ${stray.slice(0, 200)}`).toBe("");
  });
});
