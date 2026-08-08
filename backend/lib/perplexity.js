/**
 * Reading a Perplexity Sonar response.
 *
 * The call itself lives in server.js, which owns the fetch and the key. This is
 * the part that can be handed an object and checked, and it exists as its own
 * file for one reason: **Sonar has shipped two different citation shapes**, and
 * reading only one of them loses every source without failing.
 *
 *   search_results: [{ title, url, date }]   newer, and the useful one
 *   citations:      ["https://…", "https://…"]   older, bare URLs
 *
 * A response carrying only `citations` read through the `search_results` path
 * yields an answer with no sources at all — which looks like a model that
 * invented something, not like a parser that missed a field. Both are read, the
 * richer one wins, and the failure mode is an empty list rather than a throw.
 */

/** Past what the council is ever shown. More is prompt weight for nothing. */
const MAX_SOURCES = 8;

/**
 * @param {unknown} data a parsed Sonar response body.
 * @param {(d: unknown) => string} normalizeDate the shared date normaliser, so
 *   a Sonar date is labelled by exactly the same rules as a Brave or Tavily one
 *   — an undated source says so rather than being given a guessed date.
 * @returns {{answer: string, results: Array<{title: string, url: string, date: string}>}}
 */
function readSonar(data, normalizeDate = () => "") {
  if (!data || typeof data !== "object") return { answer: "", results: [] };

  const answer = String(data.choices?.[0]?.message?.content || "").slice(0, 4000);

  const structured = Array.isArray(data.search_results) ? data.search_results : [];
  if (structured.length) {
    return {
      answer,
      results: structured
        .filter((r) => r && typeof r.url === "string" && r.url)
        .slice(0, MAX_SOURCES)
        .map((r) => ({
          title: String(r.title || "").slice(0, 200),
          url: r.url,
          date: normalizeDate(r.date || r.published_date) || "",
        })),
    };
  }

  const bare = Array.isArray(data.citations) ? data.citations : [];
  return {
    answer,
    results: bare
      .filter((u) => typeof u === "string" && u)
      .slice(0, MAX_SOURCES)
      .map((url) => ({ title: "", url, date: "" })),
  };
}

module.exports = { readSonar, MAX_SOURCES };
