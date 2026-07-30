import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseStylesheet } from "../test/cssCascade";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESET = readFileSync(join(src, "styles", "ui-reset.css"), "utf8");
const TAILWIND = readFileSync(join(src, "tailwind.css"), "utf8");

/**
 * The scoped reset is the whole reason shadcn can be added here without
 * Preflight. Preflight resets margins, heading weights, list styles and border
 * colours globally, and 2,600 lines of hand-written CSS depend on all of them.
 *
 * A single unscoped selector in ui-reset.css reintroduces that problem in
 * miniature — quietly, and everywhere. Asserted rather than reviewed.
 */
describe("the scoped UI reset", () => {
  const rules = parseStylesheet(RESET);

  it("has rules at all, so the checks below cannot pass vacuously", () => {
    expect(rules.length).toBeGreaterThan(10);
  });

  it("scopes every single selector to [data-ui-scope]", () => {
    const leaked = rules.map((r) => r.selector).filter((s) => !s.includes("[data-ui-scope]"));
    expect(leaked, `these selectors escape the UI scope: ${leaked.join(", ")}`).toEqual([]);
  });

  it("never uses a bare universal or element selector", () => {
    // `*` or `button` alone is exactly the Preflight shape being avoided.
    const bare = rules.map((r) => r.selector).filter((s) => /^(\*|[a-z]+)(\s*,|$)/.test(s.trim()));
    expect(bare, `unscoped global selectors: ${bare.join(", ")}`).toEqual([]);
  });

  it("carries ZERO specificity, so everything beats it", () => {
    // The reason this matters, found by screenshotting the gallery: the first
    // version relied on @layer(base) ordering to lose to Tailwind, and did not.
    // Its `padding: 0` beat `px-4` and every shadcn button rendered with the
    // label clipped. :where() removes the fight instead of betting on how an
    // import pipeline preserves layers.
    const specific = rules
      .filter((r) => r.specificity.some((n) => n > 0))
      .map((r) => `${r.selector} = [${r.specificity}]`);

    expect(specific, `these reset rules can beat real styles: ${specific.join(", ")}`).toEqual([]);
  });

  it("is imported into the base layer as well, for belt and braces", () => {
    expect(TAILWIND).toMatch(/@import\s+"\.\/styles\/ui-reset\.css"\s+layer\(base\)/);
  });

  it("still does not pull in Preflight", () => {
    const code = TAILWIND.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/@import\s+"tailwindcss"\s*;/);
    expect(code).not.toMatch(/tailwindcss\/preflight/);
  });
});

describe("the shadcn token bridge", () => {
  const theme = TAILWIND.slice(TAILWIND.indexOf("@theme inline"));
  const bridged = [...theme.matchAll(/(--color-[\w-]+):\s*([^;]+);/g)];

  it("bridges the semantic names shadcn components reference", () => {
    const names = bridged.map(([, name]) => name);
    for (const required of [
      "--color-background",
      "--color-foreground",
      "--color-primary",
      "--color-border",
      "--color-ring",
      "--color-muted",
      "--color-popover",
      "--color-card",
      "--color-destructive",
    ]) {
      expect(names, `${required} is not bridged`).toContain(required);
    }
  });

  it("dereferences a variable rather than restating a literal", () => {
    // A literal is how the two systems drift: the component and the
    // hand-written rule render different colours, and the theme toggle moves
    // only one of them. #ffffff is allowed — a foreground on a coloured fill
    // is white in both themes.
    const literals = bridged
      .filter(([, , value]) => !value.trim().startsWith("var(") && value.trim() !== "#ffffff")
      .map(([, name, value]) => `${name}: ${value.trim()}`);

    expect(literals, `these bridge entries hardcode a colour: ${literals.join(", ")}`).toEqual([]);
  });
});
