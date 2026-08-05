const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRegistry, MAX_RESULT_CHARS } = require("./tool-registry");

const RESULTS = [
  { title: "RTINGS OLED", url: "https://rtings.com/a", description: "Burn-in results." },
  { title: "Tom's Hardware", url: "https://th.com/b", description: "Panel comparison." },
];

const full = (over = {}) =>
  buildRegistry({
    search: async () => RESULTS,
    readUrl: async () => "# Page\n\nBody text.",
    assertSafeUrl: async (u) => ({ url: new URL(u) }),
    ...over,
  });

// ===== registration =====

test("offers exactly the tools whose backing is present", () => {
  assert.deepEqual(full().list().map((t) => t.name), ["web_search", "read_url"]);
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

// ===== execution =====

test("web_search renders results the model can act on", async () => {
  const r = await full().execute({ name: "web_search", args: { query: "OLED" } });
  assert.equal(r.ok, true);
  assert.ok(r.content.includes("rtings.com/a"));
  assert.ok(r.content.includes("RTINGS OLED"));
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
    readUrl: async (u) => { fetched = u; return "body"; },
    assertSafeUrl: async (u) => { guarded = u; return { url: new URL(u) }; },
  });
  await reg.execute({ name: "read_url", args: { url: "https://example.com/x" } });
  assert.equal(guarded, "https://example.com/x");
  assert.ok(fetched.startsWith("https://example.com/x"));
});

test("a blocked URL never reaches the fetcher", async () => {
  let fetched = false;
  const reg = buildRegistry({
    readUrl: async () => { fetched = true; return "secrets"; },
    assertSafeUrl: async () => { throw new Error("resolves to 169.254.169.254, which is a private or reserved address."); },
  });
  const r = await reg.execute({ name: "read_url", args: { url: "http://metadata.internal/" } });
  assert.equal(fetched, false, "the guard must run BEFORE the fetch, not alongside it");
  assert.equal(r.ok, false);
  assert.ok(r.summary.includes("169.254.169.254"));
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
    readUrl: async () => "y".repeat(50000),
    assertSafeUrl: async (u) => ({ url: new URL(u) }),
  });
  const r = await reg.execute({ name: "read_url", args: { url: "https://e.test" } });
  assert.ok(r.content.length < MAX_RESULT_CHARS + 100);
  assert.ok(r.content.includes("truncated"));
});

// ===== an executor must never take down the turn =====

test("an executor that throws is a failed result, not a thrown error", async () => {
  const reg = buildRegistry({ search: async () => { throw new Error("network died"); } });
  const r = await reg.execute({ name: "web_search", args: { query: "a" } });
  assert.equal(r.ok, false);
  assert.ok(r.summary.includes("network died"));
});

test("an executor that hangs is cut off at the per-call ceiling", async () => {
  const reg = buildRegistry({ search: () => new Promise(() => {}) });
  const started = Date.now();
  const r = await reg.execute({ name: "web_search", args: { query: "a" } }, { timeoutMs: 60 });
  assert.equal(r.ok, false);
  assert.ok(r.summary.includes("timed out"));
  assert.ok(Date.now() - started < 1000);
});

test("a garbage call object is refused rather than crashing", async () => {
  for (const call of [null, undefined, {}, { name: null }, { name: "web_search" }]) {
    const r = await full().execute(call);
    assert.equal(r.ok, false, JSON.stringify(call));
  }
});
