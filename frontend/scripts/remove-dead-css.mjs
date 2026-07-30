/**
 * Delete rules that match nothing the app renders, and keyframes nothing uses.
 *
 * The cascade snapshot already reports both, because it walks a fixture built
 * from the real component markup. This acts on that report.
 *
 * A rule is removed only when EVERY selector in its prelude is unmatched, so
 * `.a, .b { }` survives if `.b` is live. Verification is narrower than the
 * usual byte-identical check: removing dead rules necessarily shrinks the
 * snapshot's own inventory sections, so this asserts that the ELEMENT portion —
 * every rendered declaration on every element — is unchanged.
 *
 *     node scripts/remove-dead-css.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>");
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;

const { buildSnapshot, readStylesheet } = await import("../src/test/cssSnapshot.js");
const { APP_MARKUP } = await import("../src/test/fixtures/appMarkup.js");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(root, "src", "App.css");
const dryRun = process.argv.includes("--dry-run");

/** Everything before the inventory sections: the part that must not change. */
const rendered = (snapshot) => snapshot.slice(0, snapshot.indexOf("=== keyframes"));

const before = rendered(buildSnapshot(readStylesheet(ENTRY)));

let css = readFileSync(ENTRY, "utf8");

// Which selectors match nothing? Ask a live DOM rather than trusting a list.
document.body.innerHTML = APP_MARKUP;
// Reuse the harness's selector analysis rather than hand-rolling a second one.
// The hand-rolled version had an alternation-order bug — `:focus` matched
// before `:focus-visible`, leaving `a-visible` — and declared every
// focus-visible rule dead. analyzeSelector reads identifiers properly.
const { analyzeSelector } = await import("../src/test/cssCascade.js");

const isLive = (selector) => {
  const probe = analyzeSelector(selector).matchSelector;
  if (probe === "*") return true; // a bare pseudo-element applies everywhere
  try {
    return document.querySelector(probe) !== null || document.documentElement.matches(probe);
  } catch {
    return true; // unparseable: keep it rather than guess
  }
};

// Group the parsed rules by source block: a selector list produces one rule per
// selector, all sharing the same offsets. Only top-level blocks (depth 0) are
// candidates — a rule inside @media is scoped, and one inside @keyframes is a
// step, not a rule at all.
const { parseStylesheet } = await import("../src/test/cssCascade.js");

const byBlock = new Map();
for (const rule of parseStylesheet(css)) {
  if (rule.depth !== 0) continue;
  const key = `${rule.start}:${rule.end}`;
  if (!byBlock.has(key)) byBlock.set(key, { start: rule.start, end: rule.end, selectors: [] });
  byBlock.get(key).selectors.push(rule.selector);
}

// Back to front, so removing one block does not shift the offsets of the rest.
const removedSelectors = [];
for (const block of [...byBlock.values()].sort((a, b) => b.start - a.start)) {
  if (block.selectors.some(isLive)) continue;
  removedSelectors.push(...block.selectors);
  css = css.slice(0, block.start) + css.slice(block.end);
}

// Keyframes nothing animates.
const used = new Set([...css.matchAll(/animation(?:-name)?:\s*([^;}]+)/g)].flatMap((a) => a[1].split(/[\s,]+/)));
const removedKeyframes = [];
for (const k of [...css.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)\s*\{/g)].reverse()) {
  if (used.has(k[1])) continue;
  let depth = 0;
  let i = k.index + k[0].length - 1;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) break;
  }
  removedKeyframes.push(k[1]);
  css = css.slice(0, k.index) + css.slice(i + 1);
}

// Verified in memory, before anything touches the disk.
const after = rendered(buildSnapshot(css));

console.log(`removed ${removedSelectors.length} dead rules:\n  ${removedSelectors.sort().join("\n  ")}`);
console.log(`\nremoved ${removedKeyframes.length} unused keyframes: ${removedKeyframes.join(", ")}`);
console.log(`\nrendered output unchanged: ${before === after}`);

if (before !== after) {
  const a = before.split("\n");
  const b = after.split("\n");
  const at = a.findIndex((line, i) => line !== b[i]);
  console.error(`\nFIRST DIFFERENCE at line ${at + 1}:\n  was: ${a[at]}\n  now: ${b[at]}`);
  console.error("App.css NOT written — a rule that renders something was about to be deleted.");
  process.exitCode = 1;
} else if (dryRun) {
  console.log("--dry-run: App.css not written");
} else {
  writeFileSync(ENTRY, css);
  console.log("App.css rewritten.");
}
