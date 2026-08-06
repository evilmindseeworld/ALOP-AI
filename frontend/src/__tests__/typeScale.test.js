import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * The type scale, checked as arithmetic rather than looked at.
 *
 * Two classes of bug live here and neither is visible in a diff or a
 * screenshot review:
 *
 * 1. BODY TEXT BELOW THE LEGIBILITY FLOOR. --text-base was 15px, under the
 *    16px floor the reading research consistently reports, and it sized the
 *    transcript, the composer, the panels and the overlay. Nothing failed; it
 *    was just harder to read than it needed to be, everywhere, forever.
 *
 * 2. A HEADING SMALLER THAN ITS OWN BODY TEXT. When prose moved to 17px, the
 *    markdown headings were still borrowed from the interface scale — h3 was
 *    --text-base at 16px and h4 was --text-sm at 13px, both under the
 *    paragraph they head. That inverts the document's structure, and no
 *    existing test compares two font sizes to each other.
 *
 * The cascade snapshot would record both changes but not judge them; it
 * answers "did rendering move", not "is the result readable".
 */

const here = dirname(fileURLToPath(import.meta.url));
const TOKENS = readFileSync(join(here, "..", "styles", "tokens.css"), "utf8");
const MARKDOWN = readFileSync(join(here, "..", "styles", "markdown.css"), "utf8");
const CHAT = readFileSync(join(here, "..", "styles", "chat.css"), "utf8");

/** A px token's value, from the :root block. */
const px = (name) => {
  const m = new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(TOKENS);
  return m ? Number(m[1]) : null;
};

/** A markdown heading's em multiplier. */
const em = (tag) => {
  const m = new RegExp(`\\.markdown-body ${tag} \\{[^}]*font-size:\\s*(\\d+(?:\\.\\d+)?)em`).exec(MARKDOWN);
  return m ? Number(m[1]) : null;
};

describe("the type scale parses at all", () => {
  it("finds the tokens it is about to assert on", () => {
    // A guard on the guard. If the token syntax changes, every assertion below
    // would pass on nulls.
    for (const t of ["text-2xs", "text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-prose"]) {
      expect(px(t), `--${t} did not parse`).toBeGreaterThan(0);
    }
    for (const h of ["h1", "h2", "h3", "h4"]) {
      expect(em(h), `${h} em multiplier did not parse`).toBeGreaterThan(0);
    }
  });
});

describe("legibility floors", () => {
  it("body text is at least 16px", () => {
    // The floor reported consistently across reading research. This token sizes
    // the composer, the panels, the overlay and the sign-in card.
    expect(px("text-base")).toBeGreaterThanOrEqual(16);
  });

  it("the transcript is set at a reading size, not an interface size", () => {
    // Long-form reading on desktop is usually put at 18-20px. 17 is a floor
    // this project chose deliberately; what must not happen is prose dropping
    // back to the interface size.
    expect(px("text-prose")).toBeGreaterThanOrEqual(17);
    expect(px("text-prose")).toBeGreaterThan(px("text-base"));
  });

  it("the transcript actually uses the prose token", () => {
    // Both .bubble and .markdown-body must, because .markdown-body sits on the
    // same element in the transcript and on a different one in the overlay.
    // If only one of them did, whichever stylesheet the manifest loaded last
    // would silently decide the size of every answer.
    expect(CHAT).toMatch(/\.bubble\s*\{[^}]*font-size:\s*var\(--text-prose\)/);
    expect(MARKDOWN).toMatch(/\.markdown-body\s*\{[^}]*font-size:\s*var\(--text-prose\)/);
  });
});

describe("the scale is monotonic", () => {
  it("each step is larger than the one below it", () => {
    const ladder = ["text-2xs", "text-xs", "text-sm", "text-base", "text-lg", "text-xl"];
    for (let i = 1; i < ladder.length; i++) {
      expect(px(ladder[i]), `--${ladder[i]} is not above --${ladder[i - 1]}`).toBeGreaterThan(
        px(ladder[i - 1]),
      );
    }
  });
});

describe("no heading is smaller than the text it heads", () => {
  // The bug this file exists for. h3 was 16px against 17px prose.
  for (const h of ["h1", "h2", "h3"]) {
    it(`${h} is at least the size of a paragraph`, () => {
      expect(em(h), `${h} would render smaller than its own body text`).toBeGreaterThanOrEqual(1);
    });
  }

  it("the heading ladder descends h1 > h2 > h3", () => {
    expect(em("h1")).toBeGreaterThan(em("h2"));
    expect(em("h2")).toBeGreaterThan(em("h3"));
  });

  it("h4 is the one deliberate exception, and is muted to earn it", () => {
    // h4 below body size is a real convention, but only when it is also
    // de-emphasised in colour — otherwise it reads as broken rather than as a
    // minor heading.
    expect(em("h4")).toBeLessThan(1);
    expect(MARKDOWN).toMatch(/\.markdown-body h4 \{[^}]*color:\s*var\(--text-muted\)/);
  });

  it("headings are relative units, so they track the prose size", () => {
    // In px they would have to be re-derived by hand every time --text-prose
    // moves, which is exactly how h3 ended up smaller than its paragraph.
    expect(MARKDOWN).not.toMatch(/\.markdown-body h[1-4] \{[^}]*font-size:\s*var\(--text-(base|sm|lg|xl)\)/);
  });
});

describe("line length and leading", () => {
  it("the measure sits in the researched band", () => {
    const m = /--measure:\s*(\d+)ch/.exec(TOKENS);
    expect(m, "--measure did not parse").toBeTruthy();
    const ch = Number(m[1]);
    // 45-75 is the acceptable range; 55-66 is where the optimum is reported.
    expect(ch).toBeGreaterThanOrEqual(55);
    expect(ch).toBeLessThanOrEqual(66);
  });

  it("prose leading is inside 1.4-1.6", () => {
    // Above that range is usually compensation for type that is too small.
    for (const [label, css] of [["chat", CHAT], ["markdown", MARKDOWN]]) {
      const sel = label === "chat" ? /\.bubble\s*\{[^}]*line-height:\s*([\d.]+)/ : /\.markdown-body\s*\{[^}]*line-height:\s*([\d.]+)/;
      const lh = Number(sel.exec(css)[1]);
      expect(lh, `${label} leading is ${lh}`).toBeGreaterThanOrEqual(1.4);
      expect(lh, `${label} leading is ${lh}`).toBeLessThanOrEqual(1.6);
    }
  });
});
