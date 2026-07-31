/**
 * Pure text and value helpers. No React, no DOM, no network — which is why
 * they can be tested without rendering anything.
 */

/** Collision-resistant enough for message keys within one session. */
export const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * Does this message mean "draw me a picture" rather than "answer me"?
 *
 * The length cap matters: without it, a long message that happens to contain
 * "create image" halfway through would be routed to the image generator
 * instead of the council.
 */
export const isImageRequest = (text) =>
  text.length <= 100 && /^\/image|^generate image|^create image|^draw image|^make image/i.test(text.trim());

export const parseImagePrompt = (text) => {
  const m = text.match(/(?:generate|create|draw|make)\s+(?:an?\s+)?image\s*(?:of\s+)?(.+)/i);
  return m ? m[1].trim() : text.replace(/^\/image\s*/, "").trim();
};

export const buildImageUrl = (prompt) =>
  `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;

/** First six words of the request, with the image command stripped off. */
export const generateChatTitle = (text) => {
  const cleaned = text
    .replace(/^\/image\s*/i, "")
    .replace(/^(generate|create|draw|make)\s+(an?\s+)?image\s*(?:of\s+)?/i, "")
    .trim();
  if (!cleaned) return "New Chat";

  const words = cleaned.split(/\s+/);
  let title = words.slice(0, 6).join(" ");
  if (words.length > 6) title += "...";
  return title.charAt(0).toUpperCase() + title.slice(1);
};

/**
 * Stripe reports minor units (900 = $9.00). Whole amounts drop the decimals so
 * a $9 plan reads "$9" rather than "$9.00".
 *
 * The catch is not defensive padding: Intl throws RangeError on a currency code
 * it does not recognise, and a plan priced in an unusual currency should still
 * render a number rather than crashing the upgrade panel.
 */
export const formatPrice = (p) => {
  if (!p || p.amount == null) return "";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: (p.currency || "usd").toUpperCase(),
      minimumFractionDigits: p.amount % 100 === 0 ? 0 : 2,
    }).format(p.amount / 100);
  } catch {
    return `${(p.amount / 100).toFixed(2)} ${(p.currency || "").toUpperCase()}`;
  }
};
