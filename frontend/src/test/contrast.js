/**
 * WCAG contrast, computed from the token file itself.
 *
 * Colour decisions in this app are made in tokens.css and nowhere else, so the
 * only honest place to check them is by reading that file and doing the
 * arithmetic — not by sampling a rendered screenshot, which measures the
 * screenshot, and not by eye, which is how `--text-muted` ended up darker than
 * `--text-subtle` and shipped at 2.4:1.
 */

import { readFileSync } from "node:fs";

/**
 * Every custom property declared inside one selector block.
 *
 * Comments are stripped first, and that is not cosmetic: the token file
 * documents each ramp in prose above it, so a comment reading "measured
 * against --surface:" parses as a declaration whose value runs to the next
 * semicolon — swallowing the real declaration underneath it. The first run of
 * this parser reported `--text` as undefined for exactly that reason.
 */
export const readTokens = (rawCss, selector) => {
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const at = css.indexOf(selector);
  if (at === -1) throw new Error(`no ${selector} block in the token file`);

  const open = css.indexOf("{", at);
  const close = css.indexOf("\n}", open);
  const body = css.slice(open + 1, close);

  const tokens = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
};

export const readTokenFile = (path) => {
  const css = readFileSync(path, "utf8");
  return {
    dark: readTokens(css, ":root {"),
    light: readTokens(css, ".app-root.light {"),
  };
};

/** #rgb, #rrggbb and rgba() — the three forms the token file actually uses. */
export const parseColor = (value) => {
  const v = value.trim();

  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }

  const rgba = v.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  }

  throw new Error(`cannot parse colour: ${value}`);
};

/** Alpha colours are only meaningful over something — flatten before measuring. */
export const flatten = (fg, bg) =>
  fg.a >= 1
    ? fg
    : {
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
      };

/** WCAG 2.x relative luminance. */
export const luminance = ({ r, g, b }) => {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

export const contrast = (foreground, background) => {
  const bg = parseColor(background);
  const fg = flatten(parseColor(foreground), bg);
  const [lo, hi] = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
  return (hi + 0.05) / (lo + 0.05);
};

/** Rounded to one decimal, which is the precision anyone quotes these in. */
export const ratio = (foreground, background) => Math.round(contrast(foreground, background) * 10) / 10;
