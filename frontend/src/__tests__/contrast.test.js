import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readTokenFile, ratio } from "../test/contrast";

/**
 * Every colour pair the UI actually puts together, measured.
 *
 * This is the test that would have caught what shipped. `styles/obsidian.css`
 * redeclared the whole token set on `.dark` and inverted the text ramp —
 * `--text-muted` (#5a5560) came out DARKER than `--text-subtle` (#8a8590) — so
 * "muted" body text sat at 2.4:1 against its own surface, timestamps rendered
 * at rgba(255,255,255,0.2) (1.4:1, effectively invisible), and white on the
 * pink fill was 2.6:1 on the most-repeated element in the app.
 *
 * None of that is visible in a diff, a screenshot review or a component test.
 * It is visible here, in one line of arithmetic per pair.
 *
 * FLOORS (WCAG 2.2 AA):
 *   4.5:1  text under 18.66px, which is all body text here
 *   3.0:1  large text, icons, and the visual boundary of a control
 */
const TOKENS = readTokenFile(join(dirname(fileURLToPath(import.meta.url)), "..", "styles", "tokens.css"));

const AA_TEXT = 4.5;
const AA_LARGE = 3;

/** Foreground, background, floor — the pairs the stylesheet really renders. */
const PAIRS = [
  // Body text on every surface it can land on.
  ["--text", "--bg", AA_TEXT],
  ["--text", "--surface", AA_TEXT],
  ["--text", "--surface-2", AA_TEXT],
  ["--text", "--surface-3", AA_TEXT],
  ["--text", "--surface-4", AA_TEXT],

  // Secondary text: sidebar rows, plan features, panel copy.
  ["--text-muted", "--bg", AA_TEXT],
  ["--text-muted", "--surface", AA_TEXT],
  ["--text-muted", "--surface-2", AA_TEXT],
  ["--text-muted", "--surface-3", AA_TEXT],

  // Tertiary text: timestamps, hints, group labels, the footer. Held to the
  // same 4.5:1 floor deliberately — "decorative" text is still text somebody
  // has to read, and treating it as exempt is how it reached 1.4:1.
  ["--text-subtle", "--bg", AA_TEXT],
  ["--text-subtle", "--surface", AA_TEXT],
  ["--text-subtle", "--surface-2", AA_TEXT],
  ["--text-subtle", "--surface-3", AA_TEXT],

  // Text and icons sitting ON a fill: the send button, the user's own
  // messages, the plan buttons, every badge.
  ["--text-on-fill", "--primary", AA_TEXT],
  ["--text-on-fill", "--primary-strong", AA_TEXT],
  ["--text-on-fill", "--danger", AA_TEXT],
  ["--text-on-fill", "--emerald", AA_TEXT],
  ["--text-on-fill", "--accent", AA_TEXT],

  // Accents used as text: links in answers, the upgrade button, active rows.
  ["--primary", "--surface", AA_TEXT],
  ["--primary", "--surface-2", AA_TEXT],
  ["--danger", "--surface", AA_TEXT],
  ["--danger", "--surface-2", AA_TEXT],

  // Accents used as marks: avatars, status dots, the active rail, the focus
  // ring. Icons and boundaries, so 3:1.
  ["--emerald", "--surface", AA_LARGE],
  ["--emerald", "--surface-2", AA_LARGE],
  // The sidebar's upgrade button draws its crown in --accent on --accent-dim,
  // which sits on --surface. An icon, so 3:1.
  ["--accent", "--surface", AA_LARGE],
  ["--primary", "--bg", AA_LARGE],
  ["--success", "--surface-2", AA_LARGE],
  ["--warning", "--surface-2", AA_LARGE],
  ["--info", "--surface-2", AA_LARGE],

  // The crash screen. It renders outside .app-root and so resolves the dark
  // tokens whatever the user's theme, but it is the ONE screen that appears
  // when the app is already broken — the pairs it uses are pinned here so a
  // palette change can never make the error unreadable.
  ["--text", "--surface", AA_TEXT],
  ["--text-subtle", "--surface-2", AA_TEXT],
  ["--text-on-fill", "--primary", AA_TEXT],
];

describe("theme-dependent tokens", () => {
  /**
   * A custom property's var()s are substituted at computed-value time on the
   * element where the property is DECLARED, not where it is used. So a token
   * like `--gradient-primary: linear-gradient(..., var(--primary), ...)`
   * declared on :root bakes in the DARK --primary, and inherits that baked
   * value into the light theme however many times .app-root.light redeclares
   * --primary underneath it.
   *
   * That shipped: the user's own message painted dark-theme pink in Bamboo
   * Day, with the light theme's near-white --text-on-fill sitting on it. No
   * contrast pair catches it, because both tokens are individually correct.
   */
  const referencesAnotherToken = ([, value]) => /var\(--/.test(value);

  it("redeclares every composite token in the light theme", () => {
    const composite = Object.entries(TOKENS.dark).filter(referencesAnotherToken).map(([name]) => name);

    // Guard against the check going vacuous if the tokens stop using var().
    expect(composite.length, "no composite tokens found — has the file changed shape?").toBeGreaterThan(0);

    const missing = composite.filter((name) => !(name in TOKENS.light));
    expect(
      missing,
      `these tokens reference another token and are declared only on :root, so the light ` +
      `theme inherits their DARK-resolved value: ${missing.join(", ")}. Redeclare them in ` +
      `.app-root.light.`
    ).toEqual([]);
  });
});

describe.each([
  ["dark", TOKENS.dark],
  ["light", TOKENS.light],
])("%s theme contrast", (themeName, tokens) => {
  it.each(PAIRS)("%s on %s clears %s:1", (fg, bg, floor) => {
    const foreground = tokens[fg];
    const background = tokens[bg];

    expect(foreground, `${fg} is not declared in the ${themeName} theme`).toBeTruthy();
    expect(background, `${bg} is not declared in the ${themeName} theme`).toBeTruthy();

    const measured = ratio(foreground, background);
    expect(
      measured,
      `${fg} (${foreground}) on ${bg} (${background}) is ${measured}:1 in the ${themeName} ` +
      `theme, below the ${floor}:1 floor. Adjust the token rather than the floor.`
    ).toBeGreaterThanOrEqual(floor);
  });

  it("keeps the text ramp monotonic", () => {
    // The specific defect obsidian.css shipped: a "muted" step that was darker
    // than the "subtle" step below it, which makes the names lie and puts the
    // more important text at the lower contrast.
    const onSurface = (token) => ratio(tokens[token], tokens["--surface"]);

    expect(
      onSurface("--text"),
      "--text must be the highest-contrast step in the ramp"
    ).toBeGreaterThan(onSurface("--text-muted"));

    expect(
      onSurface("--text-muted"),
      "--text-muted must sit above --text-subtle: it is used for MORE important text, " +
      "and inverting the two is exactly the bug this file exists to prevent"
    ).toBeGreaterThan(onSurface("--text-subtle"));
  });

  it("keeps the surface ramp monotonic", () => {
    // Surfaces stack: bg behind surface behind surface-2, and hover/pressed
    // states step further from the background. If two steps cross, a hovered
    // row goes darker than the card it sits in.
    const steps = ["--bg", "--surface", "--surface-2", "--surface-3", "--surface-4"];
    const fromBg = steps.map((token) => ratio(tokens[token], tokens["--bg"]));

    for (let i = 1; i < steps.length; i++) {
      expect(
        fromBg[i],
        `${steps[i]} must sit further from --bg than ${steps[i - 1]} does`
      ).toBeGreaterThanOrEqual(fromBg[i - 1]);
    }
  });

  it("gives the focus ring a visible edge on every surface", () => {
    // Focus is drawn in --primary at 2px. A ring that does not clear 3:1
    // against the surface behind it is a keyboard user with no cursor.
    for (const surface of ["--bg", "--surface", "--surface-2", "--surface-3"]) {
      expect(
        ratio(tokens["--primary"], tokens[surface]),
        `the focus ring is invisible on ${surface} in the ${themeName} theme`
      ).toBeGreaterThanOrEqual(AA_LARGE);
    }
  });
});
