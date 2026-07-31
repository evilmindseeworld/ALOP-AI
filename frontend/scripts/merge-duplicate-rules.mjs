/**
 * Merge top-level rules that share a selector list into one.
 *
 * App.css declares `.markdown-body code` three times, `.app-header` three
 * times, `.bubble` three times — the append-only habit again. The merged rule
 * takes the LAST block's position, because that is where the winning values
 * already live, and the last value for each property, because that is the one
 * that currently renders.
 *
 * Merging is NOT unconditionally safe. `.app-root *` near the end of the file
 * sets a transition on every element in the app at the same specificity as
 * every component's own rule, so consolidating a duplicate to a position after
 * it flips which one wins. Rather than model that, each group is merged
 * speculatively and kept only if the cascade snapshot is unchanged.
 *
 *     node scripts/merge-duplicate-rules.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>");
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;

const { parseStylesheet } = await import("../src/test/cssCascade.js");
const { buildSnapshot, readStylesheet } = await import("../src/test/cssSnapshot.js");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(root, "src", "App.css");
const dryRun = process.argv.includes("--dry-run");

const before = buildSnapshot(readStylesheet(ENTRY));
let css = readFileSync(ENTRY, "utf8");

/** Duplicate selector-list groups in the CURRENT text, freshly parsed. */
const findGroups = (source) => {
  const blocks = new Map();
  for (const rule of parseStylesheet(source)) {
    if (rule.depth !== 0) continue;
    const key = `${rule.start}:${rule.end}`;
    if (!blocks.has(key)) {
      blocks.set(key, { start: rule.start, end: rule.end, selectors: [], declarations: rule.declarations });
    }
    blocks.get(key).selectors.push(rule.selector);
  }

  const groups = new Map();
  for (const block of blocks.values()) {
    // Order within a selector list matters to nobody: `.a, .b` is `.b, .a`.
    const key = [...block.selectors].sort().join(", ");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(block);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, blocks: group.sort((a, b) => a.start - b.start) }));
};

const mergedText = (group) => {
  const declarations = new Map();
  for (const block of group.blocks) {
    for (const [prop, decl] of block.declarations) {
      // Synthetic longhands from shorthand expansion are not real source text.
      if (decl.value.startsWith("<")) continue;
      declarations.set(prop, decl);
    }
  }
  const body = [...declarations]
    .map(([prop, d]) => `  ${prop}: ${d.value}${d.important ? " !important" : ""};`)
    .join("\n");
  return `${group.blocks[0].selectors.join(",\n")} {\n${body}\n}`;
};

const applyMerge = (source, group) => {
  const last = group.blocks[group.blocks.length - 1];
  const edits = [
    { start: last.start, end: last.end, text: mergedText(group) },
    ...group.blocks.slice(0, -1).map((b) => ({ start: b.start, end: b.end, text: "" })),
  ].sort((a, b) => b.start - a.start);

  let out = source;
  for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
};

// Re-parse after every accepted merge.
//
// The first version of this script computed all offsets once and applied the
// accepted merges in sequence. Groups interleave — one group's blocks can sit
// both before and after another's — so an applied edit shifted offsets that a
// later edit still trusted, and the file was cut mid-rule. It produced a
// stylesheet Tailwind rejected with "Missing closing }".
const applied = [];
const rejected = new Set();

for (let pass = 0; pass < 50; pass++) {
  const group = findGroups(css).find((g) => !rejected.has(g.key));
  if (!group) break;

  const next = applyMerge(css, group);
  if (buildSnapshot(next) === before) {
    css = next;
    applied.push({ key: group.key, count: group.blocks.length });
  } else {
    rejected.add(group.key);
  }
}

const after = buildSnapshot(css);
const removed = applied.reduce((n, m) => n + m.count - 1, 0);

console.log(`merged ${applied.length} duplicated selectors, removing ${removed} blocks:`);
for (const m of applied.sort((a, b) => b.count - a.count)) console.log(`  ${m.count}x  ${m.key}`);

if (rejected.size) {
  console.log(`\nleft alone — merging these WOULD change rendering:`);
  for (const key of rejected) console.log(`  ${key}`);
}

console.log(`\nrendered output unchanged: ${after === before}`);

if (after !== before) {
  console.error("App.css NOT written.");
  process.exitCode = 1;
} else if (dryRun) {
  console.log("--dry-run: App.css not written");
} else {
  writeFileSync(ENTRY, css);
  console.log("App.css rewritten.");
}
