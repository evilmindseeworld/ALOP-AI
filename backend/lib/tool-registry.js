/**
 * What the council may ask for, and what happens when it asks wrong.
 *
 * The registry is built per turn from the capabilities that are actually
 * present. A tool whose backing service has no key IS NOT REGISTERED — the
 * council is told it does not exist rather than being offered one that always
 * errors. A model handed a tool that fails every time will retry it, and
 * retries are what the 3-round and 8-call ceilings are there to stop; spending
 * them on a tool that was never going to work is the worst use of the budget.
 *
 * Two things this module deliberately does NOT do:
 *
 *   - It does not execute anything itself. Executors are injected, so the loop
 *     is testable against a fake and the network never appears in a unit test.
 *   - It does not decide the SSRF question. read_url's executor calls
 *     assertSafeUrl; the registry only validates the shape of the argument.
 *
 * `read_file` and `run_code` are specified in the design and are not here.
 * read_file needs a content store that does not exist yet (only images can be
 * attached today), and run_code needs a hosted sandbox key. Registering either
 * before its backing exists would be exactly the "offered but always errors"
 * failure above. They arrive with their backing, per the design's step order.
 */

const { isCitable } = require("./link-check");

/** Result shapes are uniform so the loop never has to know which tool ran. */
const ok = (summary, content) => ({ ok: true, summary, content });
const fail = (summary) => ({ ok: false, summary, content: "" });

/** A tool result is fed back into a prompt, so it has a hard size. */
const MAX_RESULT_CHARS = 4000;

const clamp = (text) => {
  const s = typeof text === "string" ? text : String(text ?? "");
  return s.length <= MAX_RESULT_CHARS ? s : s.slice(0, MAX_RESULT_CHARS) + "\n\n[...truncated]";
};

/**
 * Validate one argument bag against a tool's schema.
 *
 * Deliberately tiny — no JSON Schema dependency for four tools with two fields
 * each. It checks the things a model actually gets wrong: a missing required
 * argument, a value of the wrong type, and an empty string where prose was
 * expected (models emit `{"query": ""}` when they cannot think of one).
 *
 * @returns {{valid: true, args: object} | {valid: false, error: string}}
 */
function validateArgs(tool, args) {
  const out = {};
  const bag = args && typeof args === "object" ? args : {};

  for (const [name, spec] of Object.entries(tool.schema)) {
    const raw = bag[name];

    if (raw === undefined || raw === null || raw === "") {
      if (spec.required) return { valid: false, error: `${tool.name} needs a "${name}" argument.` };
      if (spec.default !== undefined) out[name] = spec.default;
      continue;
    }

    if (spec.type === "string") {
      if (typeof raw !== "string") return { valid: false, error: `${tool.name}: "${name}" must be text.` };
      const trimmed = raw.trim();
      if (!trimmed && spec.required) return { valid: false, error: `${tool.name} needs a non-empty "${name}".` };
      // A model-written argument is unbounded; the cap is on the argument, not
      // on the reply, because the argument is what reaches a third-party API.
      out[name] = trimmed.slice(0, spec.maxLength || 400);
    } else if (spec.type === "number") {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) return { valid: false, error: `${tool.name}: "${name}" must be a number.` };
      out[name] = Math.min(Math.max(n, spec.min ?? -Infinity), spec.max ?? Infinity);
    }
  }

  return { valid: true, args: out };
}

/**
 * Build the registry for one turn.
 *
 * @param {object} deps
 * @param {(query: string) => Promise<any>} [deps.search]   present ⇒ web_search offered
 * @param {(url: string) => Promise<string>} [deps.readUrl] present ⇒ read_url offered
 * @param {(raw: string) => Promise<any>} [deps.assertSafeUrl] SSRF guard; read_url
 *        is NOT offered without it, because an unguarded read_url is the single
 *        thing this whole design was most careful about.
 */
function buildRegistry(deps = {}) {
  const tools = [];

  if (typeof deps.search === "function") {
    tools.push({
      name: "web_search",
      description:
        "Search the live web. Use for anything current, factual, or specific — prices, specs, releases, reviews. Returns titles, URLs and snippets.",
      schema: { query: { type: "string", required: true, maxLength: 300 } },
      run: async ({ query }) => {
        const results = await deps.search(query);
        const list = Array.isArray(results) ? results : results && results.results;
        if (!list || list.length === 0) return fail(`No results for "${query}".`);

        let top = list.slice(0, 6);
        let dropped = 0;

        // Search APIs index pages that have since 404'd, been bounced to a
        // homepage, or now say "no longer available". Citing one of those is
        // the failure a reader actually notices, because it is the one they
        // can check. Verify before the model ever sees them.
        //
        // Optional: without a checker the tool behaves exactly as before, so
        // this cannot become a hard dependency of search working at all.
        if (deps.checkLinks) {
          const verdicts = await deps.checkLinks(top.map((r) => r.url).filter(Boolean));
          const kept = top.filter((r) => !r.url || isCitable((verdicts.get(r.url) || {}).verdict || "ok"));
          dropped = top.length - kept.length;
          // If EVERY result is dead, hand back the originals rather than
          // nothing. A stale link the model can caveat beats no source at all,
          // and a checker that silently empties a good search is worse than no
          // checker.
          top = kept.length ? kept : top;
        }

        const rendered = top
          .map((r, i) => `${i + 1}. ${r.title || "Untitled"}\n   ${r.url || ""}\n   ${(r.description || r.content || "").slice(0, 300)}`)
          .join("\n\n");
        const note = dropped ? ` (${dropped} dead or unavailable link${dropped === 1 ? "" : "s"} removed)` : "";
        return ok(`${top.length} results for "${query}"${note}`, clamp(rendered));
      },
    });
  }

  // read_url is offered ONLY when the SSRF guard is also present. The design's
  // rule is that the guard ships in the same commit as the tool; this makes
  // that structural rather than a thing to remember.
  if (typeof deps.readUrl === "function" && typeof deps.assertSafeUrl === "function") {
    tools.push({
      name: "read_url",
      description:
        "Fetch and read one web page as text. Use after web_search when a result's snippet is not enough. Takes one absolute http(s) URL.",
      schema: { url: { type: "string", required: true, maxLength: 2048 } },
      run: async ({ url }) => {
        // Throws UrlBlocked for loopback, link-local, private ranges and the
        // cloud metadata address. The error text is safe to hand back: it says
        // the host was refused, and a model that learns "that host is refused"
        // stops asking, which is the behaviour we want.
        let safe;
        try {
          safe = await deps.assertSafeUrl(url);
        } catch (err) {
          return fail(`Refused to fetch that URL: ${err.message}`);
        }
        const text = await deps.readUrl(safe.url.toString());
        if (!text) return fail(`Nothing readable at ${safe.url.hostname}.`);
        return ok(`Read ${safe.url.hostname}`, clamp(text));
      },
    });
  }

  /**
   * read_file takes an OPAQUE ID and never a path.
   *
   * `deps.files` is a store already bound to (user, chat) by the caller, so
   * the scope is not a parameter this tool can get wrong — a model cannot ask
   * for another user's file because there is nowhere in this signature to name
   * one. `list()` is what makes the ids knowable at all: without it a model
   * would have to guess a UUID, which is not a usable interface.
   *
   * Registered only when files actually exist for this turn. A tool that can
   * only ever answer "no files" is a tool the council will waste a round on.
   */
  if (deps.files && typeof deps.files.get === "function" && typeof deps.files.list === "function") {
    tools.push({
      name: "read_file",
      description:
        "Read a file the user attached to this conversation, by its id. Ids come from the ATTACHED FILES list in your prompt. Takes an id, never a filename and never a path.",
      schema: { id: { type: "string", required: true, maxLength: 64 } },
      run: async ({ id }) => {
        // Shape-checked before it reaches the store, so a malformed id is a
        // clear message rather than a database error.
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
          const known = (await deps.files.list()).map((f) => `${f.id} (${f.name})`).join(", ");
          return fail(`"${id}" is not a file id. Available: ${known || "none"}.`);
        }
        const file = await deps.files.get(id);
        // Indistinguishable from "belongs to someone else" ON PURPOSE. The
        // store only ever returns files in this (user, chat), so a miss means
        // either it does not exist or it is not theirs — and saying which
        // would confirm the existence of another user's file.
        if (!file) return fail(`No file with id ${id} in this conversation.`);
        const note = file.truncated ? `\n\n[truncated — this is the first part of ${file.name}]` : "";
        return ok(`Read ${file.name} (${file.kind}, ${file.bytes} bytes)`, clamp(file.content + note));
      },
    });
  }

  const byName = new Map(tools.map((t) => [t.name, t]));

  return {
    /** The list handed to the model — native `tools` array or rendered into the prompt. */
    list: () => tools.map(({ name, description, schema }) => ({ name, description, schema })),

    has: (name) => byName.has(name),

    /**
     * Run one call. Never throws: an executor that blows up is a failed tool
     * result, not a failed turn. A single bad page must not take down a council
     * answer that has six other sources.
     */
    execute: async (call, { timeoutMs = 8000 } = {}) => {
      const tool = byName.get(call && call.name);
      if (!tool) {
        // Naming what DOES exist turns a wasted round into a corrected one.
        const available = tools.map((t) => t.name).join(", ") || "none";
        return fail(`No tool named "${call && call.name}". Available: ${available}.`);
      }

      const checked = validateArgs(tool, call.args);
      if (!checked.valid) return fail(checked.error);

      try {
        // The per-call ceiling is enforced here rather than inside each
        // executor, so a new tool cannot forget it.
        return await Promise.race([
          tool.run(checked.args),
          new Promise((resolve) => setTimeout(() => resolve(fail(`${tool.name} timed out after ${timeoutMs}ms.`)), timeoutMs).unref?.()),
        ]);
      } catch (err) {
        return fail(`${tool.name} failed: ${err.message}`);
      }
    },
  };
}

module.exports = { buildRegistry, validateArgs, MAX_RESULT_CHARS };
