/**
 * Split App.css into src/styles/*.css.
 *
 * This is the structural half of the cleanup. Every problem the other commits
 * fixed — 195 !important, seven "FIX:" sections, the same rule written three
 * times — came from one property of the file: it had a bottom. Appending to a
 * 3,000-line stylesheet is easier than finding the rule that already exists,
 * and the cascade rewards it, so that is what happened for two years.
 *
 * Ten files with names that say where a rule belongs removes the bottom. The
 * order of the imports IS the cascade, so it is asserted by test.
 *
 * Sections are moved verbatim, in order, so the concatenation is byte-identical
 * to the original and the cascade cannot move.
 *
 *     node scripts/split-stylesheet.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>");
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;

const { buildSnapshot, readStylesheet } = await import("../src/test/cssSnapshot.js");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(root, "src", "App.css");
const STYLES = join(root, "src", "styles");
const dryRun = process.argv.includes("--dry-run");

const before = buildSnapshot(readStylesheet(ENTRY));
const css = readFileSync(ENTRY, "utf8");

/**
 * Which file each section header goes to, in source order.
 *
 * The two late design passes keep their own files rather than being
 * distributed into the component files. They are coherent passes over the
 * whole app — physical surfaces, then a darker palette — and each one's rules
 * only make sense read together. Splitting them across ten files would lose
 * that and invite exactly the duplication this is meant to end.
 */
const ROUTING = [
  ["FONTS", "tokens"],
  ["DESIGN TOKENS", "tokens"],
  ["LIGHT MODE", "tokens"],
  ["RESET & BASE", "base"],
  ["SCROLLBARS", "base"],
  ["TEXT SHIMMER", "base"],
  ["HEADER", "layout"],
  ["MAGNETIC ICON BUTTONS", "layout"],
  ["APP BODY", "layout"],
  ["SIDEBAR", "sidebar"],
  ["CHAT LIST", "sidebar"],
  ["CHAT MAIN", "chat"],
  ["EMPTY STATE", "chat"],
  ["MESSAGES", "chat"],
  ["INPUT BAR", "composer"],
  ["COMMAND PALETTE", "palette"],
  ["EMPTY-STATE STARTERS", "chat-controls"],
  ["STOP / SCROLL / CHAT TOOLBAR", "chat-controls"],
  ["UPGRADE / PRICING", "panels"],
  ["PANELS", "panels"],
  ["ADMIN", "panels"],
  ["CAMERA", "panels"],
  ["OVERLAY ASSISTANT", "overlay"],
  ["UTILITIES", "utilities"],
  ["RESPONSIVE", "utilities"],
  ["SKEUOMORPHISM", "skeuomorphism"],
  ["DARK MODE REWORK", "obsidian"],
  ["LUXURY POLISH", "obsidian"],
  ["3D LUXURY EARRINGS", "decoration"],
  ["SKELETON SHIMMER", "decoration"],
  ["INITIAL BRANDED LOADER", "decoration"],
  ["PREMIUM CODE BLOCKS", "code-blocks"],
];

/**
 * The manifest order is DERIVED from source order, never declared separately.
 *
 * The first attempt listed the files by hand and routed sections into whichever
 * one fit thematically. That reordered them: "PREMIUM CODE BLOCKS" sits at the
 * end of the file but reads as chat styling, so it moved 2,000 lines earlier
 * and `.app-root *` stopped losing to it. Files must be CONTIGUOUS runs of the
 * original section order, or the cascade moves.
 */
const ORDER = [...new Set(ROUTING.map(([, file]) => file))];

const HEADERS = [...css.matchAll(/^\/\* =====.*$/gm)].map((m) => ({ index: m.index, text: m[0] }));

const routeFor = (headerText) => {
  const hit = ROUTING.find(([name]) => headerText.includes(name));
  if (!hit) throw new Error(`no route for section header: ${headerText}`);
  return hit[1];
};

// Slice the file at section headers. Anything before the first header (nothing,
// as it happens) stays at the top of tokens.
const chunks = new Map(ORDER.map((f) => [f, []]));
for (let i = 0; i < HEADERS.length; i++) {
  const start = HEADERS[i].index;
  const end = i + 1 < HEADERS.length ? HEADERS[i + 1].index : css.length;
  chunks.get(routeFor(HEADERS[i].text)).push(css.slice(start, end));
}

const DESCRIPTIONS = {
  tokens: "Design tokens: both themes, the stacking scale, shadows, easings.\n * Imported first because everything below dereferences these.",
  base: "Reset, scrollbars, and the shimmer used by headings.",
  layout: "The app shell: header, icon buttons, and the body split.",
  sidebar: "Sidebar chrome and the chat list.",
  chat: "The transcript: chat surface, empty state, and messages.",
  composer: "The input bar and the controls attached to it.",
  palette: "Ctrl+K command palette.",
  panels: "Slide-in panels: settings, admin, upgrade, camera.",
  overlay: "The always-on-top overlay assistant, which renders outside .app-root.",
  "chat-controls":
    "Empty-state starters, the stop button, jump-to-latest, and the\n * regenerate/export toolbar.",
  "code-blocks": "Syntax-highlighted code blocks inside messages.",
  utilities: "Display helpers and every media query.",
  skeuomorphism:
    "A pass over the whole app giving surfaces physical depth — raised\n * headers, recessed inputs, pressed buttons. Kept together because the\n * rules only make sense read as one pass.",
  obsidian:
    "The second design pass: a darker, cooler palette layered over the\n * skeuomorphic surfaces. Also kept whole, for the same reason.\n *\n * Imported after skeuomorphism, which is what makes it win.",
  decoration: "Ornament and loading states: earrings, skeletons, the splash loader.",
};

const written = [];
for (const file of ORDER) {
  const body = chunks.get(file).join("").trimEnd();
  if (!body) continue;
  written.push({ file, lines: body.split("\n").length });
  if (!dryRun) {
    mkdirSync(STYLES, { recursive: true });
    writeFileSync(join(STYLES, `${file}.css`), `/* ${DESCRIPTIONS[file]} */\n\n${body}\n`);
  }
}

const manifest = `/* ALOP-AI stylesheet — an import manifest, not a stylesheet.
 *
 * THE ORDER OF THESE IMPORTS IS THE CASCADE. Two files deliberately override
 * what comes before them, so moving a line here changes what renders.
 * cssImportOrder.test.js asserts this list; it is the spec, not a formality.
 *
 * Rules live in the file named for the thing they style. This file exists so
 * that there is no longer a bottom of App.css to append to — which is where
 * 195 !important declarations, seven "FIX:" sections and three copies of
 * .header-actions came from.
 *
 * Add a rule by finding its file. If no file fits, the rule probably wants a
 * new one; say so in the manifest rather than pasting it at the end.
 */

${ORDER.filter((f) => written.some((w) => w.file === f))
  .map((f) => `@import "./styles/${f}.css";`)
  .join("\n")}
`;

const rebuilt = ORDER.filter((f) => written.some((w) => w.file === f))
  .map((f) => `/* ${DESCRIPTIONS[f]} */\n\n${chunks.get(f).join("").trimEnd()}\n`)
  .join("");

const after = buildSnapshot(rebuilt);

for (const w of written) console.log(`  styles/${w.file}.css  ${w.lines} lines`);
console.log(`\nrendered output unchanged: ${after === before}`);

if (after !== before) {
  const a = before.split("\n");
  const b = after.split("\n");
  const at = a.findIndex((line, i) => line !== b[i]);
  console.error(`\nFIRST DIFFERENCE at line ${at + 1}:\n  was: ${a[at]}\n  now: ${b[at]}`);
  process.exitCode = 1;
} else if (dryRun) {
  console.log("--dry-run: nothing written");
} else {
  writeFileSync(ENTRY, manifest);
  console.log(`\nApp.css is now a ${manifest.split("\n").length}-line manifest.`);
}
