import { describe, it, expect } from "vitest";
import {
  uid,
  isImageRequest,
  parseImagePrompt,
  buildImageUrl,
  generateChatTitle,
  formatPrice,
} from "../lib/format";

describe("isImageRequest", () => {
  it("recognises the slash command and the natural phrasings", () => {
    expect(isImageRequest("/image a cat")).toBe(true);
    expect(isImageRequest("generate image of a cat")).toBe(true);
    expect(isImageRequest("Create Image of a cat")).toBe(true);
    expect(isImageRequest("draw image of a cat")).toBe(true);
    expect(isImageRequest("make image of a cat")).toBe(true);
  });

  it("ignores leading whitespace", () => {
    expect(isImageRequest("   /image a cat")).toBe(true);
  });

  it("does not fire on an ordinary question", () => {
    expect(isImageRequest("How do I generate an image in Python?")).toBe(false);
    expect(isImageRequest("what is a diffusion model")).toBe(false);
  });

  it("does not fire on a long message that merely mentions the phrase", () => {
    // The length cap is the whole defence here: without it, a paragraph
    // beginning "generate image" would be routed to the image generator
    // instead of the council.
    const long = `generate image ${"x".repeat(120)}`;
    expect(long.length).toBeGreaterThan(100);
    expect(isImageRequest(long)).toBe(false);
  });
});

describe("parseImagePrompt", () => {
  it("strips the slash command", () => {
    expect(parseImagePrompt("/image a red bicycle")).toBe("a red bicycle");
  });

  it("strips the natural phrasing including the article and 'of'", () => {
    expect(parseImagePrompt("generate an image of a red bicycle")).toBe("a red bicycle");
    expect(parseImagePrompt("draw image a red bicycle")).toBe("a red bicycle");
  });

  it("returns the text unchanged when no command is present", () => {
    expect(parseImagePrompt("a red bicycle")).toBe("a red bicycle");
  });
});

describe("buildImageUrl", () => {
  it("percent-encodes the prompt", () => {
    expect(buildImageUrl("a cat & dog")).toContain("a%20cat%20%26%20dog");
  });

  it("requests a square image with no watermark", () => {
    const url = buildImageUrl("x");
    expect(url).toContain("width=1024");
    expect(url).toContain("height=1024");
    expect(url).toContain("nologo=true");
  });
});

describe("generateChatTitle", () => {
  it("capitalises and keeps six words", () => {
    expect(generateChatTitle("how do promises work in javascript")).toBe(
      "How do promises work in javascript"
    );
  });

  it("truncates past six words", () => {
    expect(generateChatTitle("one two three four five six seven")).toBe("One two three four five six...");
  });

  it("strips an image command before titling", () => {
    expect(generateChatTitle("/image a neon jellyfish")).toBe("A neon jellyfish");
    expect(generateChatTitle("generate an image of a neon jellyfish")).toBe("A neon jellyfish");
  });

  it("falls back when the command leaves nothing behind", () => {
    expect(generateChatTitle("/image")).toBe("New Chat");
    expect(generateChatTitle("   ")).toBe("New Chat");
  });
});

describe("formatPrice", () => {
  it("drops the decimals on a whole amount", () => {
    expect(formatPrice({ amount: 900, currency: "usd" })).toBe("$9");
  });

  it("keeps them when there are cents", () => {
    expect(formatPrice({ amount: 999, currency: "usd" })).toBe("$9.99");
  });

  it("returns an empty string rather than NaN for a missing price", () => {
    // The upgrade panel renders `Monthly — ${formatPrice(prices?.monthly)}`, so
    // anything other than "" here puts "NaN" or "undefined" on a buy button.
    expect(formatPrice(null)).toBe("");
    expect(formatPrice(undefined)).toBe("");
    expect(formatPrice({})).toBe("");
    expect(formatPrice({ amount: null })).toBe("");
  });

  it("still renders a number when Intl rejects the currency code", () => {
    // Intl throws RangeError on an unknown code. A plan priced in something
    // unusual should degrade to "9.00 XYZ", not take the panel down.
    expect(formatPrice({ amount: 900, currency: "not-a-currency" })).toBe("9.00 NOT-A-CURRENCY");
  });

  it("treats a zero amount as a real price, not a missing one", () => {
    expect(formatPrice({ amount: 0, currency: "usd" })).toBe("$0");
  });
});

describe("uid", () => {
  it("does not collide across a realistic burst", () => {
    const ids = new Set(Array.from({ length: 5000 }, uid));
    expect(ids.size).toBe(5000);
  });
});
