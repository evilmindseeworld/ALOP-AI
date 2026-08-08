import { describe, it, expect } from "vitest";
import { STARTERS } from "../constants/starters";

/* A starter is a SEED, not a prompt.
 *
 * These tests used to assert that every starter carried a finished question
 * over 30 characters, because clicking one sent it. That is exactly the
 * behaviour that turned out to be wrong: it committed the user to a question
 * they had not asked. The shape changed, so the assertions changed with it —
 * and the two that matter most are new, not carried over.
 */
describe("empty-state starters", () => {
  it("offers a handful — enough to show range, few enough to scan", () => {
    expect(STARTERS.length).toBeGreaterThanOrEqual(3);
    expect(STARTERS.length).toBeLessThanOrEqual(6);
  });

  it("gives every starter an icon, a label, a seed and a hint", () => {
    for (const s of STARTERS) {
      expect(s.icon, `missing icon: ${s.label}`).toBeTruthy();
      expect(s.label, `missing label`).toBeTruthy();
      expect(s.seed?.trim(), `missing seed: ${s.label}`).toBeTruthy();
      expect(s.hint?.trim(), `missing hint: ${s.label}`).toBeTruthy();
    }
  });

  it("keeps labels short enough not to wrap in a card", () => {
    for (const s of STARTERS) {
      expect(s.label.length, `label too long: "${s.label}"`).toBeLessThanOrEqual(24);
    }
  });

  /* THE POINT OF THE WHOLE CHANGE, asserted directly.
   *
   * A seed opens a sentence and stops. If one ever grows into a finished
   * question again, the card is back to committing the user to something they
   * did not ask for, and it will look like a helpful edit at the time. */
  it("seeds an opening, never a finished question", () => {
    for (const s of STARTERS) {
      expect(s.seed.length, `seed is long enough to be a prompt: "${s.seed}"`).toBeLessThan(32);
      expect(s.seed, `seed ends like a finished question: "${s.seed}"`).not.toMatch(/\?\s*$/);
    }
  });

  it("leaves the cursor mid-sentence, so the user continues rather than repairs", () => {
    // A seed that does not end in a space makes the user type a space first,
    // which is the kind of small friction that makes a shortcut feel broken.
    for (const s of STARTERS) {
      expect(s.seed.endsWith(" "), `seed does not end in a space: "${s.seed}"`).toBe(true);
    }
  });

  it("has no duplicate seeds or labels", () => {
    expect(new Set(STARTERS.map((s) => s.seed)).size).toBe(STARTERS.length);
    expect(new Set(STARTERS.map((s) => s.label)).size).toBe(STARTERS.length);
  });

  // Exactly one starter should reach the client-side image path. Two would
  // waste a slot; zero would leave image generation undiscoverable, which is
  // how it sat unused before.
  it("routes exactly one starter to image generation", () => {
    const imageStarters = STARTERS.filter((s) => /^\/image\b/.test(s.seed));
    expect(imageStarters).toHaveLength(1);
  });

  it("keeps the other starters out of the image path", () => {
    // isImageRequest matches /image and "generate|create|draw|make image" under
    // 100 chars. A text starter tripping that would silently render a picture
    // instead of answering.
    const isImageRequest = (text) =>
      text.length <= 100 &&
      /^\/image|^generate image|^create image|^draw image|^make image/i.test(text.trim());

    for (const s of STARTERS.filter((x) => !/^\/image\b/.test(x.seed))) {
      expect(isImageRequest(s.seed), `"${s.label}" would be misrouted to image generation`).toBe(false);
    }
  });
});
