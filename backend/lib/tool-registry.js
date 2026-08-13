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
const { childAbortController } = require("./abort");
const { UrlBlocked } = require("./url-guard");
const { randomUUID } = require("node:crypto");
const Sentry = require("@sentry/node");

/** Result shapes are uniform so the loop never has to know which tool ran. */
const ok = (summary, content) => ({ ok: true, summary, content });
const fail = (summary) => ({ ok: false, summary, content: "" });

/**
 * Exceptions are server-side diagnostics, not model-facing tool guidance.
 * UrlBlocked supplies a deliberately safe recovery message; every other
 * exception gets a generic no-retry response rather than exposing provider,
 * resolver, or transport details.
 */
const modelErrorMessage = (toolName, err) => {
  if (err instanceof UrlBlocked && typeof err.modelMessage === "string" && err.modelMessage) {
    return err.modelMessage;
  }
  return `${toolName} failed. Do not retry the same request.`;
};

/** Keep the full exception on the server side while the result stays safe. */
const defaultReportError = (toolName, err) => {
  console.error(`[TOOLS] ${toolName} exception:`, err);
  Sentry.captureException(err, { tags: { tool: toolName } });
};

/** A tool result is fed back into a prompt, so it has a hard size. */
const MAX_RESULT_CHARS = 4000;
const MAX_TOOL_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;

/** A caller may shorten a tool's patience, never lengthen the production cap. */
const clampTimeoutMs = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, MAX_TOOL_TIMEOUT_MS) : MAX_TOOL_TIMEOUT_MS;
};

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
      const value = trimmed.slice(0, spec.maxLength || 400);
      if (spec.enum && !spec.enum.includes(value)) {
        return { valid: false, error: `${tool.name}: Unknown ${name} "${value}". Available: ${spec.enum.join(", ")}.` };
      }
      if (spec.format === "http-url") {
        let parsed;
        try {
          parsed = new URL(value);
        } catch {
          return { valid: false, error: `${tool.name}: "${name}" must be an absolute http(s) URL.` };
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return { valid: false, error: `${tool.name}: "${name}" must be an absolute http(s) URL.` };
        }
      }
      out[name] = value;
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
 * @param {(target: object, options: object) => Promise<{body:string,finalUrl:string,status:number}>} [deps.readUrl]
 *        present ⇒ read_url offered
 * @param {(raw: string) => Promise<any>} [deps.assertSafeUrl] SSRF guard; read_url
 *        is NOT offered without it, because an unguarded read_url is the single
 *        thing this whole design was most careful about.
 */
function buildRegistry(deps = {}) {
  const tools = [];
  const reportError = typeof deps.reportError === "function" ? deps.reportError : defaultReportError;
  const report = (toolName, err) => {
    try {
      reportError(toolName, err);
    } catch {
      // Diagnostics are best effort; a broken reporter must not lose a tool
      // result or turn a contained failure into a failed council turn.
    }
  };
  /* A model that has read hostile text must never author an outbound address.
   * Search results get server-minted ids; read_url resolves only those ids in
   * this per-turn map. The lookup happens before DNS validation, so even a
   * refused call cannot leak prompt text through a resolver query. */
  const readableResults = new Map();

  if (typeof deps.search === "function") {
    tools.push({
      name: "web_search",
      description:
        "Search the live web. Use for anything current, factual, or specific — prices, specs, releases, reviews. Returns titles, URLs and snippets.",
      schema: { query: { type: "string", required: true, maxLength: 300 } },
      run: async ({ query }, { signal } = {}) => {
        const results = await deps.search(query, { signal });
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
          const verdicts = await deps.checkLinks(top.map((r) => r.url).filter(Boolean), { signal });
          const kept = top.filter((r) => !r.url || isCitable((verdicts.get(r.url) || {}).verdict || "ok"));
          dropped = top.length - kept.length;
          // If EVERY result is dead, hand back the originals rather than
          // nothing. A stale link the model can caveat beats no source at all,
          // and a checker that silently empties a good search is worse than no
          // checker.
          top = kept.length ? kept : top;
        }

        const rendered = top.map((r, i) => {
          const id = randomUUID();
          if (r && r.url) readableResults.set(id, r.url);
          return `${i + 1}. [id: ${id}] ${r.title || "Untitled"}\n   ${r.url || ""}\n   ${(r.description || r.content || "").slice(0, 300)}`;
        }).join("\n\n");
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
        "Fetch and read one web_search result as text. Pass its opaque id exactly as shown; never pass or construct a URL.",
      schema: { id: { type: "string", required: true, maxLength: 64 } },
      run: async ({ id }, { signal } = {}) => {
        const url = readableResults.get(id);
        if (!url) {
          return fail("That is not a result id from this turn. Run web_search, then copy the id shown beside the result you want to read.");
        }
        // Throws UrlBlocked for loopback, link-local, private ranges and the
        // cloud metadata address. Keep its detailed message server-side and
        // hand back only the safe recovery text: a model that learns "that
        // host is refused" stops asking, which is the behaviour we want.
        let safe;
        try {
          safe = await deps.assertSafeUrl(url, { signal });
        } catch (err) {
          if (!signal?.aborted) report("read_url", err);
          return fail(modelErrorMessage("read_url", err));
        }
        if (!safe.address || (safe.family !== 4 && safe.family !== 6)) {
          return fail("Refused to fetch a URL whose network address was not pinned by the safety check.");
        }
        /* The fetcher gets the address that was checked and the guard it must
         * apply again to every redirect. Passing only the hostname would reopen
         * DNS rebinding between validation and connection. */
        const read = await deps.readUrl(safe, {
          signal,
          assertSafeUrl: deps.assertSafeUrl,
          maxRedirects: MAX_REDIRECTS,
          maxChars: 16000,
        });
        const text = typeof read === "string" ? read : read && read.body;
        if (!text) return fail(`Nothing readable at ${safe.url.hostname}.`);
        const destination = read && read.finalUrl ? new URL(read.finalUrl).hostname : safe.url.hostname;
        const status = read && Number.isInteger(read.status) ? ` (HTTP ${read.status})` : "";
        return ok(`Read ${destination}${status}`, clamp(text));
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
      run: async ({ id }, { signal } = {}) => {
        // Shape-checked before it reaches the store, so a malformed id is a
        // clear message rather than a database error.
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
          const known = (await deps.files.list({ signal })).map((f) => `${f.id} (${f.name})`).join(", ");
          return fail(`"${id}" is not a file id. Available: ${known || "none"}.`);
        }
        const file = await deps.files.get(id, { signal });
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

  /**
   * ONE tool for every SerpApi engine, selected by argument.
   *
   * SerpApi's ~110 "APIs" are one endpoint with a different `engine=`, so this
   * is one description in the prompt instead of 110. That matters more than it
   * sounds: a tool's name and description are injected into EVERY seat's prompt
   * on EVERY turn, so 110 of them would spend roughly 1,500 tokens per seat
   * describing flight search to someone asking about a monitor.
   *
   * `params` arrives as a JSON string rather than an object because validateArgs
   * handles strings and numbers, and adding an object type to it for one caller
   * is a worse trade than parsing here. A model that writes malformed JSON gets
   * told so and keeps its arguments — the engine and query still run.
   */
  if (typeof deps.searchEngine === "function" && Array.isArray(deps.engineNames) && deps.engineNames.length) {
    tools.push({
      name: "search_specialized",
      description:
        "Search ONE specialised source when general web search is the wrong shape for the question — live prices, flights, hotels, papers, reviews, job listings, share prices. " +
        `Pick the single best "engine" for the question. Available engines: ${deps.engineMenu || deps.engineNames.join(", ")}. ` +
        'Some engines need extra arguments, given as a JSON object string in "params" — e.g. {"departure_id":"DXB","arrival_id":"LHR","outbound_date":"2026-09-01"}. ' +
        "Each call costs money, so choose one engine deliberately rather than trying several.",
      schema: {
        engine: { type: "string", required: true, maxLength: 40, enum: deps.engineNames },
        query: { type: "string", required: false, maxLength: 300, default: "" },
        params: { type: "string", required: false, maxLength: 500, default: "" },
      },
      run: async ({ engine, query, params }, { signal } = {}) => {
        let parsed = {};
        if (params) {
          try {
            const raw = JSON.parse(params);
            if (raw && typeof raw === "object" && !Array.isArray(raw)) parsed = raw;
          } catch {
            // Not fatal. The engine and query are usually the whole request and
            // failing the call over a malformed optional argument spends a round
            // to punish a formatting slip.
            parsed = {};
          }
        }
        const res = await deps.searchEngine({ engine, query, params: parsed, signal });
        if (!res || !res.ok) return fail((res && res.error) || `${engine} returned nothing.`);
        return ok(`${res.rows.length} result(s) from ${res.engine}`, clamp(res.text));
      },
    });
  }

  const byName = new Map(tools.map((t) => [t.name, t]));

  return {
    /** The list handed to the model — native `tools` array or rendered into the prompt. */
    list: () => tools.map(({ name, description, schema }) => ({ name, description, schema })),

    has: (name) => byName.has(name),

    /**
     * One call, in the form `execute` will actually run it: unknown keys gone,
     * strings trimmed and capped, numbers coerced and clamped.
     *
     * This exists for the dedupe. Two members proposing the same search, one of
     * them carrying an extra field the tool ignores, are ONE billed request —
     * but keyed on the arguments as written they are two, and the second one is
     * paid for in money and in the 25s budget. Deduping on the canonical form
     * closes that.
     *
     * Returns null when the call cannot be normalised — no such tool, or
     * arguments the schema rejects. The caller keeps the raw call in that case,
     * because a rejected call still has to reach `execute` to come back as the
     * error message that tells the model what it got wrong.
     */
    normalize: (call) => {
      const tool = byName.get(call && call.name);
      if (!tool) return null;
      const checked = validateArgs(tool, call.args);
      if (!checked.valid) return null;
      return { name: tool.name, args: checked.args };
    },

    /**
     * Run one call. Never throws: an executor that blows up is a failed tool
     * result, not a failed turn. A single bad page must not take down a council
     * answer that has six other sources.
     */
    execute: async (call, { timeoutMs = MAX_TOOL_TIMEOUT_MS, signal } = {}) => {
      const tool = byName.get(call && call.name);
      if (!tool) {
        // Naming what DOES exist turns a wasted round into a corrected one.
        const available = tools.map((t) => t.name).join(", ") || "none";
        return fail(`No tool named "${call && call.name}". Available: ${available}.`);
      }

      const checked = validateArgs(tool, call.args);
      if (!checked.valid) return fail(checked.error);

      if (signal?.aborted) return fail(`${tool.name} cancelled.`);

      const child = childAbortController(signal);
      const timeout = clampTimeoutMs(timeoutMs);
      let timer = null;
      let settled = false;
      let resolveResult;
      const result = new Promise((resolve) => {
        resolveResult = resolve;
      });
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onParentAbort);
        child.controller.abort(value?.ok === false && /timed out|cancelled/.test(value.summary || "") ? value.summary : "tool-finished");
        child.dispose();
        resolveResult(value);
      };
      const onParentAbort = () => finish(fail(`${tool.name} cancelled.`));
      if (signal) signal.addEventListener("abort", onParentAbort, { once: true });

      // The per-call ceiling is enforced here rather than inside each
      // executor, so a new tool cannot forget it. The timer aborts the
      // executor BEFORE resolving the failed result; a provider with a fetch
      // signal therefore stops doing work instead of merely being ignored.
      timer = setTimeout(() => finish(fail(`${tool.name} timed out after ${timeout}ms.`)), timeout);
      timer.unref?.();
      Promise.resolve()
        .then(() => tool.run(checked.args, { signal: child.signal }))
        .then((value) => finish(value || fail(`${tool.name} returned no result.`)), (err) => {
          // Abort and timeout rejections are expected cleanup, not server
          // faults. The original exception is still retained for real errors.
          if (!child.signal.aborted && !signal?.aborted) report(tool.name, err);
          finish(fail(modelErrorMessage(tool.name, err)));
        });

      return result;
    },
  };
}

module.exports = { buildRegistry, validateArgs, clampTimeoutMs, MAX_RESULT_CHARS, MAX_TOOL_TIMEOUT_MS };
