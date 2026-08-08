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

/**
 * Which of the search results are worth spending a full page read on.
 *
 * THE BUG THIS FIXES, from a real answer the app produced: asked for monitors
 * under 2,500 AED it returned five monitors and no prices, and told the user to
 * go check the shops itself. `extractPageSignal` was working; it was handed the
 * wrong page. The one page the app read was `sources[0]`, and for a shopping
 * question the top result is a CATEGORY listing — `carrefouruae.com/.../c/NF4070600`,
 * `amazon.ae/b?node=...`, a PCMag roundup. Those pages carry no price in their
 * markup at all; the prices are painted in by JavaScript after load. So the
 * reader got nav, found no price lines, and the council answered honestly that
 * it had none.
 *
 * Two changes, both here:
 *
 * 1. Read more than one page. The read is on a deadline and runs concurrently,
 *    so three reads cost the same wall clock as one.
 * 2. Prefer a PRODUCT page over a LISTING page. A product URL states a price in
 *    server-rendered markup because that is what the page is for; a listing URL
 *    is a query against a catalogue. The two are distinguishable from the URL
 *    alone — `/dp/`, `/p/`, `/product/` against `/c/`, `?node=`, `/search`.
 *
 * A heuristic on the URL, not a fetch-and-see: deciding what to read cannot
 * itself cost a read. It is allowed to be wrong — being wrong costs one page of
 * the three, where before it cost the only page.
 */

/**
 * URL shapes that mean "one thing, with a price on it" — stated explicitly by
 * the retailer's own routing. These are worth more than any guess from the text
 * of the URL.
 */
const PRODUCT_PATH = /\/(?:dp|gp\/product|p|product|products|item|itm|pd|prd|buy)\//i;

/**
 * A long hyphenated slug, which USUALLY means a single item's page — and
 * sometimes means an article about many of them. `pcmag.com/en/monitors/13584/
 * the-best-computer-monitors-in-the-uae` is a roundup with no prices in it, and
 * when this scored the same as `/dp/`, that roundup won the tie and got read
 * instead of the Amazon listing. So it is a weak signal on purpose: enough to
 * beat a bare category page, never enough to outrank an explicit product path.
 */
const PRODUCT_SLUG = /\/[a-z0-9]+(?:-[a-z0-9]+){3,}(?:\/|$|\?)/i;

/** URL shapes that mean "a query against a catalogue", which renders client-side. */
const LISTING_PATH = /\/(?:c|category|categories|collections?|shop|browse|search|s|b|department|deals)(?:\/|$|\?)|[?&](?:node|category|cat|q|k|search|page|filter)=/i;

/**
 * @param {string} url
 * @returns {number}  higher reads first
 */
function readPriority(url) {
  const u = typeof url === "string" ? url : "";
  if (!u) return -1;
  let score = 0;
  if (PRODUCT_PATH.test(u)) score += 3;
  else if (PRODUCT_SLUG.test(u)) score += 1;
  // Not `else`: a URL can carry both — `/product/x?page=2` is still a product
  // page. The listing penalty is smaller than the product bonus on purpose, so
  // the combination stays ahead of a bare listing.
  if (LISTING_PATH.test(u)) score -= 1;
  return score;
}

/**
 * @param {Array<{url: string}>} sources
 * @param {object} [opts]
 * @param {number} [opts.limit]  how many pages the caller will actually read
 * @returns {string[]}  URLs, best first, deduplicated
 */
function rankReadTargets(sources, { limit = 3 } = {}) {
  const seen = new Set();
  return (Array.isArray(sources) ? sources : [])
    .map((s, i) => ({ url: s && s.url, i }))
    .filter(({ url }) => {
      if (typeof url !== "string" || !url.startsWith("http")) return false;
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    // Provider rank breaks ties, so with no price signal at all this degrades
    // to exactly the old behaviour — the top result, first.
    .sort((a, b) => readPriority(b.url) - readPriority(a.url) || a.i - b.i)
    .slice(0, Math.max(0, limit))
    .map(({ url }) => url);
}

module.exports = { extractPageSignal, hasPrice, rankReadTargets, readPriority };
