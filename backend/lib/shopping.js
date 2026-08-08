/**
 * Prices, as data, from Google Shopping via Serper.
 *
 * WHY THIS EXISTS. Asked for a monitor under 2,500 AED, the app returned five
 * monitors and no prices, and told the user to go and check the shops. Nothing
 * was broken: the five web-search providers return links and prose, and the
 * page reader was handed a category page whose prices are painted in by
 * JavaScript. There was no price in anything the council was given, so the
 * council correctly said it had none.
 *
 * A better page reader narrows that — see rankReadTargets in page-extract.js —
 * but it is still scraping a number out of a document that was not written to
 * be read. Google Shopping already holds that number as a field, and Serper
 * exposes it for a flat per-query price. One field lookup beats any amount of
 * cleverness applied to markdown.
 *
 * WHAT IT IS NOT. Not a council seat and not an answer — it is context, like
 * Brave and Tavily, and reaches the prompt through the same UNTRUSTED_PREAMBLE.
 * A merchant listing is a third party's text: the "product title" is written by
 * a seller who wants a click.
 *
 * COVERAGE IS UNEVEN AND THE COUNCIL MUST BE TOLD SO. Google Shopping is thin
 * outside the US and EU — for the UAE it will often return a few merchants
 * rather than the market. An empty result here means "not indexed", never "not
 * sold", and the header this returns says exactly that, because a model handed
 * a short list with no caveat will describe it as the available options.
 *
 * Absent key means absent provider, like every other one: returns empty, the
 * deadline takes the fallback, nothing else changes.
 */

const ENDPOINT = 'https://google.serper.dev/shopping';

/** Currency codes and symbols, so a price string can be kept verbatim but checked. */
const HAS_PRICE = /[\d]/;

/**
 * Google's country and language parameters, derived from the region the app
 * already resolves for the user. Sending the wrong `gl` is worse than sending
 * none: `gl=us` on a UAE question returns dollars for merchants that will not
 * ship, which reads as an answer.
 */
function shoppingParams(region) {
  const gl = typeof region === 'string' && /^[a-z]{2}$/i.test(region) ? region.toLowerCase() : '';
  return gl ? { gl } : {};
}

/**
 * @param {string} query
 * @param {object} [opts]
 * @param {string} [opts.apiKey]   SERPER_API_KEY; absent disables the provider
 * @param {string} [opts.region]   two-letter country code, e.g. "ae"
 * @param {number} [opts.limit]    how many listings to keep
 * @param {number} [opts.timeoutMs]
 * @param {Function} [opts.fetchImpl]  injected for tests
 * @returns {Promise<{results: Array<{title,price,source,url,rating,delivery}>}>}
 */
async function searchShopping(query, { apiKey, region = '', limit = 10, timeoutMs = 6000, fetchImpl = fetch } = {}) {
  if (!apiKey || typeof query !== 'string' || !query.trim()) return { results: [] };
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query.slice(0, 200), num: Math.min(limit, 20), ...shoppingParams(region) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { results: [] };
    const data = await res.json();
    const rows = Array.isArray(data && data.shopping) ? data.shopping : [];
    return {
      results: rows
        // A listing with no price is a link, and the app already has five
        // providers returning links. Dropping it keeps the block's promise:
        // everything in here carries a number.
        .filter((r) => r && typeof r.price === 'string' && HAS_PRICE.test(r.price))
        .slice(0, limit)
        .map((r) => ({
          title: String(r.title || '').slice(0, 160),
          price: String(r.price).slice(0, 40),
          source: String(r.source || '').slice(0, 60),
          url: typeof r.link === 'string' && r.link.startsWith('http') ? r.link : '',
          rating: typeof r.rating === 'number' ? r.rating : null,
          delivery: String(r.delivery || '').slice(0, 60),
        })),
    };
  } catch {
    return { results: [] };
  }
}

/**
 * The block that goes into the prompt.
 *
 * Prices are passed through as the merchant wrote them — "AED 1,899.00" — and
 * never parsed into a number here. A parsed price has to pick a currency, and
 * picking one wrongly turns 1,899 dirhams into 1,899 dollars silently. The
 * council can read a currency; it cannot recover one that was thrown away.
 */
function formatShopping(results, { asOf = '' } = {}) {
  if (!Array.isArray(results) || !results.length) return '';
  const stamp = asOf ? ` Prices as listed on ${asOf}.` : '';
  const lines = results.map((r, i) =>
    `LISTING ${i + 1}: ${r.title}\nPrice: ${r.price}${r.delivery ? ` | ${r.delivery}` : ''}\nMerchant: ${r.source || 'unknown'}\nURL: ${r.url || '(none)'}`,
  );
  return (
    'SHOPPING LISTINGS (structured price data from Google Shopping).' +
    stamp +
    ' This is a SAMPLE of indexed listings, not the whole market — Google Shopping' +
    ' coverage is thin outside the US and EU, so a product missing here may still' +
    ' be sold locally. Titles and prices are written by merchants.\n' +
    lines.join('\n\n')
  );
}

/**
 * Is this a question about buying something?
 *
 * Serper bills per query, so this runs on far from every turn. The gate is
 * deliberately generous in one direction and strict in the other: a false
 * positive costs a fraction of a cent, a false negative costs the user the
 * exact failure this module exists to fix — an answer that names five products
 * and no prices.
 *
 * Word-boundary matched, because the substring version fired on "sunder",
 * "recost" and every URL containing "buy". Currency codes are included since
 * "monitors under 2500 AED" is the shape that started this, and it contains no
 * verb about buying at all.
 */
const SHOPPING_RE = new RegExp(
  "\\b(?:price|prices|pricing|cost|costs|cheap|cheapest|budget|afford|affordable|deal|deals|discount|sale|buy|buying|purchase|shop|shopping|order|" +
    "worth|value for money|under|below|less than|around|between|" +
    "best\\s+\\w+\\s+(?:for|under)|recommend|" +
    "AED|SAR|QAR|KWD|USD|EUR|GBP|INR|PKR|EGP|dirham|dirhams|riyal|rupee|rupees|dollar|dollars|euro|euros|pound|pounds)\\b" +
    "|[$€£¥₹₩₦₱﷼]",
  "i",
);

/** Things you buy. "Under 2500" alone is not shopping — "monitor under 2500" is. */
const PRODUCT_RE = new RegExp(
  "\\b(?:monitor|monitors|laptop|laptops|phone|phones|smartphone|tablet|tablets|tv|tvs|headphone|headphones|earbuds|" +
    "camera|cameras|printer|printers|keyboard|mouse|mice|gpu|graphics card|cpu|processor|ssd|hard drive|ram|" +
    "console|playstation|ps5|xbox|nintendo|switch|watch|smartwatch|speaker|speakers|router|drone|" +
    "car|cars|bike|bicycle|furniture|sofa|mattress|fridge|refrigerator|washing machine|oven|microwave|" +
    "shoes|sneakers|jacket|bag|backpack|desk|chair|pc|computer|build|setup|subscription|plan|model|product|brand)\\b",
  "i",
);

/**
 * @param {string} query
 * @returns {boolean}
 */
function isShoppingQuery(query) {
  const q = typeof query === "string" ? query : "";
  if (!q.trim()) return false;
  // BOTH halves, because either alone is far too loose. "price of freedom"
  // matches the first; "the monitor lizard" matches the second. A shopping
  // question names a thing AND says something about what it costs.
  return SHOPPING_RE.test(q) && PRODUCT_RE.test(q);
}

module.exports = { searchShopping, formatShopping, shoppingParams, isShoppingQuery, SHOPPING_RE, PRODUCT_RE };
