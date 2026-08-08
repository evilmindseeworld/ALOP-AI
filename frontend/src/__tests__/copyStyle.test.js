import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * House copy rules, enforced rather than remembered.
 *
 * The em dash is the one asked for by name: it had reached tooltips, the price
 * rows, the crash screen's reference line and the sign-in tagline. Removing
 * them once is a commit; keeping them out is a test, because the next person
 * writing a tooltip will reach for one and nothing will stop them.
 *
 * SCOPE IS DELIBERATELY NARROW — JSX TEXT NODES ONLY.
 *
 * Comments are exempt: prose explaining code is not interface copy, and this
 * codebase's comments are long and deliberately punctuated. String literals are
 * exempt too, because they are as often a regex, a URL or a class name as they
 * are a sentence. What is checked is the text a component actually renders
 * between tags, which is where user-visible copy lives.
 *
 * The first version of this checked the whole file and failed on the comment
 * explaining the rule — a test that reads documentation about code rather than
 * the code. Hence the stripping below.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every .jsx under src/, minus the gallery, which is a dev-only page. */
function componentFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "__snapshots__" || name === "test") continue;
      componentFiles(full, out);
    } else if (name.endsWith(".jsx") && name !== "gallery.jsx") {
      out.push(full);
    }
  }
  return out;
}

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** JSX text nodes: what sits between a `>` and the next `<`, minus expressions. */
function jsxText(src) {
  const out = [];
  for (const m of stripComments(src).matchAll(/>([^<>{}]+)</g)) {
    const text = m[1].trim();
    if (text && /[A-Za-z]/.test(text)) out.push(text);
  }
  return out;
}

describe("interface copy", () => {
  const files = componentFiles(SRC);

  it("finds components to check", () => {
    // A traversal bug that returns nothing would make every test below pass.
    expect(files.length).toBeGreaterThan(10);
  });

  it("uses no em dashes in rendered text", () => {
    const offenders = [];
    for (const file of files) {
      for (const text of jsxText(readFileSync(file, "utf8"))) {
        if (text.includes("—")) offenders.push(`${file.split(/[\\/]/).pop()}: ${text.slice(0, 60)}`);
      }
    }
    expect(
      offenders,
      "em dashes in interface copy — use a comma, a colon, or two sentences:\n" + offenders.join("\n")
    ).toEqual([]);
  });

  it("uses no ellipsis character where three dots are meant", () => {
    // Not asked for, but the same class of thing: "…" and "..." both appear in
    // this codebase and they should not both. The dots win because the loading
    // strings already use them.
    const offenders = [];
    for (const file of files) {
      for (const text of jsxText(readFileSync(file, "utf8"))) {
        // The starter hints use a leading "…" on purpose, as a continuation
        // marker rather than as punctuation in a sentence.
        if (text.includes("…") && !text.startsWith("…")) {
          offenders.push(`${file.split(/[\\/]/).pop()}: ${text.slice(0, 60)}`);
        }
      }
    }
    expect(offenders, "mixed ellipsis styles:\n" + offenders.join("\n")).toEqual([]);
  });
});
