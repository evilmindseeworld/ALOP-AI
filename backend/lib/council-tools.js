/**
 * The plumbing between the council and the agent loop.
 *
 * Both functions here started life inside server.js and were moved out for the
 * same reason everything else lives in lib/: server.js calls process.exit(1) at
 * import time when env vars are missing, so anything defined in it is
 * untestable by construction. The final-round rule below is load-bearing
 * enough that "it looked right" is not good enough for it.
 */

/**
 * First provider that returns anything wins.
 *
 * Deliberately NOT comprehensiveSearch, which fans out to five providers plus
 * Wikipedia for one query. That is right for the one-shot router path and wrong
 * inside a loop that may issue eight queries: the loop's whole cost model is
 * O(unique calls), and quintupling the cost of each one defeats it.
 *
 * A provider that throws is treated as a provider with no results — one dead
 * API key must not take down search.
 */
async function firstWithResults(providers, query) {
  for (const provider of providers || []) {
    let raw;
    try {
      raw = await provider(query);
    } catch {
      continue;
    }
    // Brave and Google CSE return an array; Tavily returns {answer, results}.
    const results = Array.isArray(raw) ? raw : raw && raw.results;
    if (Array.isArray(results) && results.length) return results;
  }
  return [];
}

/**
 * The messages one council member sees in one round.
 *
 * Text protocol only. parseToolRequests already reads native `tool_calls` if a
 * gateway returns them, so switching a model to the native path later is a
 * capability probe and a `tools` array — not a change here.
 *
 * @param {Array} baseMsgs  the normal council messages; [0] must be the system turn
 * @param {{list: Function}} registry
 * @param {{round: number, toolResults: Array, isFinalRound: boolean}} ctx
 */
function toolMessages(baseMsgs, registry, ctx) {
  const { round = 1, toolResults = [], isFinalRound = false, attachedFiles = [] } = ctx || {};
  const base = Array.isArray(baseMsgs) && baseMsgs.length ? baseMsgs : [{ role: "system", content: "" }];
  const head = base[0] && base[0].role === "system" ? base[0].content : "";
  const rest = base[0] && base[0].role === "system" ? base.slice(1) : base;

  const catalogue = (registry.list() || [])
    .map((t) => `- ${t.name}(${Object.keys(t.schema || {}).join(", ")}) — ${t.description}`)
    .join("\n");

  // The final-round instruction is the load-bearing part. Without it a member
  // spends the last round requesting a tool that can never run, and so
  // contributes nothing at all to the synthesis — it neither answered nor
  // researched. The loop passes isFinalRound precisely so this can be said.
  const instruction = isFinalRound
    ? "This is the final round. Do NOT request any more tools — anything you ask for now will not run. Answer with what you have."
    : 'If you need information you do not have, request a tool INSTEAD of answering, by emitting exactly one fenced block:\n\n```tool_call\n{"name": "web_search", "args": {"query": "your query"}}\n```\n\nOtherwise answer normally. Do not do both. Do not request a tool for something you already know.';

  // read_file takes an opaque id, which means the ids have to be KNOWABLE or
  // the tool is unusable — a model cannot guess a UUID. This manifest is the
  // only place they come from, and it is the reason read_file never needs to
  // accept a filename: the model already has the id next to the name.
  const manifest = attachedFiles.length
    ? `\n\n=== ATTACHED FILES ===\n${attachedFiles
        .map((f) => `- id: ${f.id}  name: ${f.name}${f.kind ? `  (${f.kind})` : ""}`)
        .join("\n")}\nUse read_file with the id, exactly as written above.`
    : "";

  const sys = `${head}\n\n=== TOOLS (round ${round}) ===\n${catalogue}${manifest}\n\n${instruction}`;

  if (toolResults.length === 0) return [{ role: "system", content: sys }, ...rest];

  // Results go in as a USER turn, not a system one: they are evidence that
  // arrived after the question was asked, and models weight a late system
  // message inconsistently — some treat it as higher priority than the
  // question, which is not what a search result is.
  const rendered = toolResults
    .map(({ call, result }) => {
      const head2 = `[${call.name} ${JSON.stringify(call.args)}] ${result.ok ? "OK" : "FAILED"} — ${result.summary}`;
      return result.content ? `${head2}\n${result.content}` : head2;
    })
    .join("\n\n---\n\n");

  return [
    { role: "system", content: sys },
    ...rest,
    {
      role: "user",
      content: `=== TOOL RESULTS (everything the council gathered this turn) ===\n${rendered}\n\nUse these. Cite URLs as [Title](URL).`,
    },
  ];
}

module.exports = { firstWithResults, toolMessages };
