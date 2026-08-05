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
  // @font-face for the self-hosted Inter. First so the family is defined
  // before tokens.css names it, and because a reader chasing --font-body
  // should meet the declaration before the reference.
  "fonts",
  "tokens",         // dereferenced by everything below
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
  // Next to overlay because both style a surface that renders OUTSIDE
  // .app-root. It was imported directly by SignInPage.jsx until now, which put
  // it outside the cascade snapshot, outside cssHygiene and outside
  // zIndexOrder — and that is why it drifted, still carrying a wood-grain
  // palette months after the app deleted one.
  "signin",
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

  it("keeps tokens first among cascading files, and utilities last", () => {
    // Stated separately from the full list so the failure names the invariant
    // rather than dumping a fifteen-item array diff. These are the only two
    // ordering constraints left: everything between them is independent.
    //
    // fonts.css sits above tokens and is exempt: it contains @font-face and
    // nothing else, so it declares no property that could win or lose a
    // cascade. The constraint that matters is that tokens precedes every file
    // that dereferences it, which is every file that declares anything.
    expect(imported[0], "fonts must come first — it only defines @font-face").toBe("fonts");
    expect(
      imported.filter((n) => n !== "fonts")[0],
      "tokens must come first among cascading files — every file dereferences it"
    ).toBe("tokens");
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

  /**
   * FRONTEND.md §2 prints this same order, and it is the first thing anyone
   * touching the frontend reads. It sat wrong for five commits: it still listed
   * `skeuomorphism` and `obsidian`, deleted in 680679a, and still claimed
   * fifteen files in a manifest that holds fourteen. Nobody noticed because
   * nothing compared the two — the doc described itself as "the real handoff"
   * while naming two stylesheets that did not exist.
   *
   * Documentation that no test reads is a comment on a different file. This
   * parses the fenced block out of §2 and asserts it against App.css, so the
   * next person to add a stylesheet cannot land it doc-less.
   */
  it("matches the order printed in docs/FRONTEND.md §2", () => {
    // Normalised: this file is edited on Windows and git may hand back CRLF,
    // which silently breaks every anchored match below.
    const doc = readFileSync(join(here, "..", "..", "..", "docs", "FRONTEND.md"), "utf8").replace(/\r\n/g, "\n");
    const section = doc.split(/^## /m).find((s) => s.startsWith("2."));
    expect(section, "FRONTEND.md has no section 2").toBeTruthy();

    const fence = section.match(/```\n([\s\S]*?)```/);
    expect(fence, "FRONTEND.md §2 no longer prints the manifest in a fenced block").toBeTruthy();

    const documented = fence[1]
      .split(/[\n→]/)
      .map((s) => s.trim())
      .filter(Boolean);

    expect(
      documented,
      "docs/FRONTEND.md §2 disagrees with src/App.css. Update the doc in the " +
      "same commit as the manifest — that is the whole point of this test."
    ).toEqual(EXPECTED);
  });

  it("contains nothing but imports and comments", () => {
    // The whole point of the split is that there is no bottom of App.css to
    // append a rule to. A rule here would recreate it.
    const withoutComments = MANIFEST.replace(/\/\*[\s\S]*?\*\//g, "");
    const stray = withoutComments.replace(/@import\s+"[^"]+"\s*;/g, "").trim();
    expect(stray, `App.css should hold only imports, found: ${stray.slice(0, 200)}`).toBe("");
  });
});
