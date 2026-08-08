/**
 * Turning the router model's reply into the searches to actually run.
 *
 * WHY THIS IS MORE THAN A `.trim()`. The search decision used to be one line
 * in, one query out: whatever the model said became the query verbatim. That
 * shape cannot research anything. A question with two halves — "is the Framework
 * 16 still being made, and what does it cost here" — got ONE query, so one half
 * was answered from the model's own memory while the other had sources, and the
 * answer read as equally confident about both.
 *
 * Letting the model emit up to two queries is the smallest change that makes it
 * research rather than look up. Two, not five: the fan-out behind each query is
 * five providers on a shared deadline, they run concurrently so the wall clock
 * is unchanged, but the provider quota and token cost are not free. Two covers
 * the common shape — the thing itself, and the thing's current status — and
 * anything wider is a different feature.
 *
 * Pure, and separate from the model call, because everything that can actually
 * be wrong here is parsing: a model that numbers its list, quotes its output,
 * repeats itself, says "NO" as one of two lines, or writes a paragraph. Each of
 * those failures is silent — the search runs, it just runs on garbage — so each
 * one gets a test rather than a hope.
 */

/** Longer than any real query; the providers themselves cut off around here. */
const MAX_QUERY_LEN = 200;
const MAX_QUERIES = 2;

/**
 * Strip the decoration a model puts around a list item.
 *
 * Ordered so numbering goes before quotes: `1. "iphone 17 price"` has both, and
 * removing the quotes first leaves the `1.` glued to an opening quote that is
 * no longer there to anchor the pattern.
 */
const clean = (line) =>
  String(line)
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
    .replace(/^\s*(?:query\s*\d*\s*:)\s*/i, "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim()
    .slice(0, MAX_QUERY_LEN);

/**
 * @param {string} raw  the model's reply
 * @returns {string[]|null}  queries to run, or null for "no search needed"
 */
function parseSearchPlan(raw) {
  const text = typeof raw === "string" ? raw : "";
  const lines = text
    .split("\n")
    .map(clean)
    .filter(Boolean);

  const queries = [];
  const seen = new Set();
  for (const line of lines) {
    /* A bare "NO" ANYWHERE in the reply means no search, even when other lines
     * followed it. A model that answers "NO\nBut you could search for X" is
     * expressing a decision and then musing; treating the musing as a query
     * searches for things the model just said were unnecessary. The check is
     * for the whole line so that a query legitimately containing the word — "no
     * fault divorce uk" — is not discarded. */
    if (/^no[.!]?$/i.test(line)) return null;
    /* A sentence is not a query. When the model explains itself instead of
     * complying ("This question does not require a web search because...") the
     * text is not something to send to a search API, and sending it returns
     * results about the explanation. Ten words is well past any real query and
     * well under any real sentence of refusal. */
    if (line.split(/\s+/).length > 10) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(line);
    if (queries.length >= MAX_QUERIES) break;
  }

  return queries.length ? queries : null;
}

module.exports = { parseSearchPlan, MAX_QUERIES, MAX_QUERY_LEN };
