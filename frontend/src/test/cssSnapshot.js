/**
 * Builds the cascade baseline: the winning, var-substituted declaration for
 * every property on every element in the fixture, across the environment and
 * state matrix.
 *
 * The output is deliberately readable. Its whole job during the !important
 * refactor is that a human can open the diff and see which declaration moved,
 * so a hash per element would defeat the point.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
// Extensions are explicit: scripts/strip-redundant-important.mjs imports this
// module through bare Node, which does not resolve extensionless specifiers.
import { parseStylesheet, applyRules, substituteVars } from "./cssCascade.js";
import { APP_MARKUP } from "./fixtures/appMarkup.js";

/**
 * Read a stylesheet with its local `@import`s inlined, in order.
 *
 * App.css becomes an ordered import manifest once it is split into
 * src/styles/*.css, and the order of those imports IS the cascade. Inlining
 * here means the snapshot keeps covering the whole stylesheet across that
 * change without the test needing to know it happened.
 *
 * Remote imports (the two font URLs) are skipped — they contain @font-face and
 * no cascading rules.
 */
export function readStylesheet(entryPath) {
  const seen = new Set();

  const read = (path) => {
    if (seen.has(path)) return ""; // an import cycle would otherwise hang
    seen.add(path);

    return readFileSync(path, "utf8").replace(
      /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*;/g,
      (match, target) => {
        if (/^(https?:)?\/\//.test(target)) return "";
        return read(resolvePath(dirname(path), target));
      }
    );
  };

  return read(entryPath);
}

/**
 * Only three widths and one reduced-motion pass. The theme is not an axis here
 * because it lives on an `.app-root` class rather than a media query — the
 * fixture renders both themes, so one pass covers them.
 */
export const ENVS = [
  { label: "width=1400", width: 1400, reducedMotion: false },
  { label: "width=900", width: 900, reducedMotion: false },
  { label: "width=400", width: 400, reducedMotion: false },
  { label: "width=1400 reduced-motion", width: 1400, reducedMotion: true },
];

export const STATES = [[], ["hover"], ["focus"], ["focus-visible"], ["active"], ["disabled"]];

const describeElement = (el, index) => {
  const id = el.id ? `#${el.id}` : "";
  const classes = [...el.classList].map((c) => `.${c}`).join("");
  const type = el.getAttribute?.("type");
  return `[${index}] ${el.tagName.toLowerCase()}${id}${classes}${type ? `[type=${type}]` : ""}`;
};

const stateLabel = (state) => (state.length ? `:${state.join(":")}` : "");

/**
 * Match every rule against the DOM once.
 *
 * Matching is O(rules x elements) and is the expensive half; the cascade itself
 * is cheap. Doing it once and replaying the cascade over the matrix turns a
 * multi-minute run into a sub-second one.
 */
const indexMatches = (rules, elements) => {
  const position = new Map(elements.map((el, i) => [el, i]));
  const perElement = elements.map(() => []);

  for (const rule of rules) {
    let matched;
    try {
      matched = document.querySelectorAll(rule.match.matchSelector);
    } catch {
      continue; // a selector jsdom cannot parse; reported as unmatched below
    }
    for (const el of matched) {
      const i = position.get(el);
      if (i !== undefined) perElement[i].push(rule);
    }
  }

  return perElement;
};

const renderDeclarations = (winners, vars) => {
  const lines = [];
  for (const key of [...winners.keys()].sort()) {
    // Custom-property declarations are deliberately NOT emitted here.
    //
    // Emitting them makes the snapshot sensitive to WHERE a token is declared,
    // and moving token declarations between :root and .app-root is precisely
    // what this refactor does. The harness's own guard test caught this: a move
    // that changed nothing on screen produced a diff. Every token that affects
    // rendering does so through some consumer's var(), and those consumers are
    // substituted below — so the value is still fully covered, without the
    // declaration site being part of the contract.
    //
    // Effective tokens are reported separately, per theme, further down.
    if (key.startsWith("--")) continue;
    const decl = winners.get(key);
    // The !important flag is deliberately NOT printed. It decides which
    // declaration wins, and the winner's value is what gets recorded — but
    // removing a redundant !important changes nothing on screen, and that is
    // most of what this refactor does. Printing the flag would diff on all of
    // them and make the guard useless for its actual job.
    lines.push(`${key}: ${substituteVars(decl.value, vars)}`);
  }
  return lines;
};

export function buildSnapshot(css, html = APP_MARKUP) {
  const rules = parseStylesheet(css);

  document.body.innerHTML = html;
  const elements = [document.documentElement, document.body, ...document.body.querySelectorAll("*")];
  const perElement = indexMatches(rules, elements);

  const usedSelectors = new Set();
  perElement.forEach((list) => list.forEach((rule) => usedSelectors.add(rule.selector)));

  // Ancestor chain by index, so custom properties can be inherited without
  // re-walking the DOM for every environment.
  const position = new Map(elements.map((el, i) => [el, i]));
  const ancestors = elements.map((el) => {
    const chain = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const i = position.get(node);
      if (i !== undefined) chain.unshift(i);
    }
    return chain;
  });

  const out = [
    "# ALOP-AI cascade baseline — generated by src/test/cssSnapshot.js",
    "#",
    "# This records what the stylesheet RENDERS, not how it is written. A diff",
    "# here means a refactor changed behaviour. Do not regenerate it to make a",
    "# test pass; fix the CSS.",
    "#",
    // Fixture and matrix dimensions only. The RULE COUNT is deliberately absent:
    // folding an override into the rule it overrides removes rules without
    // changing rendering, so including it would false-fail every correct commit.
    `# elements: ${elements.length}   environments: ${ENVS.length}   states: ${STATES.length}`,
    "",
  ];

  /** env index -> element index -> state label -> rendered lines */
  const byEnv = [];

  for (const env of ENVS) {
    const perElementVars = [];
    const forThisEnv = [];

    for (let i = 0; i < elements.length; i++) {
      // Custom properties in scope: every ancestor's own winning --* values.
      const vars = new Map();
      for (const ancestor of ancestors[i]) {
        const own = perElementVars[ancestor];
        if (own) {
          for (const [k, v] of own) vars.set(k, v);
          continue;
        }
        const winners = applyRules(perElement[ancestor], env, []);
        const ownVars = new Map();
        for (const [k, decl] of winners) if (k.startsWith("--")) ownVars.set(k, decl.value);
        perElementVars[ancestor] = ownVars;
        for (const [k, v] of ownVars) vars.set(k, v);
      }

      const states = {};
      const base = renderDeclarations(applyRules(perElement[i], env, []), vars);
      if (base.length) states[""] = base;

      for (const state of STATES.slice(1)) {
        const lines = renderDeclarations(applyRules(perElement[i], env, state), vars);
        // Only what the state adds or changes. A state that changes nothing is
        // noise, and there are five of them per element.
        const changed = lines.filter((line) => !base.includes(line));
        if (changed.length) states[stateLabel(state)] = changed;
      }

      forThisEnv.push(states);
    }

    byEnv.push(forThisEnv);
  }

  // Environment 0 in full; the rest as diffs against it. Widths change a
  // handful of rules, and printing every element four times would bury them.
  for (let e = 0; e < ENVS.length; e++) {
    const header = e === 0 ? `=== ${ENVS[e].label} ===` : `=== ${ENVS[e].label} (changes vs ${ENVS[0].label}) ===`;
    const section = [];

    for (let i = 0; i < elements.length; i++) {
      const current = byEnv[e][i];
      const baseline = e === 0 ? null : byEnv[0][i];
      const block = [];

      for (const key of Object.keys(current)) {
        const lines = current[key];
        const previous = baseline ? baseline[key] || [] : null;
        const shown = previous ? lines.filter((line) => !previous.includes(line)) : lines;
        if (shown.length) block.push(...(key ? [`  ${key}`] : []), ...shown.map((l) => (key ? `    ${l}` : `  ${l}`)));
      }

      // Declarations that existed at the base width and are gone at this one.
      if (baseline) {
        for (const key of Object.keys(baseline)) {
          const removed = (baseline[key] || []).filter((line) => !(current[key] || []).includes(line));
          if (removed.length) block.push(...(key ? [`  ${key}`] : []), ...removed.map((l) => `  - ${l}`));
        }
      }

      if (block.length) section.push(describeElement(elements[i], i), ...block, "");
    }

    if (section.length) out.push(header, "", ...section);
  }

  // Tokens as they actually resolve on each theme root, fully substituted.
  //
  // This is move-invariant by construction — it reports what is in scope, not
  // who declared it — so it survives the refactor while still making a changed
  // token legible as one line instead of two hundred scattered colour changes.
  out.push("=== effective tokens per theme root ===", "");
  for (const themeRoot of document.querySelectorAll(".app-root")) {
    const index = position.get(themeRoot);
    const vars = new Map();
    for (const ancestor of ancestors[index]) {
      for (const [k, decl] of applyRules(perElement[ancestor], ENVS[0], [])) {
        if (k.startsWith("--")) vars.set(k, decl.value);
      }
    }
    out.push(describeElement(themeRoot, index));
    for (const key of [...vars.keys()].sort()) out.push(`  ${key}: ${substituteVars(vars.get(key), vars)}`);
    out.push("");
  }

  const unmatched = [...new Set(rules.map((r) => r.selector))].filter((s) => !usedSelectors.has(s)).sort();
  out.push(
    "=== selectors matching no element in the fixture ===",
    "",
    "# Either the fixture is missing markup, or the rule is dead. Both are worth",
    "# knowing, and a change to this list is a change to the stylesheet's reach.",
    "",
    ...unmatched,
    ""
  );

  return out.join("\n");
}
