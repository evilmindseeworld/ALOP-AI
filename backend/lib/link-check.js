/**
 * Deciding whether a search result is still a real page.
 *
 * The failure this exists for: a search API returns a product URL, the council
 * cites it, and the user clicks through to "This item is no longer available"
 * — or to a 200-status page that says "Page not found" in the body. The answer
 * looked sourced and was not. That is the failure users actually notice,
 * because it is the one they can check.
 *
 * THE BIAS IS DELIBERATE AND IT IS TOWARD KEEPING LINKS. Marking a good source
 * dead is worse than missing a dead one: a missed dead link costs one click,
 * while a wrongly-dropped link removes real evidence from an answer and there
 * is no way for the reader to know it happened. So every signal below has to
 * be strong, and "unsure" always resolves to `ok`.
 *
 * That is also why the body is not scanned as a whole. A live product page can
 * legitimately contain "out of stock" for one variant, "sold out" in a related
 * -items rail, or the string "404" in an SKU. The signals are read from the
 * <title> and the first <h1> — the two places a page states what it IS rather
 * than what it merely mentions.
 */

/** Verdicts, from most to least usable. */
const OK = "ok";
const GONE = "gone"; // 404/410, or the page says it is not a page
const UNAVAILABLE = "unavailable"; // real page, product no longer purchasable
const UNREACHABLE = "unreachable"; // timeout, DNS, TLS — says nothing about the URL

/**
 * Phrases that mean "this is not the page you asked for", matched against the
 * title and first h1 only.
 *
 * Anchored to whole phrases rather than substrings: "not found" catches "Page
 * not found" and "Product not found", but a title like "Notfoundry Ceramics"
 * must not match.
 */
const GONE_PHRASES = [
  /\bpage not found\b/i,
  /\bproduct not found\b/i,
  /\b404\b[^0-9]*\b(error|not found|page)\b/i,
  /\berror 404\b/i,
  /\bthis page (?:does ?n[o']t exist|is unavailable|has been removed)\b/i,
  /\bwe can[o']?t find (?:that|this) page\b/i,
  /\bnothing (?:was )?found\b/i,
];

const UNAVAILABLE_PHRASES = [
  /\bno longer available\b/i,
  /\bcurrently unavailable\b/i,
  /\bout of stock\b/i,
  /\bsold out\b/i,
  /\bthis item is (?:not|un)available\b/i,
  /\bdiscontinued\b/i,
  /\blisting (?:has )?ended\b/i,
];

const tagText = (html, tag) => {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]{0,300}?)</${tag}>`, "i").exec(html || "");
  return m ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
};

/**
 * Classify one fetched page.
 *
 * @param {object} r
 * @param {number} r.status      HTTP status after redirects
 * @param {string} r.requestedUrl
 * @param {string} r.finalUrl    where the redirects landed
 * @param {string} r.html        the first few KB of the body — enough for <head>
 * @returns {{verdict: string, reason: string}}
 */
function classifyPage({ status, requestedUrl, finalUrl, html = "" } = {}) {
  if (status === 404 || status === 410) return { verdict: GONE, reason: `HTTP ${status}` };

  // 401/403 are not evidence about the page. Plenty of real sources sit behind
  // a paywall or a bot check and are perfectly good citations for a human.
  if (status === 401 || status === 403) return { verdict: OK, reason: `HTTP ${status}, still a real page` };

  if (status >= 500) return { verdict: UNREACHABLE, reason: `HTTP ${status}` };
  if (status < 200 || status >= 400) return { verdict: UNREACHABLE, reason: `HTTP ${status}` };

  // A DEEP url that lands on the site root is the classic soft-404: the product
  // is gone and the server bounced to the homepage. A shallow url redirecting
  // to root is just canonicalisation and means nothing.
  if (requestedUrl && finalUrl) {
    try {
      const from = new URL(requestedUrl);
      const to = new URL(finalUrl);
      const fromDepth = from.pathname.split("/").filter(Boolean).length;
      const toDepth = to.pathname.split("/").filter(Boolean).length;
      if (fromDepth >= 2 && toDepth === 0 && from.host === to.host) {
        return { verdict: GONE, reason: "redirected to the site root" };
      }
    } catch {
      /* an unparseable pair is not evidence of anything */
    }
  }

  const title = tagText(html, "title");
  const h1 = tagText(html, "h1");
  const headline = `${title} ${h1}`.trim();

  if (headline) {
    for (const re of GONE_PHRASES) {
      if (re.test(headline)) return { verdict: GONE, reason: `page says: ${title || h1}` };
    }
    for (const re of UNAVAILABLE_PHRASES) {
      if (re.test(headline)) return { verdict: UNAVAILABLE, reason: `page says: ${title || h1}` };
    }
  }

  return { verdict: OK, reason: `HTTP ${status}` };
}

/**
 * Check a batch of URLs concurrently.
 *
 * @param {string[]} urls
 * @param {object} deps
 * @param {Function} deps.fetchPage  async (url) => {status, finalUrl, html}; throws on network failure
 * @param {Function} [deps.assertSafeUrl]  SSRF guard. Search results are
 *        third-party URLs and fetching them server-side is request forgery
 *        surface exactly like read_url is, so the same guard applies.
 * @param {number} [deps.concurrency]
 * @returns {Promise<Map<string, {verdict, reason}>>}
 */
async function checkLinks(urls, { fetchPage, assertSafeUrl, concurrency = 6 } = {}) {
  const unique = [...new Set((urls || []).filter((u) => typeof u === "string" && u))];
  const out = new Map();

  const one = async (url) => {
    if (assertSafeUrl) {
      try {
        await assertSafeUrl(url);
      } catch (err) {
        // A blocked URL is not "dead" — it is one we refuse to fetch. Dropping
        // it from an answer is right, but the reason is ours, not the page's.
        out.set(url, { verdict: GONE, reason: `refused: ${err.message}` });
        return;
      }
    }
    try {
      const page = await fetchPage(url);
      out.set(url, classifyPage({ ...page, requestedUrl: url }));
    } catch (err) {
      // Our failure to reach it says nothing about whether it works for a
      // reader, so it stays usable — see the bias note at the top.
      out.set(url, { verdict: UNREACHABLE, reason: err.message });
    }
  };

  // A fixed pool rather than Promise.all over everything: six results is fine,
  // but this is called with whatever a search returns and a burst of thirty
  // simultaneous fetches from one request is how you get rate-limited by a CDN.
  const queue = [...unique];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) await one(queue.shift());
    }),
  );

  return out;
}

/** Is this verdict safe to put in front of a user as a source? */
const isCitable = (verdict) => verdict === OK || verdict === UNREACHABLE;

module.exports = { classifyPage, checkLinks, isCitable, OK, GONE, UNAVAILABLE, UNREACHABLE };
