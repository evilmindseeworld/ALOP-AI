import { describe, it, expect } from "vitest";
import { STARTERS } from "../App";

// A blank page is the hardest prompt to answer. Each starter is one click to a
// real reply, and between them they exercise deliberation, live web search,
// code reasoning and image generation — so a first-time user sees what the
// council actually does instead of guessing.
describe("empty-state starters", () => {
  it("offers a handful — enough to show range, few enough to scan", () => {
    expect(STARTERS.length).toBeGreaterThanOrEqual(3);
    expect(STARTERS.length).toBeLessThanOrEqual(6);
  });

  it("gives every starter an icon, a label and a prompt", () => {
    for (const s of STARTERS) {
      expect(s.icon, `missing icon: ${s.label}`).toBeTruthy();
      expect(s.label, `missing label for "${s.prompt}"`).toBeTruthy();
      expect(s.prompt?.trim(), `missing prompt: ${s.label}`).toBeTruthy();
    }
  });

  it("keeps labels short enough not to wrap in a card", () => {
    for (const s of STARTERS) {
      expect(s.label.length, `label too long: "${s.label}"`).toBeLessThanOrEqual(24);
    }
  });

  it("uses prompts substantial enough to produce a real answer", () => {
    for (const s of STARTERS) {
      expect(s.prompt.length, `prompt too thin: "${s.prompt}"`).toBeGreaterThan(30);
    }
  });

  it("has no duplicate prompts or labels", () => {
    expect(new Set(STARTERS.map((s) => s.prompt)).size).toBe(STARTERS.length);
    expect(new Set(STARTERS.map((s) => s.label)).size).toBe(STARTERS.length);
  });

  // Exactly one starter should hit the client-side image path. Two would waste
  // a slot; zero would leave image generation undiscoverable, which is how it
  // sat unused before.
  it("routes exactly one starter to image generation", () => {
    const imageStarters = STARTERS.filter((s) => /^\/image\b/.test(s.prompt));
    expect(imageStarters).toHaveLength(1);
  });

  it("keeps the other starters out of the image path", () => {
    // isImageRequest matches /image and "generate|create|draw|make image" under
    // 100 chars. A text starter tripping that would silently render a picture
    // instead of answering.
    const isImageRequest = (text) =>
      text.length <= 100 &&
      /^\/image|^generate image|^create image|^draw image|^make image/i.test(text.trim());

    for (const s of STARTERS.filter((x) => !/^\/image\b/.test(x.prompt))) {
      expect(isImageRequest(s.prompt), `"${s.label}" would be misrouted to image generation`).toBe(false);
    }
  });
});
