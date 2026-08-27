const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRegistry, MAX_RESULT_CHARS, clampTimeoutMs } = require("./tool-registry");
const { UrlBlocked } = require("./url-guard");
const { createEvidenceLedger } = require("./evidence-ledger");
const { verifyAnswerForDisplay } = require("./answer-evidence");

const RESULTS = [
  { title: "RTINGS OLED", url: "https://rtings.com/a", description: "Burn-in results." },
  { title: "Tom's Hardware", url: "https://th.com/b", description: "Panel comparison." },
];

const resultId = (searchResult, position = 1) => {
  const match = searchResult.content.match(new RegExp(`^${position}\\. \\[id: ([0-9a-f-]{36})\\]`, "m"));
  assert.ok(match, `search result ${position} did not expose an opaque id`);
  return match[1];
};

const full = (over = {}) =>
  buildRegistry({
    search: async () => RESULTS,
    readUrl: async () => "# Page\n\nBody text.",
    assertSafeUrl: async (u) => ({ url: new URL(u), address: "93.184.216.34", family: 4 }),
    ...over,
  });

// ===== registration =====

test("offers exactly the tools whose backing is present", () => {
  assert.deepEqual(full().list().map((t) => t.name), ["web_search", "read_url"]);
});

// ===== normalize, which the dedupe keys on =====

test("normalize returns the call as execute will run it, not as it was written", () => {
  // The dedupe keys on this. A field the schema does not name must be gone by
  // then, or two identical searches are billed twice — see tool-dedupe.js.
  assert.deepEqual(
    full().normalize({ name: "web_search", args: { query: "  OLED burn-in ", nonce: 7 } }),
    { name: "web_search", args: { query: "OLED burn-in" } },
  );
});

test("normalize returns null for a call execute would reject", () => {
  const r = full();
  assert.equal(r.normalize({ name: "nope", args: {} }), null);
  assert.equal(r.normalize({ name: "web_search", args: {} }), null, "missing a required argument");
});

test("a tool with no backing is NOT offered", () => {
  // Not "offered but erroring" — a model retries a failing tool, and retries are
  // what the round and call ceilings exist to stop.
  const searchOnly = buildRegistry({ search: async () => RESULTS });
  assert.deepEqual(searchOnly.list().map((t) => t.name), ["web_search"]);
  assert.equal(searchOnly.has("read_url"), false);
});

test("read_url is NOT offered without the SSRF guard", () => {
  // The design's rule is that the guard lands in the same commit as the tool.
  // This makes that structural instead of something to remember.
  const noGuard = buildRegistry({ search: async () => RESULTS, readUrl: async () => "x" });
  assert.equal(noGuard.has("read_url"), false);
});

test("an empty registry is legal and offers nothing", () => {
  assert.deepEqual(buildRegistry().list(), []);
});

test("read_file is absent when no store is supplied, run_code until it has a sandbox", () => {
  const names = full().list().map((t) => t.name);
  assert.equal(names.includes("read_file"), false);
  assert.equal(names.includes("run_code"), false);
});

// ===== read_file =====

const FILE = {
  id: "11111111-2222-4333-8444-555555555555",
  name: "budget.csv",
  kind: "csv",
  bytes: 412,
  content: "month,spend\njan,120",
  truncated: false,
};

/** A store already bound to one (user, chat) — the scope is not a parameter. */
const fileStore = (files = [FILE]) => ({
  list: async () => files.map(({ id, name }) => ({ id, name })),
  get: async (id) => files.find((f) => f.id === id) || null,
});

const withFiles = (files) => buildRegistry({ search: async () => RESULTS, files: fileStore(files) });

test("read_file is offered once a store is supplied", () => {
  assert.equal(withFiles().has("read_file"), true);
});

test("reads a file by id", async () => {
  const r = await withFiles().execute({ name: "read_file", args: { id: FILE.id } });
  assert.equal(r.ok, true);
  assert.ok(r.content.includes("month,spend"));
  assert.ok(r.summary.includes("budget.csv"));
});

test("a truncated file says so inside the content the model reads", async () => {
  const r = await withFiles([{ ...FILE, truncated: true }]).execute({ name: "read_file", args: { id: FILE.id } });
  assert.ok(r.content.includes("truncated"));
});

/** A long document whose answer is far past the first result-sized slice. */
const LONG_FILE = {
  ...FILE,
  name: "handbook.pdf",
  kind: "pdf",
  bytes: 900_000,
  content: [
    Array.from({ length: 400 }, (_, i) => `Paragraph ${i} about invoices, shipping and general administration.`).join("\n\n"),
    "## Refund policy",
    "The restocking fee is 12 percent for opened electronics.",
    Array.from({ length: 100 }, (_, i) => `Closing paragraph ${i}.`).join("\n\n"),
  ].join("\n\n"),
};

test("a long file is RETRIEVED FROM, not cut at the front", async () => {
  // Without this the clamp answers a question about the refund clause with the
  // first 4,000 characters of the document and says nothing about it.
  const cut = LONG_FILE.content.indexOf("restocking fee");
  assert.ok(cut > 20_000, `fixture proves nothing (clause at ${cut})`);

  const r = await withFiles([LONG_FILE]).execute({
    name: "read_file",
    args: { id: FILE.id, query: "what is the restocking fee on a refund?" },
  });
  assert.equal(r.ok, true);
  assert.match(r.content, /restocking fee is 12 percent/);
  assert.match(r.content, /characters \d+–\d+ of \d+/, "no offsets means no checkable citation");
  assert.ok(r.content.length <= 4200, `a tool result of ${r.content.length} chars blows the prompt budget`);
});

test("a long file with no query still returns the beginning", async () => {
  const r = await withFiles([LONG_FILE]).execute({ name: "read_file", args: { id: FILE.id } });
  assert.equal(r.ok, true);
  assert.match(r.content, /Paragraph 0 about invoices/);
});

test("A PATH IS NOT AN ID, and the refusal lists what is", async () => {
  // The whole design rests on this: a model-issued path is attacker-controlled
  // the moment anyone can get text into a prompt.
  for (const id of ["../../.env", "/etc/passwd", "..\\..\\config", "budget.csv", "1", ""]) {
    const r = await withFiles().execute({ name: "read_file", args: { id } });
    assert.equal(r.ok, false, id);
  }
  const r = await withFiles().execute({ name: "read_file", args: { id: "../../.env" } });
  assert.ok(r.summary.includes("budget.csv"), "a wasted round should become a corrected one");
});

test("a well-formed id for a file in another chat is a plain miss", async () => {
  // The store only ever holds this (user, chat), so "not found" and "not yours"
  // are the same answer — deliberately. Distinguishing them would confirm the
  // existence of another user's file.
  const r = await withFiles().execute({ name: "read_file", args: { id: "99999999-8888-4777-8666-555555555555" } });
  assert.equal(r.ok, false);
  assert.equal(/permission|denied|forbidden/i.test(r.summary), false);
  assert.ok(/no file with id/i.test(r.summary));
});

test("the store is never asked for anything the tool did not shape-check", async () => {
  let asked = [];
  const reg = buildRegistry({ files: { list: async () => [], get: async (id) => { asked.push(id); return null; } } });
  await reg.execute({ name: "read_file", args: { id: "../../.env" } });
  assert.deepEqual(asked, [], "a malformed id must not reach the database at all");
});

test("every offered tool carries a description and a schema", () => {
  for (const t of full().list()) {
    assert.equal(typeof t.description, "string");
    assert.ok(t.description.length > 20, `${t.name} needs a real description`);
    assert.ok(Object.keys(t.schema).length > 0);
  }
});

test("read_url tells the model when and how to use a search result id", () => {
  const read = full().list().find((tool) => tool.name === "read_url");
  assert.match(read.description, /AT MOST ONE/);
  assert.match(read.description, /when its snippet is not enough/);
  assert.match(read.description, /opaque id shown beside that result/);
  assert.match(read.description, /never pass or construct a URL/);
});

// ===== execution =====

test("web_search renders results the model can act on", async () => {
  const r = await full().execute({ name: "web_search", args: { query: "OLED" } });
  assert.equal(r.ok, true);
  assert.ok(r.content.includes("rtings.com/a"));
  assert.ok(r.content.includes("RTINGS OLED"));
  assert.deepEqual(r.sources, [
    { title: "RTINGS OLED", url: "https://rtings.com/a", date: null, via: "web_search" },
    { title: "Tom's Hardware", url: "https://th.com/b", date: null, via: "web_search" },
  ]);
  resultId(r);
});

test("web_search accepts the Tavily {results:[…]} shape as well as a bare array", async () => {
  const reg = buildRegistry({ search: async () => ({ results: RESULTS, answer: "x" }) });
  const r = await reg.execute({ name: "web_search", args: { query: "a" } });
  assert.equal(r.ok, true);
});

// ===== dead-link filtering =====

const LIVE = { title: "Live", url: "https://live.test/p/1", description: "in stock" };
const DEAD = { title: "Dead", url: "https://dead.test/p/2", description: "gone" };
const verdicts = (m) => async (urls) => new Map(urls.map((u) => [u, { verdict: m[u] || "ok", reason: "" }]));

test("dead links never reach the model", async () => {
  const reg = buildRegistry({
    search: async () => [LIVE, DEAD],
    checkLinks: verdicts({ "https://dead.test/p/2": "gone" }),
  });
  const r = await reg.execute({ name: "web_search", args: { query: "x" } });
  assert.ok(r.content.includes("live.test"));
  assert.equal(r.content.includes("dead.test"), false);
  assert.ok(r.summary.includes("1 dead or unavailable link removed"));
});

test("an unavailable product is dropped as a source too", async () => {
  const reg = buildRegistry({
    search: async () => [LIVE, DEAD],
    checkLinks: verdicts({ "https://dead.test/p/2": "unavailable" }),
  });
  const r = await reg.execute({ name: "web_search", args: { query: "x" } });
  assert.equal(r.content.includes("dead.test"), false);
});

test("a link we merely could not REACH is kept", async () => {
  // Our network trouble is not evidence about the page.
  const reg = buildRegistry({
    search: async () => [LIVE, DEAD],
    checkLinks: verdicts({ "https://dead.test/p/2": "unreachable" }),
  });
  const r = await reg.execute({ name: "web_search", args: { query: "x" } });
  assert.ok(r.content.includes("dead.test"));
  assert.equal(r.summary.includes("removed"), false);
});

test("if EVERY link is dead the originals come back rather than nothing", async () => {
  // A checker that silently empties a good search is worse than no checker: a
  // stale link the model can caveat beats no source at all.
  const reg = buildRegistry({
    search: async () => [LIVE, DEAD],
    checkLinks: verdicts({ "https://live.test/p/1": "gone", "https://dead.test/p/2": "gone" }),
  });
  const r = await reg.execute({ name: "web_search", args: { query: "x" } });
  assert.equal(r.ok, true);
  assert.ok(r.content.includes("live.test"));
});

test("without a checker, search behaves exactly as before", async () => {
  const r = await buildRegistry({ search: async () => [LIVE, DEAD] }).execute({
    name: "web_search",
    args: { query: "x" },
  });
  assert.ok(r.content.includes("dead.test"));
  assert.equal(r.summary.includes("removed"), false);
});

test("a checker that throws does not take down search", async () => {
  const reg = buildRegistry({
    search: async () => [LIVE],
    checkLinks: async () => { throw new Error("checker exploded"); },
  });
  const r = await reg.execute({ name: "web_search", args: { query: "x" } });
  assert.equal(r.ok, false, "it surfaces as a failed tool result, never an unhandled throw");
});

test("no results is a clean failure, not an exception", async () => {
  const reg = buildRegistry({ search: async () => [] });
  const r = await reg.execute({ name: "web_search", args: { query: "zzz" } });
  assert.equal(r.ok, false);
  assert.ok(r.summary.includes("No results"));
});

test("read_url passes the URL through the guard before fetching", async () => {
  let guarded = null;
  let fetched = null;
  const reg = buildRegistry({
    search: async () => [{ title: "x", url: "https://example.com/x", description: "x" }],
    readUrl: async (safe) => { fetched = safe.url.toString(); return "body"; },
    assertSafeUrl: async (u) => { guarded = u; return { url: new URL(u), address: "93.184.216.34", family: 4 }; },
  });
  const search = await reg.execute({ name: "web_search", args: { query: "x" } });
  await reg.execute({ name: "read_url", args: { id: resultId(search) } });
  assert.equal(guarded, "https://example.com/x");
  assert.ok(fetched.startsWith("https://example.com/x"));
});

test("a blocked URL never reaches the fetcher", async () => {
  let fetched = false;
  const diagnostics = [];
  const diagnostic = new UrlBlocked("resolves to 169.254.169.254, which is a private or reserved address.");
  const reg = buildRegistry({
    search: async () => [{ title: "metadata", url: "http://metadata.internal/", description: "x" }],
    readUrl: async () => { fetched = true; return "secrets"; },
    assertSafeUrl: async () => { throw diagnostic; },
    reportError: (tool, err) => diagnostics.push({ tool, err }),
  });
  const search = await reg.execute({ name: "web_search", args: { query: "metadata" } });
  const r = await reg.execute({ name: "read_url", args: { id: resultId(search) } });
  assert.equal(fetched, false, "the guard must run BEFORE the fetch, not alongside it");
  assert.equal(r.ok, false);
  assert.equal(r.summary, "That host is refused by network safety checks. Do not retry this URL.");
  assert.equal(r.content.includes("169.254.169.254"), false);
  assert.equal(diagnostics[0].tool, "read_url");
  assert.match(diagnostics[0].err.message, /169\.254\.169\.254/);
});

test("read_url can only read an exact URL returned by this turn's search", async () => {
  let fetched = false;
  const reg = buildRegistry({
    search: async () => [{ title: "Allowed", url: "https://allowed.example/page", description: "x" }],
    readUrl: async () => { fetched = true; return "body"; },
    assertSafeUrl: async (url) => ({ url: new URL(url), address: "93.184.216.34", family: 4 }),
  });

  const direct = await reg.execute({ name: "read_url", args: { id: "99999999-8888-4777-8666-555555555555" } });
  assert.equal(direct.ok, false);
  assert.equal(fetched, false, "a model-invented URL reached the network");

  const search = await reg.execute({ name: "web_search", args: { query: "allowed page" } });
  const allowed = await reg.execute({ name: "read_url", args: { id: resultId(search) } });
  assert.equal(allowed.ok, true);
  assert.equal(fetched, true);
});

test("read_url rejects a model-authored URL even when it changes a real result", async () => {
  let fetched = null;
  let guarded = false;
  const reg = buildRegistry({
    search: async () => [{ title: "Page", url: "https://allowed.example/page", description: "x" }],
    readUrl: async (safe) => { fetched = safe; return "body"; },
    assertSafeUrl: async (url) => { guarded = true; return { url: new URL(url), address: "93.184.216.34", family: 4 }; },
  });
  await reg.execute({ name: "web_search", args: { query: "page" } });
  const result = await reg.execute({
    name: "read_url",
    args: { id: "https://allowed.example/page?conversation=SECRET" },
  });
  assert.equal(result.ok, false);
  assert.equal(guarded, false, "a forged address reached DNS validation");
  assert.equal(fetched, null, "conversation text left through a modified URL");
});

test("read_url gives the fetcher the address that was actually vetted", async () => {
  let received;
  const reg = buildRegistry({
    search: async () => [{ title: "Page", url: "https://allowed.example/page", description: "x" }],
    readUrl: async (safe, opts) => { received = { safe, opts }; return "body"; },
    assertSafeUrl: async (url) => ({ url: new URL(url), address: "93.184.216.34", family: 4 }),
  });
  const search = await reg.execute({ name: "web_search", args: { query: "page" } });
  await reg.execute({ name: "read_url", args: { id: resultId(search) } });
  assert.equal(received.safe.address, "93.184.216.34");
  assert.equal(received.safe.family, 4);
  assert.equal(received.opts.assertSafeUrl instanceof Function, true, "redirect hops cannot be revalidated");
  assert.equal(received.opts.maxRedirects, 5);
  assert.equal(received.opts.maxChars, 16000);
});

test("read_url renders the structured reader result and reports its final host and status", async () => {
  const reg = buildRegistry({
    search: async () => [{ title: "Page", url: "https://allowed.example/page", description: "x" }],
    readUrl: async () => ({ body: "final body", finalUrl: "https://www.allowed.example/final", status: 200 }),
    assertSafeUrl: async (url) => ({ url: new URL(url), address: "93.184.216.34", family: 4 }),
  });
  const search = await reg.execute({ name: "web_search", args: { query: "page" } });
  const result = await reg.execute({ name: "read_url", args: { id: resultId(search) } });
  assert.equal(result.ok, true);
  assert.equal(result.content, "final body");
  assert.equal(result.summary, "Read www.allowed.example (HTTP 200)");
  assert.deepEqual(result.sources, [{
    title: "Read www.allowed.example",
    url: "https://www.allowed.example/final",
    text: "final body",
    via: "read_url",
  }]);
});

test("read_url evidence uses the final URL for supported citations and rejects an unrelated URL", async () => {
  const finalUrl = "https://www.allowed.example/final";
  const reg = buildRegistry({
    search: async () => [{ title: "Page", url: "https://allowed.example/page", description: "x" }],
    readUrl: async () => ({ body: "The current price is $1,999.", finalUrl, status: 200 }),
    assertSafeUrl: async (url) => ({ url: new URL(url), address: "93.184.216.34", family: 4 }),
  });
  const search = await reg.execute({ name: "web_search", args: { query: "page" } });
  const result = await reg.execute({ name: "read_url", args: { id: resultId(search) } });
  const evidence = createEvidenceLedger();
  for (const source of result.sources) evidence.record(source);

  const supported = verifyAnswerForDisplay({
    answer: `The current price is $1,999. ${finalUrl}`,
    evidence,
    searched: true,
  });
  assert.equal(supported.ok, true);

  const unrelated = verifyAnswerForDisplay({
    answer: "The current price is $1,999. https://unrelated.example/price",
    evidence,
    searched: true,
  });
  assert.equal(unrelated.ok, false);
  assert.ok(unrelated.hardProblems.some((problem) => problem.kind === "unsupported_citation"));
});

// ===== bad calls from the model =====

test("an unknown tool names the ones that exist", async () => {
  const r = await full().execute({ name: "run_code", args: {} });
  assert.equal(r.ok, false);
  assert.ok(r.summary.includes("web_search"), "a wasted round should become a corrected one");
});

test("a missing required argument is refused before the executor runs", async () => {
  let ran = false;
  const reg = buildRegistry({ search: async () => { ran = true; return RESULTS; } });
  for (const args of [{}, { query: "" }, { query: "   " }, { query: null }, { wrong: "a" }]) {
    const r = await reg.execute({ name: "web_search", args });
    assert.equal(r.ok, false, JSON.stringify(args));
  }
  assert.equal(ran, false);
});

test("a wrong-typed argument is refused", async () => {
  const r = await full().execute({ name: "web_search", args: { query: { nested: true } } });
  assert.equal(r.ok, false);
  assert.ok(r.summary.includes("must be text"));
});

test("an over-long argument is clamped rather than sent whole to a third party", async () => {
  let received = "";
  const reg = buildRegistry({ search: async (q) => { received = q; return RESULTS; } });
  await reg.execute({ name: "web_search", args: { query: "x".repeat(5000) } });
  assert.ok(received.length <= 300, `sent ${received.length} chars`);
});

test("a result too large for a prompt is truncated and says so", async () => {
  const reg = buildRegistry({
    search: async () => [{ title: "x", url: "https://e.test/", description: "x" }],
    readUrl: async () => "y".repeat(50000),
    assertSafeUrl: async (u) => ({ url: new URL(u), address: "93.184.216.34", family: 4 }),
  });
  const search = await reg.execute({ name: "web_search", args: { query: "x" } });
  const r = await reg.execute({ name: "read_url", args: { id: resultId(search) } });
  assert.ok(r.content.length < MAX_RESULT_CHARS + 100);
  assert.ok(r.content.includes("truncated"));
});

// ===== an executor must never take down the turn =====

test("an executor that throws is a failed result, not a thrown error", async () => {
  const diagnostics = [];
  const reg = buildRegistry({
    search: async () => { throw new Error("connect to 169.254.169.254:80 failed: network died"); },
    reportError: (tool, err) => diagnostics.push({ tool, err }),
  });
  const r = await reg.execute({ name: "web_search", args: { query: "a" } });
  assert.equal(r.ok, false);
  assert.equal(r.summary, "web_search failed. Do not retry the same request.");
  assert.equal(r.summary.includes("169.254.169.254"), false);
  assert.equal(diagnostics[0].tool, "web_search");
  assert.match(diagnostics[0].err.message, /169\.254\.169\.254/);
});

test("an executor that hangs is cut off at the per-call ceiling", async () => {
  let aborted = false;
  const reg = buildRegistry({ search: (_query, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => { aborted = true; reject(new Error("stopped")); }, { once: true });
  }) });
  const started = Date.now();
  const r = await reg.execute({ name: "web_search", args: { query: "a" } }, { timeoutMs: 60 });
  assert.equal(r.ok, false);
  assert.ok(r.summary.includes("timed out"));
  assert.equal(aborted, true);
  assert.ok(Date.now() - started < 1000);
});

test("a caller cannot expand the registry's per-tool ceiling", () => {
  assert.equal(clampTimeoutMs(60_000), 8_000);
  assert.equal(clampTimeoutMs(Infinity), 8_000);
  assert.equal(clampTimeoutMs(250), 250);
});

test("a parent abort reaches the executor and resolves as a cancellation", async () => {
  const controller = new AbortController();
  let aborted = false;
  const reg = buildRegistry({ search: (_query, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => { aborted = true; reject(new Error("stopped")); }, { once: true });
  }) });
  const pending = reg.execute({ name: "web_search", args: { query: "a" } }, { timeoutMs: 5000, signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  const r = await pending;
  assert.equal(aborted, true);
  assert.equal(r.ok, false);
  assert.match(r.summary, /cancelled/);
});

test("a garbage call object is refused rather than crashing", async () => {
  for (const call of [null, undefined, {}, { name: null }, { name: "web_search" }]) {
    const r = await full().execute(call);
    assert.equal(r.ok, false, JSON.stringify(call));
  }
});

/* ONE tool for ~110 SerpApi engines. The thing worth protecting is that it
 * stays one: a future change that registers a tool per engine would put ~1,500
 * tokens of engine descriptions into every seat's prompt on every turn. */
test('search_specialized is offered only when SerpApi is configured', () => {
  const withKey = buildRegistry({
    searchEngine: async () => ({ ok: true, engine: 'google_shopping', rows: [{}], text: 'x' }),
    engineNames: ['google_shopping'],
    engineMenu: 'google_shopping (prices)',
  });
  assert.ok(withKey.has('search_specialized'));

  // No executor means the council is told the tool does not exist, rather than
  // being offered one that errors every time and eats the retry budget.
  const without = buildRegistry({ engineNames: ['google_shopping'] });
  assert.equal(without.has('search_specialized'), false);
  // An empty engine list is the same situation.
  assert.equal(buildRegistry({ searchEngine: async () => ({}), engineNames: [] }).has('search_specialized'), false);
});

test('search_specialized is ONE tool, not one per engine', () => {
  const many = Array.from({ length: 40 }, (_, i) => `engine_${i}`);
  const registry = buildRegistry({
    searchEngine: async () => ({ ok: true, engine: 'e', rows: [{}], text: 'x' }),
    engineNames: many,
    engineMenu: many.join(', '),
  });
  const names = registry.list().map((t) => t.name);
  assert.equal(names.filter((n) => n.startsWith('search_')).length, 1);
});

test('search_specialized passes the engine through and reports refusals', async () => {
  const seen = [];
  const registry = buildRegistry({
    searchEngine: async (args) => {
      seen.push(args);
      return { ok: true, engine: args.engine, rows: [{}, {}], text: 'two rows' };
    },
    engineNames: ['google_flights'],
    engineMenu: 'google_flights (flights)',
  });
  const res = await registry.execute({
    name: 'search_specialized',
    args: { engine: 'google_flights', query: 'DXB to LHR', params: '{"departure_id":"DXB"}' },
  });
  assert.equal(res.ok, true);
  assert.equal(seen[0].engine, 'google_flights');
  assert.deepEqual(seen[0].params, { departure_id: 'DXB' });
});

test('malformed params do not fail the call', async () => {
  // The engine and query are usually the whole request; spending a round to
  // punish a formatting slip in an OPTIONAL argument is the wrong trade.
  const registry = buildRegistry({
    searchEngine: async (args) => ({ ok: true, engine: args.engine, rows: [{}], text: 'ok', params: args.params }),
    engineNames: ['google_shopping'],
    engineMenu: 'google_shopping (prices)',
  });
  const res = await registry.execute({
    name: 'search_specialized',
    args: { engine: 'google_shopping', query: 'monitor', params: 'not json at all' },
  });
  assert.equal(res.ok, true);
});

test('a refused engine comes back as a failed tool result, not a thrown turn', async () => {
  const registry = buildRegistry({
    searchEngine: async () => ({ ok: false, error: 'Unknown engine "google_cars".', rows: [], text: '' }),
    engineNames: ['google_shopping'],
    engineMenu: 'google_shopping (prices)',
  });
  const res = await registry.execute({ name: 'search_specialized', args: { engine: 'google_cars' } });
  assert.equal(res.ok, false);
  assert.match(res.summary, /Unknown engine/);
});

test('an unknown specialised engine is refused at the registry boundary', async () => {
  let ran = false;
  const registry = buildRegistry({
    searchEngine: async () => { ran = true; return { ok: true, engine: 'invented', rows: [{}], text: 'x' }; },
    engineNames: ['google_shopping'],
    engineMenu: 'google_shopping (prices)',
  });
  const res = await registry.execute({ name: 'search_specialized', args: { engine: 'invented' } });
  assert.equal(res.ok, false);
  assert.equal(ran, false, 'an invalid engine reached the billed executor');
});

/* ---- search_files: one call across every attached document ---- */

const CORPUS_FILES = [
  { id: "11111111-1111-4111-8111-111111111111", name: "notes.txt", kind: "text", content: "Meeting notes about scheduling and rooms." },
  { id: "22222222-2222-4222-8222-222222222222", name: "misc-2019.pdf", kind: "pdf", content: "The restocking fee is 12 percent for opened electronics returned within 14 days." },
];

const searchStore = (files = CORPUS_FILES) => ({
  list: async () => files.map(({ id, name }) => ({ id, name })),
  get: async (id) => files.find((f) => f.id === id) || null,
  all: async () => files,
});

test("search_files is offered only when the store can read every file", () => {
  assert.equal(buildRegistry({ files: searchStore() }).has("search_files"), true);
  // The older two-method store gets no tool rather than a broken one.
  assert.equal(withFiles().has("search_files"), false);
});

test("search_files finds the passage in the file the model would not have guessed", async () => {
  const reg = buildRegistry({ files: searchStore() });
  const out = await reg.execute({ name: "search_files", args: { query: "restocking fee" } });
  assert.equal(out.ok, true);
  assert.match(out.content, /restocking fee is 12 percent/);
  assert.match(out.content, /misc-2019\.pdf/);
  assert.match(out.summary, /misc-2019\.pdf/);
});

test("search_files says the documents were searched when nothing matches", async () => {
  const reg = buildRegistry({ files: searchStore() });
  const out = await reg.execute({ name: "search_files", args: { query: "photosynthesis" } });
  // ok, not a failure: "it is not in your documents" is an answer.
  assert.equal(out.ok, true);
  assert.match(out.content, /The documents were searched/);
  assert.match(out.content, /notes\.txt/);
});

test("search_files reports an empty conversation rather than searching nothing", async () => {
  const reg = buildRegistry({ files: searchStore([]) });
  const out = await reg.execute({ name: "search_files", args: { query: "anything" } });
  assert.equal(out.ok, false);
});

/* ---- search_files: the vector side, and every way it declines ---- */

/* A stand-in embedder with no network in it. Two orthogonal directions is
 * enough: the point under test is the wiring and the degradations, not the
 * quality of a real embedding space (that is `doc-passages.test.js`). */
const BLANK_LINE = String.fromCharCode(10, 10);
const DIRECTION = { refund: [1, 0, 0], schedule: [0, 1, 0] };
const fakeEmbedder = (topicOf) => async ({ query, texts }) => ({
  queryVector: DIRECTION[topicOf(query)] || null,
  vectors: texts.map((t) => DIRECTION[topicOf(t)] || null),
});
const topicByWord = (text) => (/refund|money back|reimburs/i.test(text) ? "refund" : "schedule");

const PARAPHRASE_FILES = [
  { id: "33333333-3333-4333-8333-333333333333", name: "policy.md", kind: "text", content: "Money paid up front is reimbursed in full when a booking is cancelled early." },
];

test("search_files without an embedder is the lexical search it always was", async () => {
  const reg = buildRegistry({ files: searchStore() });
  const out = await reg.execute({ name: "search_files", args: { query: "restocking fee" } });
  assert.equal(out.ok, true);
  assert.match(out.content, /restocking fee is 12 percent/);
  // No degradation notice, because nothing was degraded.
  assert.ok(!/words only/.test(out.content));
});

test("THE HOLE: a paraphrased question finds nothing lexically and is found with an embedder", async () => {
  const store = searchStore(PARAPHRASE_FILES);
  const query = "refund policy";

  const without = await buildRegistry({ files: store }).execute({ name: "search_files", args: { query } });
  assert.match(without.content, /The documents were searched/);

  const withVectors = await buildRegistry({ files: store, embedPassages: fakeEmbedder(topicByWord) })
    .execute({ name: "search_files", args: { query } });
  assert.match(withVectors.content, /reimbursed in full/);
});

test("an embedder that fails leaves the lexical answer standing", async () => {
  const reg = buildRegistry({
    files: searchStore(),
    embedPassages: async () => { throw new Error("provider refused"); },
  });
  const out = await reg.execute({ name: "search_files", args: { query: "restocking fee" } });
  assert.equal(out.ok, true);
  assert.match(out.content, /restocking fee is 12 percent/);
});

test("an embedder returning nothing usable leaves the lexical answer standing", async () => {
  for (const embedPassages of [async () => null, async () => ({ queryVector: null, vectors: [] })]) {
    const out = await buildRegistry({ files: searchStore(), embedPassages })
      .execute({ name: "search_files", args: { query: "restocking fee" } });
    assert.equal(out.ok, true);
    assert.match(out.content, /restocking fee is 12 percent/);
  }
});

test("a corpus too large to embed is searched lexically AND SAYS SO", async () => {
  // Silence here is the defect: a lexical-only answer to a paraphrased question
  // is indistinguishable from "your documents do not discuss this".
  const big = [{
    id: "44444444-4444-4444-8444-444444444444",
    name: "huge.md",
    kind: "text",
    content: Array.from({ length: 1500 }, (_, i) => `Paragraph ${i} discussing the restocking fee and other administrative matters.`).join(BLANK_LINE),
  }];
  let called = false;
  const reg = buildRegistry({
    files: searchStore(big),
    embedPassages: async () => { called = true; return null; },
  });
  const out = await reg.execute({ name: "search_files", args: { query: "restocking fee" } });
  assert.equal(called, false, "an oversized corpus must not reach the embedding provider at all");
  assert.match(out.content, /words only/);
});
