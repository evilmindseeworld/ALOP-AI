/**
 * Keeping the part of a page that answers the question.
 *
 * THE BUG THIS FIXES, from a real answer the app produced:
 *
 *   "Microless UAE, Amazon.ae and Empower Computers all list the monitor, but
 *    none displayed a price at the time."
 *
 * Every one of those pages displays a price. They were fetched, read, and
 * truncated at 3000 characters — and Jina's markdown of a retail page spends
 * its first few thousand characters on navigation, breadcrumbs, cookie notices
 * and marketing copy. The price is below the fold, in the document as much as
 * on the screen.
 *
 * Raising the limit is the obvious fix and the wrong one: it costs tokens on
 * every read, most of them nav, and the price could still fall outside a bigger
 * window on a long page. What the caller actually needs is the HEAD of the
 * document — which is where the product name and description live — plus every
 * line anywhere in it that carries a number a shopper would care about.
 *
 * So this returns both, labelled, and the lines are pulled from the WHOLE
 * document rather than the window.
 */

/**
 * A price: a currency marker adjacent to a number.
 *
 * Deliberately broad on currency and strict on shape. The app answers for any
 * region — AED, SAR, INR, GBP, EUR, USD — and a symbol-only rule would miss
 * every market that writes its code instead. What keeps it from matching prose
 * is the requirement that a number sit next to the marker.
 */
const PRICE = new RegExp(
  "(?:" +
    // ISO-style codes, before or after the number.
    "\\b(?:AED|SAR|QAR|KWD|BHD|OMR|EGP|USD|EUR|GBP|INR|PKR|JPY|CNY|CAD|AUD|NZD|CHF|SEK|NOK|DKK|PLN|TRY|ZAR|NGN|KES|BRL|MXN|SGD|HKD|MYR|THB|PHP|IDR|VND|KRW|RUB|ILS|MAD)\\b" +
    "|[$€£¥₹₩₪₦₱₺﷼]" +
    "|\\bRs\\.?|\\bDhs?\\.?|\\bد\\.إ" +
  ")",
  "i",
);

/** A number with at least one digit, allowing thousands separators and decimals. */
const NUMBER = /\d[\d,.  ]*\d|\d/;

/** Availability, which is the other thing a shopper needs and a page states plainly. */
const STOCK = /\b(in stock|out of stock|sold out|pre-?order|available|unavailable|ships? (?:in|within)|delivery)\b/i;

const hasPrice = (line) => {
  if (!PRICE.test(line)) return false;
  const m = PRICE.exec(line);
  // The number must be NEAR the marker, not merely somewhere on the same line —
  // otherwise "Prices in AED. Model number 27AQWMG" scores as a price.
  const around = line.slice(Math.max(0, m.index - 12), m.index + m[0].length + 14);
  return NUMBER.test(around);
};

/**
 * @param {string} raw        the fetched page, as markdown or text
 * @param {object} [opts]
 * @param {number} [opts.headChars]  how much of the top to keep verbatim
 * @param {number} [opts.maxLines]   how many signal lines to append
 * @param {number} [opts.maxChars]   hard ceiling on the result
 */
function extractPageSignal(raw, { headChars = 2500, maxLines = 20, maxChars = 4000 } = {}) {
  const text = typeof raw === "string" ? raw : "";
  if (!text.trim()) return "";

  const head = text.slice(0, headChars);

  // Scanned over the WHOLE document, which is the entire point — a line found
  // at character 40,000 is exactly the one the old truncation threw away.
  const seen = new Set();
  const signal = [];
  for (const line of text.split("\n")) {
    const t = line.replace(/\s+/g, " ").trim();
    // Long lines are prose that mentions a number, not a price row. 120 is
    // measured against the real shape: "AED 1,899.00 — In stock, ships within
    // 2 days from Dubai" is 55 characters. A 195-character sentence about
    // annual revenue slipped through at 200.
    if (!t || t.length > 120) continue;
    if (!hasPrice(t) && !STOCK.test(t)) continue;
    // Markdown tables and repeated nav produce the same line many times.
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    // Already visible in the head — appending it again wastes the budget.
    if (head.includes(t)) continue;
    seen.add(key);
    signal.push(t);
    if (signal.length >= maxLines) break;
  }

  if (!signal.length) return head.slice(0, maxChars);

  const block = `${head}\n\n=== PRICE AND AVAILABILITY LINES FOUND ELSEWHERE ON THIS PAGE ===\n${signal.join("\n")}`;
  return block.slice(0, maxChars);
}

module.exports = { extractPageSignal, hasPrice };
