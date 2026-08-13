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
 * A model answering in its NATIVE TOOL-CALL SYNTAX instead of in plain text.
 *
 * Observed in production on 2026-08-12, from `google/gemma-4-26b-a4b-it:free`
 * asked for a search query about a monitor model number:
 *
 *   <|tool_call>call:google_search:search{queries:["ASUS ROG XG27AQWMG specs price"]}<tool_call|>
 *
 * It happened on two of four phrasings of the same question and not on the
 * other two, so it is a coin-flip rather than a property of the prompt. Gemma 4
 * advertises native function calling; asked to "reply with the search queries",
 * it sometimes reaches for the mechanism it has for exactly that.
 *
 * WITHOUT THIS, THE WHOLE BLOB WENT TO THE SEARCH API AS THE QUERY. It is one
 * line, under ten words, and not "NO", so every guard below passed it through.
 * The user's question then got a web search for a string of control tokens,
 * which returns nothing usable, and the council answered a product it had never
 * heard of from memory — which is the confidently-empty "I do not have
 * sufficient information" the owner reported.
 *
 * SALVAGED RATHER THAN REJECTED, because the model did the hard part correctly:
 * the query inside is good. The quoted strings are pulled out and used. Only if
 * there is nothing quoted is the line dropped — sending the raw tokens is never
 * right, and dropping is at least a silent no-search rather than a search for
 * garbage.
 */
const TOOL_CALL_RE = /<\|?\s*tool_call|tool_call\s*\|?>|\bcall:[\w.-]+:[\w.-]+|["']?queries["']?\s*:\s*\[/i;

const unwrapToolCall = (line) => {
  if (!TOOL_CALL_RE.test(line)) return [line];
  /* Anything quoted inside the call. Bounded at MAX_QUERY_LEN so a pathological
   * blob cannot smuggle a huge string past the cap the cleaner applies. */
  const quoted = [...line.matchAll(/["']([^"']{2,200})["']/g)]
    .map((m) => m[1].trim())
    .filter((q) => q && !TOOL_CALL_RE.test(q));
  return quoted.length ? quoted.map((q) => q.slice(0, MAX_QUERY_LEN)) : [];
};

/**
 * @param {string} raw  the model's reply
 * @returns {string[]|null}  queries to run, or null for "no search needed"
 */
function parseSearchPlan(raw) {
  const text = typeof raw === "string" ? raw : "";
  const lines = text
    .split("\n")
    .flatMap((line) => unwrapToolCall(String(line)))
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
    /* THE MODEL ANSWERING INSTEAD OF PLANNING, which is the failure mode that
     * degraded every question rather than one. Measured against the old prompt:
     * six of nine cases came back as the ANSWER — "12" for a percentage, a line
     * of haiku for a poem request, "### 1. The Competitive/Esports Choice" for a
     * product question — and each went to the search providers as the query.
     *
     * The prompt now demonstrates the format and scores 9/9, so this is the
     * second line rather than the fix. It is worth having because the failure is
     * SILENT: the search still returns something, the council still answers, and
     * nothing anywhere says the query was a fragment of an answer.
     *
     * Only shapes that no real query can take. A heading, LaTeX and a prose
     * opener are never how a person types into a search box, whereas a bare
     * number or a short noun phrase legitimately is — so those are left alone
     * rather than guessed at. */
    if (/^#{1,6}\s/.test(line)) continue;
    if (/\$[^$]{1,}\$/.test(line)) continue;
    if (/^(here (is|are)|here's|sure|certainly|okay|of course|i (can|would|will))\b/i.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(line);
    if (queries.length >= MAX_QUERIES) break;
  }

  return queries.length ? queries : null;
}

/**
 * ONE ROUTER REPLY, TWO DECISIONS.
 *
 * WHY. Every non-greeting turn used to open with TWO calls to the fast model —
 * "is this about an earlier conversation?" and "what should I search for?" —
 * before a single seat was asked anything. They ran concurrently, so the cost
 * was never latency; it was a REQUEST, and requests are what this account runs
 * out of. Sol's optimisation plan ranked combining them second, behind only
 * "measure first", and the risk it named is the one this parser exists to
 * contain: one malformed reply must not damage both decisions.
 *
 * THE OUTPUT CONTRACT IS THREE MUTUALLY EXCLUSIVE BRANCHES, and they were
 * already almost that. The search prompt has always said not to search for "a
 * question about THIS conversation", so a memory question already produced
 * `NO` — the model was being asked to recognise the same case twice and its
 * second answer was thrown away. `MEMORY` simply keeps it.
 *
 * MEMORY IS ACCEPTED ONLY AS THE ENTIRE FIRST LINE, and that is deliberately
 * stricter than how `NO` is read. `NO` is honoured anywhere in the reply
 * because a model that says "NO" and then muses has still decided; a stray
 * `MEMORY` in the middle of a reply is far more likely to be the model
 * discussing the word than routing on it. Getting this wrong sends a live
 * question to the memory branch, which answers from conversation history and
 * cannot search — a confidently empty answer with no error anywhere. So the
 * bar is high, and anything short of it falls through to the search decision,
 * which is the behaviour that existed before.
 *
 * @param {string} raw the model's reply
 * @returns {{memory: boolean, queries: string[]|null}}
 */
function parseRoutePlan(raw) {
  const text = typeof raw === "string" ? raw : "";
  const first = text.split("\n").map(clean).find(Boolean) || "";
  if (/^memory[.!]?$/i.test(first)) return { memory: true, queries: null };
  return { memory: false, queries: parseSearchPlan(text) };
}

module.exports = { parseSearchPlan, parseRoutePlan, MAX_QUERIES, MAX_QUERY_LEN };
