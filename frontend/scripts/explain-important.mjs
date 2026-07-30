/**
 * For every surviving `!important`, name the declaration it is beating.
 *
 * The insight that makes the rest of the cleanup mechanical: if a forced
 * declaration wins, whatever it outranks never renders. That loser is dead
 * code. Delete the loser and the force becomes unnecessary — same pixels, one
 * less `!important`, one less rule.
 *
 * So this reports, per element and property, the forced winner and the
 * runner-up it suppresses. The runner-ups are the deletion list.
 *
 *     node scripts/explain-important.mjs
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>");
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;

const { parseStylesheet, mediaMatches } = await import("../src/test/cssCascade.js");
const { readStylesheet } = await import("../src/test/cssSnapshot.js");
const { APP_MARKUP } = await import("../src/test/fixtures/appMarkup.js");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rules = parseStylesheet(readStylesheet(join(root, "src", "App.css")));

document.body.innerHTML = APP_MARKUP;
const elements = [document.documentElement, document.body, ...document.body.querySelectorAll("*")];

const ENV = { width: 1400, reducedMotion: false };
const STATES = [[], ["hover"], ["active"], ["focus"], ["disabled"]];

const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// selector|prop -> set of "selector (line hint)" it suppresses
const suppressed = new Map();

for (const el of elements) {
  const matching = rules.filter((r) => {
    try {
      return el.matches(r.match.matchSelector);
    } catch {
      return false;
    }
  });

  for (const state of STATES) {
    const active = matching.filter(
      (r) => (!r.media || mediaMatches(r.media, ENV)) && r.match.dynamic.every((d) => state.includes(d))
    );

    const byProp = new Map();
    for (const rule of active) {
      for (const [prop, decl] of rule.declarations) {
        if (prop.startsWith("--")) continue;
        if (!byProp.has(prop)) byProp.set(prop, []);
        byProp.get(prop).push({ rule, decl });
      }
    }

    for (const [prop, candidates] of byProp) {
      const ranked = [...candidates].sort((a, b) => {
        if (a.decl.important !== b.decl.important) return a.decl.important ? -1 : 1;
        const s = cmp(b.rule.specificity, a.rule.specificity);
        return s !== 0 ? s : b.rule.order - a.rule.order;
      });

      const [winner, ...rest] = ranked;
      if (!winner?.decl.important) continue;

      // Only report where the force actually mattered: something below it would
      // otherwise have won.
      const runnerUp = rest.find((c) => !c.decl.important);
      if (!runnerUp) continue;
      if (cmp(runnerUp.rule.specificity, winner.rule.specificity) < 0 && runnerUp.rule.order < winner.rule.order) {
        continue; // would have lost anyway
      }

      const key = `${winner.rule.selector}  {${prop}}`;
      if (!suppressed.has(key)) suppressed.set(key, new Set());
      suppressed.get(key).add(`${runnerUp.rule.selector}: ${prop}: ${runnerUp.decl.value.slice(0, 70)}`);
    }
  }
}

for (const key of [...suppressed.keys()].sort()) {
  console.log(`\n${key}`);
  for (const loser of [...suppressed.get(key)].sort()) console.log(`    suppresses  ${loser}`);
}
console.log(`\n${suppressed.size} forced declarations actually suppress something.`);
