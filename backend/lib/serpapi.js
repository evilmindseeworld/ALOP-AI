/**
 * SerpApi: one endpoint, many engines.
 *
 * THE THING THAT MAKES THIS SMALL. SerpApi's dashboard lists ~110 "APIs" —
 * Google Flights API, Yelp Reviews API, YouTube Video Transcript API — and they
 * are not 110 integrations. They are ONE URL, `serpapi.com/search`, with a
 * different `engine=` value and mostly the same parameters. So "wire all of
 * them" is a table, and the interesting work is not the wiring at all: it is
 * deciding which engine a question needs, and stopping a model inventing one.
 *
 * WHY THIS IS ONE COUNCIL TOOL AND NOT 110. Every tool a registry offers has
 * its name and description injected into the prompt of every seat on every
 * turn. At roughly ten words each, 110 tools is about 1,500 tokens per seat per
 * turn — seven seats, every conversation, to describe flight search to someone
 * asking about a monitor. One tool with an `engine` argument costs one
 * description, and the engine list below is the part that grows.
 *
 * WHY THE ENGINE LIST IS AN ALLOWLIST. A model that guesses `engine=google_cars`
 * produces a 400 from SerpApi — which is BILLED, because the request reached
 * them. An unknown engine must fail here, before the network, for the same
 * reason the registry validates arguments at all.
 *
 * EVERY CALL COSTS MONEY. SerpApi bills per search and the free tier is 100 a
 * month, which is roughly two conversations if the council gets enthusiastic.
 * The 8-call ceiling in the agent loop is what keeps this bounded, and it is
 * load-bearing here in a way it was not for the free providers.
 *
 * WHAT THIS DOES NOT DO. It does not parse prices into numbers, for the reason
 * given in shopping.js: picking a currency wrongly turns 1,899 dirhams into
 * 1,899 dollars in silence. Everything is passed through as the source wrote it.
 */

const ENDPOINT = "https://serpapi.com/search.json";
const { timeoutSignal } = require("./abort");

/**
 * The engines worth offering, and what each is FOR.
 *
 * Curated, not exhaustive, and that is the deliberate part. Adding one is a
 * single line here — but every line is prompt tokens on every turn forever, so
 * a line has to earn itself by covering a question shape that no other engine
 * covers. `google_shopping` and `bing_shopping` answer the same question; only
 * one is here.
 *
 * `results` names the field the engine puts its list in, because SerpApi's
 * response key varies per engine and this is the whole of that difference.
 */
const ENGINES = {
  google_shopping: { results: "shopping_results", use: "product prices across merchants" },
  google_local: { results: "local_results", use: "nearby businesses, addresses, opening hours" },
  google_news: { results: "news_results", use: "news stories on a topic" },
  google_scholar: { results: "organic_results", use: "academic papers and citations" },
  google_patents: { results: "organic_results", use: "patents" },
  google_jobs: { results: "jobs_results", use: "job listings" },
  google_flights: { results: "best_flights", use: "flight prices and times (needs departure_id, arrival_id, outbound_date)" },
  google_hotels: { results: "properties", use: "hotel prices and availability (needs check_in_date, check_out_date)" },
  google_finance: { results: "markets", use: "share prices, tickers, market movement" },
  google_trends: { results: "interest_over_time", use: "search interest over time" },
  google_events: { results: "events_results", use: "events happening somewhere" },
  google_play: { results: "organic_results", use: "Android apps" },
  google_images: { results: "images_results", use: "images of a thing" },
  google_videos: { results: "video_results", use: "videos on a topic" },
  youtube: { results: "video_results", use: "YouTube videos" },
  amazon: { results: "organic_results", use: "Amazon listings and prices" },
  ebay: { results: "organic_results", use: "eBay listings, including used prices" },
  walmart: { results: "organic_results", use: "Walmart listings and prices" },
  home_depot: { results: "products", use: "hardware, tools, building materials" },
  apple_app_store: { results: "organic_results", use: "iOS apps" },
  yelp: { results: "organic_results", use: "restaurant and business reviews" },
  tripadvisor: { results: "organic_results", use: "hotel and attraction reviews" },
  google_maps: { results: "local_results", use: "places on a map, with ratings" },
  google_maps_reviews: { results: "reviews", use: "reviews of one specific place (needs place_id or data_id)" },
  google_autocomplete: { results: "suggestions", use: "what people actually search for around a term" },
  google_related_questions: { results: "related_questions", use: "the questions people ask about a topic" },
  yandex: { results: "organic_results", use: "search with Russian-language coverage" },
  baidu: { results: "organic_results", use: "search with Chinese-language coverage" },
  naver: { results: "organic_results", use: "search with Korean-language coverage" },
  duckduckgo: { results: "organic_results", use: "general web search, no personalisation" },
};

/** The engine names, for validation and for the tool description. */
const ENGINE_NAMES = Object.keys(ENGINES);

/**
 * Parameters an engine is allowed to receive beyond `q`.
 *
 * An allowlist rather than a pass-through of whatever the model wrote, because
 * these become query-string parameters on a billed third-party request. A
 * model that invents `api_key` or `num=10000` should not be able to send it.
 */
const ALLOWED_PARAMS = new Set([
  "location", "gl", "hl", "device",
  "departure_id", "arrival_id", "outbound_date", "return_date",
  "check_in_date", "check_out_date", "adults",
  "place_id", "data_id", "sort_by", "type", "num",
]);

/**
 * Fields worth showing, in the order a reader wants them.
 *
 * One renderer for every engine instead of 110 shaped ones. The engines share
 * far more vocabulary than the dashboard's naming suggests — nearly all of them
 * use some subset of title/name, price, link, snippet, rating, source. A field
 * an engine does not have is simply absent, which is what makes the generic
 * version hold.
 */
const FIELDS = [
  ["title", "name"],
  ["price", "extracted_price", "total_price", "rate_per_night"],
  ["rating", "reviews"],
  ["source", "seller", "publisher", "address"],
  ["snippet", "description", "summary"],
  ["date", "published_date", "departure_time"],
  ["link", "url", "product_link"],
];

/** Pull the first present field from an alias group, stringified and bounded. */
const pick = (row, names) => {
  for (const n of names) {
    const v = row[n];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "object") {
      // Prices and hotel rates arrive as {value, extracted_value} or similar.
      const inner = v.value ?? v.lowest ?? v.raw ?? null;
      if (inner === null || typeof inner === "object") continue;
      return String(inner).slice(0, 200);
    }
    return String(v).slice(0, 200);
  }
  return "";
};

/**
 * Render one engine's rows as text for a prompt.
 *
 * @param {Array} rows
 * @param {number} limit
 */
function formatRows(rows, limit = 8) {
  return rows
    .slice(0, limit)
    .map((row, i) => {
      if (!row || typeof row !== "object") return "";
      const parts = FIELDS.map((names) => pick(row, names)).filter(Boolean);
      return parts.length ? `${i + 1}. ${parts.join("\n   ")}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Find the list in a SerpApi response.
 *
 * Prefers the key the engine table names, then falls back across the keys
 * SerpApi actually uses. The fallback matters because engines change their
 * primary key without warning — `google_flights` returns `best_flights` most of
 * the time and only `other_flights` when nothing scored well, and an answer
 * that says "no flights found" because of a key name is the silent failure this
 * whole file exists to avoid.
 */
function extractRows(data, preferred) {
  if (!data || typeof data !== "object") return [];
  const candidates = [
    preferred,
    "shopping_results", "organic_results", "local_results", "news_results",
    "video_results", "jobs_results", "events_results", "properties",
    "best_flights", "other_flights", "products", "reviews", "images_results",
    "suggestions", "related_questions", "markets", "interest_over_time",
  ];
  for (const key of candidates) {
    if (key && Array.isArray(data[key]) && data[key].length) return data[key];
  }
  return [];
}

/**
 * @param {object} opts
 * @param {string} opts.engine   must be a key of ENGINES
 * @param {string} opts.query
 * @param {object} [opts.params] extra engine parameters, filtered by ALLOWED_PARAMS
 * @param {string} opts.apiKey
 * @param {number} [opts.timeoutMs]
 * @param {Function} [opts.fetchImpl]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ok: boolean, engine: string, rows: Array, text: string, error: string}>}
 */
async function searchSerpApi({ engine, query, params = {}, apiKey, timeoutMs = 8000, fetchImpl = fetch, signal } = {}) {
  const miss = (error) => ({ ok: false, engine: engine || "", rows: [], text: "", error });

  if (!apiKey) return miss("SerpApi is not configured.");
  if (!ENGINES[engine]) {
    // Named explicitly rather than "invalid engine": a model that is told what
    // IS available picks a real one next round, and rounds are the budget.
    return miss(`Unknown engine "${engine}". Available: ${ENGINE_NAMES.join(", ")}.`);
  }
  const q = typeof query === "string" ? query.trim() : "";
  // google_maps_reviews takes a place_id and no query, so an empty q is only
  // fatal when there is nothing else to identify what was asked for.
  const extra = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (!ALLOWED_PARAMS.has(k)) continue;
    if (v === undefined || v === null || v === "") continue;
    extra[k] = String(v).slice(0, 100);
  }
  if (!q && !extra.place_id && !extra.data_id) return miss("A query is required.");

  const url = new URL(ENDPOINT);
  url.searchParams.set("engine", engine);
  if (q) url.searchParams.set("q", q.slice(0, 300));
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", apiKey);

  const timed = timeoutSignal(signal, timeoutMs);
  try {
    const res = await fetchImpl(url.toString(), { signal: timed.signal });
    if (!res.ok) return miss(`${engine} returned HTTP ${res.status}.`);
    const data = await res.json();
    // SerpApi reports its own failures with 200 and an `error` field. Treating
    // that as success gives the council an empty list and no reason for it.
    if (data && typeof data.error === "string" && data.error) return miss(`${engine}: ${data.error}`);
    const rows = extractRows(data, ENGINES[engine].results);
    if (!rows.length) return miss(`${engine} found nothing for "${q}".`);
    return { ok: true, engine, rows, text: formatRows(rows), error: "" };
  } catch (err) {
    return miss(`${engine} failed: ${err.name === "TimeoutError" ? "timed out" : "request failed"}.`);
  } finally {
    timed.dispose();
  }
}

/** The engine menu, as it appears in the tool description. */
const engineMenu = () => ENGINE_NAMES.map((n) => `${n} (${ENGINES[n].use})`).join("; ");

module.exports = { searchSerpApi, ENGINES, ENGINE_NAMES, engineMenu, formatRows, extractRows };
