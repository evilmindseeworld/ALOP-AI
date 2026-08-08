/**
 * Everything about "when is now", which nothing in this app used to know.
 *
 * THE BUG THIS EXISTS FOR. Not one prompt in the codebase stated the date.
 * Every model therefore answered from the only sense of "now" it has — the day
 * its training data stopped — and there is no way to tell from the outside that
 * this is happening, because a confidently outdated answer is shaped exactly
 * like a correct one. It shows up as "the latest version is X" where X shipped
 * two years ago, and as a search result from 2024 being read as current news.
 *
 * The date is not the only half. A model that knows today's date but is handed
 * search snippets with no dates on them still cannot tell which source is
 * current, and a search API asked for "the best laptop" with no freshness
 * window will happily return a well-linked review from three years ago —
 * age is what most ranking signals REWARD.
 *
 * So there are three jobs here and they are separate on purpose:
 *
 *   1. Say what day it is, in a form a model reads as authoritative.
 *   2. Decide whether a question is actually about the present. Most are not,
 *      and forcing a freshness window on "how does TCP slow start work" throws
 *      away the good sources for no reason.
 *   3. Normalise the published date a provider gives back, so it can travel
 *      with the snippet into the prompt.
 *
 * All pure: a clock comes in as an argument, never read from the ambient one.
 * That is what makes any of this testable — a function that calls `new Date()`
 * internally can only be tested on the day someone runs the suite.
 */

/**
 * The line that goes at system position in every prompt a user's words reach.
 *
 * Spelled out rather than ISO. `2026-08-08` is read by a model as a string in
 * a field; "Saturday, 8 August 2026" is read as a fact about the world, and the
 * weekday makes relative phrasing ("this weekend", "yesterday") resolvable
 * instead of guessed.
 *
 * The instruction after it is the part that actually changes answers. Knowing
 * the date does not stop a model from asserting a stale fact — it has to be
 * told that its own training is the suspect source and that dated evidence
 * outranks it. "Say how current it is" is deliberately phrased as an obligation
 * on the answer rather than a caveat to add when unsure, because a model that
 * is confidently wrong is never unsure.
 *
 * @param {Date} [now]
 * @returns {string}
 */
function todayLine(now = new Date()) {
  const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const formatted = date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    `Today's date is ${formatted}. Your training data is older than this and you cannot tell how much older. ` +
    `Anything that changes over time — versions, prices, prime ministers, who owns what, what is "the latest" — ` +
    `is a fact you do not currently know unless it appears in provided sources. ` +
    `When you state something time-dependent, say what it is current as of. Never present recalled information as up to date.`
  );
}

/**
 * Phrases that mean the answer depends on the present moment.
 *
 * Word-bounded, and the boundaries are load-bearing: unbounded `new` matched
 * "news", "newton" and "renewable"; unbounded `now` matched "know", "known" and
 * "nowhere", which is most sentences. That failure mode is silent and expensive
 * — every question gets a freshness window, the window discards the best
 * sources, and answers get WORSE while looking like they tried harder.
 *
 * Deliberately NOT here: "best", "compare", "review", "vs". They correlate with
 * time-sensitivity but they are not it — "best sorting algorithm for nearly
 * sorted data" has an answer from 1959. Recall is not the goal; a question this
 * misses simply gets an ordinary search, which is what it gets today.
 */
const RECENCY_RE =
  /\b(today|todays|tonight|yesterday|currently|current|right now|at the moment|this (week|month|year|morning|evening)|latest|newest|most recent|up to date|up-to-date|so far|as of|just (released|announced|launched)|recent|recently|202\d|20[3-9]\d|news|breaking|update[sd]?|release[sd]?|launch(ed|ing)?|announce[sd]?|price[sd]?|pricing|cost|stock|share price|who is the (current|new)|still (works|working|available|alive|open|maintained|supported|free|around))\b/i;

/**
 * Whether the question is about the present.
 * @param {string} text
 * @returns {boolean}
 */
function isTimeSensitive(text) {
  return RECENCY_RE.test(typeof text === "string" ? text : "");
}

/**
 * Phrases that mean the answer is about the last day or two, not the last year.
 *
 * Separated from the test above because the window matters as much as having
 * one. Asking a search API for the past DAY on "latest iPhone" returns whatever
 * blogs posted this morning and misses the announcement; asking for the past
 * YEAR on "earthquake in Tokyo" returns a different earthquake.
 */
const BREAKING_RE = /\b(today|todays|tonight|right now|breaking|just (released|announced|launched|happened)|this morning|this evening|yesterday)\b/i;

/**
 * How far back a provider should be told to look, or null for no restriction.
 *
 * Returned as neutral units and translated per provider at the call site,
 * because the three APIs disagree about the spelling of the same idea: Brave
 * wants `pd`/`pw`/`pm`/`py`, Google CSE wants `d1`/`w1`/`m1`/`y1`, Tavily wants
 * a day count. Keeping the decision here and the spelling there means the rule
 * is testable without mocking three HTTP APIs.
 *
 * A YEAR is the default window rather than a month, and that is the
 * conservative choice: a month is narrow enough to return nothing at all on a
 * quiet topic, and an empty result set is a worse answer than a nine-month-old
 * one. The narrow window is reserved for questions that explicitly say "today".
 *
 * @param {string} text
 * @returns {{days: number, label: string}|null}
 */
function freshnessWindow(text) {
  const s = typeof text === "string" ? text : "";
  if (!isTimeSensitive(s)) return null;
  if (BREAKING_RE.test(s)) return { days: 2, label: "day" };
  return { days: 365, label: "year" };
}

/** Brave's `freshness` parameter. */
const BRAVE_FRESHNESS = { day: "pd", week: "pw", month: "pm", year: "py" };
/** Google Custom Search's `dateRestrict` parameter. */
const GOOGLE_DATE_RESTRICT = { day: "d1", week: "w1", month: "m1", year: "y1" };

/**
 * A provider's published date, as a short string a model can compare, or "".
 *
 * Providers disagree: Brave sends `page_age` as ISO and `age` as prose ("3 days
 * ago"), Tavily sends `published_date` in a couple of shapes, Google sends
 * nothing reliable. Anything unparseable returns "" rather than a guess — an
 * undated source labelled with a wrong date is worse than an undated source,
 * because the label is what the model will trust.
 *
 * Future dates are rejected for the same reason. They are common in scraped
 * metadata (a copyright year, a scheduled post) and a source stamped next year
 * would outrank every genuinely current one.
 *
 * @param {*} raw
 * @param {Date} [now]
 * @returns {string} `YYYY-MM-DD`, or "" when there is nothing trustworthy
 */
function normalizeDate(raw, now = new Date()) {
  if (!raw || typeof raw !== "string") return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const ref = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  // One day of slack: a source published hours ago in a timezone ahead of UTC
  // is legitimately "tomorrow" by this clock.
  if (parsed.getTime() > ref.getTime() + 24 * 60 * 60 * 1000) return "";
  // Nothing before the web existed. Catches epoch-zero defaults and two-digit
  // year misparses, both of which would read as "extremely stale".
  if (parsed.getUTCFullYear() < 1991) return "";
  /* Local calendar day, NOT toISOString().slice(0, 10).
   *
   * A date-only string parses as LOCAL midnight, so on any host west of UTC
   * `toISOString` rolls it back a day: "July 30, 2026" came out as 2026-07-29.
   * A source dated one day early is not a crisis on its own, but it is a wrong
   * label, and the whole reason these dates exist is that the model trusts the
   * label over the content.
   *
   * en-CA is ISO-shaped by definition, which is why it is used rather than
   * assembling the parts by hand. The remaining timezone slop is a few hours on
   * a value only ever compared at day precision — "is this source old" does not
   * turn on which side of midnight it landed. */
  return parsed.toLocaleDateString("en-CA");
}

/**
 * The dated header for one search result as it appears in the prompt.
 *
 * An undated source says so IN WORDS rather than being left blank. A blank is
 * ambiguous between "we don't know" and "there was nothing to say", and the
 * model resolves that ambiguity in whichever direction suits the answer it was
 * already going to give.
 *
 * @param {string} iso  output of normalizeDate
 * @returns {string}
 */
function dateLabel(iso) {
  return iso ? `Published: ${iso}` : "Published: unknown — treat as undated";
}

module.exports = {
  todayLine,
  isTimeSensitive,
  freshnessWindow,
  normalizeDate,
  dateLabel,
  BRAVE_FRESHNESS,
  GOOGLE_DATE_RESTRICT,
  RECENCY_RE,
};
