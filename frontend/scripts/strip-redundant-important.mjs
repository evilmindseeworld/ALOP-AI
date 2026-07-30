/**
 * Delete every `!important` that decides nothing.
 *
 * An audit of the pre-refactor stylesheet found 159 of 195 were redundant: the
 * rule carrying them was already winning on source order or specificity, and
 * the force changed no rendered value anywhere. Removing them by hand would be
 * 159 judgement calls; removing them mechanically and checking each against the
 * cascade snapshot is one.
 *
 * Each candidate is checked against the ORIGINAL baseline rather than the
 * running result, so removals cannot combine into a change that individually
 * looked safe. Anything that alters the snapshot is kept and reported — those
 * need restructuring rather than deletion.
 *
 *     npm run css:strip-important -- --dry-run
 *
 * One-shot by design: it edits a single stylesheet in place, so run it before
 * App.css is split into src/styles/*.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";

// cssSnapshot walks a DOM. Give it one before importing, since the module
// touches `document` as soon as buildSnapshot runs.
const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>");
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;

const { buildSnapshot, readStylesheet } = await import("../src/test/cssSnapshot.js");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(root, "src", "App.css");
const dryRun = process.argv.includes("--dry-run");

const baseline = buildSnapshot(readStylesheet(ENTRY));
let css = readFileSync(ENTRY, "utf8");

// Back to front: removing text shifts every later index, and iterating in
// reverse keeps the positions found up front valid.
const marks = [...css.matchAll(/[ \t]*!important/g)].map((m) => ({ at: m.index, len: m[0].length })).reverse();

let removed = 0;
const kept = [];

for (const { at, len } of marks) {
  const candidate = css.slice(0, at) + css.slice(at + len);

  if (buildSnapshot(candidate) === baseline) {
    css = candidate;
    removed++;
  } else {
    const lineStart = css.lastIndexOf("\n", at) + 1;
    kept.push(`${css.slice(0, at).split("\n").length}: ${css.slice(lineStart, css.indexOf("\n", at)).trim()}`);
  }
}

console.log(`removed ${removed} redundant !important`);
console.log(`kept ${kept.length} load-bearing:\n${kept.reverse().join("\n")}`);

if (dryRun) console.log("\n--dry-run: App.css not written");
else {
  writeFileSync(ENTRY, css);
  console.log("\nApp.css rewritten. The snapshot test must still be byte-identical.");
}
