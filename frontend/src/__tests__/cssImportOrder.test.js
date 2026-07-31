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
 * It used to end with two whole-app design passes — `skeuomorphism` and
 * `obsidian` — that existed purely to override the files above them, which is
 * how the token file ended up dead in the shipping theme. They are gone: every
 * file below owns its component outright, and only two ordering constraints
 * remain, both asserted separately below.
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
  "markdown",       // answer prose; scoped to .markdown-body
  "composer",
  "palette",
  "chat-controls",
  "panels",
  "overlay",
  "decoration",
  "code-blocks",
  "utilities",      // media queries, which must beat the component defaults
];

describe("stylesheet manifest", () => {
  it("imports every style file, in the documented order", () => {
    expect(imported).toEqual(EXPECTED);
  });

  it("imports every file that exists in src/styles, and no file that does not", () => {
    // ui-reset.css is deliberately excluded: it belongs to the Tailwind layer
    // stack, not to this cascade. tailwind.css imports it into layer(base) so
    // that unlayered App.css still outranks it — see uiResetScope.test.js.
    const NOT_IN_MANIFEST = new Set(["ui-reset"]);

    const onDisk = readdirSync(STYLES)
      .filter((f) => f.endsWith(".css"))
      .map((f) => f.replace(/\.css$/, ""))
      .filter((f) => !NOT_IN_MANIFEST.has(f))
      .sort();
    expect(onDisk).toEqual([...EXPECTED].sort());
  });

  it("keeps ui-reset.css out of the App.css cascade", () => {
    // Importing it here instead would make it unlayered, and it would then beat
    // the component styles it is meant to sit beneath.
    expect(MANIFEST).not.toContain("ui-reset");
  });

  it("keeps tokens first and utilities last", () => {
    // Stated separately from the full list so the failure names the invariant
    // rather than dumping a fourteen-item array diff. These are the only two
    // ordering constraints left: everything between them is independent.
    expect(imported[0], "tokens must come first — every file dereferences it").toBe("tokens");
    expect(
      imported.at(-1),
      "utilities must come last: its media queries beat component defaults on " +
      "source order, and moving it earlier would need !important to work"
    ).toBe("utilities");
  });

  it("no longer imports a whole-app design pass", () => {
    // The two passes were the mechanism by which a rule's real value could not
    // be known from the file that declared it. If one comes back, the manifest
    // is the place it will show up first.
    expect(imported).not.toContain("skeuomorphism");
    expect(imported).not.toContain("obsidian");
  });

  it("contains nothing but imports and comments", () => {
    // The whole point of the split is that there is no bottom of App.css to
    // append a rule to. A rule here would recreate it.
    const withoutComments = MANIFEST.replace(/\/\*[\s\S]*?\*\//g, "");
    const stray = withoutComments.replace(/@import\s+"[^"]+"\s*;/g, "").trim();
    expect(stray, `App.css should hold only imports, found: ${stray.slice(0, 200)}`).toBe("");
  });
});
