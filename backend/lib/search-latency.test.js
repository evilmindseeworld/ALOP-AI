const test = require("node:test");
const assert = require("node:assert");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { settleByDeadline } = require("./deadline");

/**
 * The speculative page read, and the one way it can go wrong.
 *
 * comprehensiveSearch lives in server.js, which cannot be required in a test —
 * it calls process.exit(1) at import time on missing env vars — so the wiring
 * is asserted as source, the way route-config.test.js and env-example.test.js
 * already do here. The BEHAVIOUR that the wiring depends on is exercised for
 * real below, against settleByDeadline itself.
 *
 * What is being protected: the read is started from a `.then` on the Tavily
 * promise and never awaited. The obvious-looking tidy-up — `const t = await
 * tavilyP` before the fan-out — reads as equivalent and is not. It reintroduces
 * exactly the stall the search whip exists to remove: a Tavily that the 3.5s
 * deadline has already given up on would hold the request open until its own
 * 7s timeout, making the app SLOWER than before the optimisation. That
 * regression produces no error and no log line.
 */

const SOURCE = readFileSync(join(__dirname, "..", "server.js"), "utf8");
const BLOCK = SOURCE.slice(SOURCE.indexOf("const comprehensiveSearch"), SOURCE.indexOf("// ===== MEMORY ====="));

test("the page read is started from a callback, not an await", () => {
  assert.match(BLOCK, /tavilyP\.then\(/, "the warm read must hang off tavilyP without awaiting it");
  assert.doesNotMatch(BLOCK, /await\s+tavilyP/, "awaiting tavilyP stalls on a provider the whip already abandoned");
  assert.doesNotMatch(BLOCK, /await\s+warm/, "awaiting warm has the same effect one step removed");
});

test("the warm read is only used for the page that would have been read anyway", () => {
  // Tavily is first in the precedence order, but not always the source that
  // sorts first. Using a warm read for a DIFFERENT url would quietly swap which
  // page the answer is grounded in — a correctness change disguised as a speed
  // one.
  // The read target is now chosen by rankReadTargets rather than being
  // `sources[0]`, so the variable is the url under consideration — but the
  // invariant is unchanged and is the reason the check is still here.
  assert.match(BLOCK, /warm\.url === url/);
});

test("more than one page is read, and the reads share one deadline", () => {
  // One page was not enough: `sources[0]` on a shopping question is a category
  // listing whose prices are painted in by JavaScript, so the read returned
  // navigation and the answer told the user to go and check the shops itself.
  // Reading three costs the same wall clock ONLY while they stay inside a
  // single settleByDeadline — a loop that awaits each read in turn would make
  // the deep read three times as slow with no error to show for it.
  assert.match(BLOCK, /rankReadTargets\(sources/);
  const readBlock = BLOCK.slice(BLOCK.indexOf("rankReadTargets(sources"));
  assert.doesNotMatch(readBlock.slice(0, 600), /for\s*\(|forEach\([^)]*await|await\s+readPageContent/);
});

test("the fan-out still stops at its deadline when a provider never answers", () => {
  // The property the whole design rests on, exercised for real rather than
  // asserted about. A provider that hangs must cost the deadline and not its
  // own timeout.
  const started = Date.now();
  const never = new Promise(() => {});
  return settleByDeadline(
    [{ promise: Promise.resolve(["fast"]), fallback: [] }, { promise: never, fallback: [] }],
    { deadlineMs: 120 },
  ).then(({ results, pending }) => {
    const elapsed = Date.now() - started;
    assert.deepEqual(results[0], ["fast"]);
    assert.deepEqual(results[1], [], "the hung provider contributes its fallback");
    assert.equal(pending, 1);
    assert.ok(elapsed < 1000, `waited ${elapsed}ms — the deadline did not hold`);
  });
});

test("a rejected provider is a fallback, not a thrown request", () => {
  // Every provider here already catches internally, so this is the belt to that
  // pair of braces: a future provider that forgets must degrade the search
  // rather than fail the turn.
  return settleByDeadline(
    [{ promise: Promise.reject(new Error("boom")), fallback: [] }],
    { deadlineMs: 100 },
  ).then(({ results }) => assert.deepEqual(results[0], []));
});

test("the two search queries fan out concurrently", () => {
  // Serial, two queries would double the wall clock and the feature would not
  // be worth having. Promise.all over the map is what makes a second research
  // angle free in time and paid for only in provider quota.
  const call = SOURCE.slice(SOURCE.indexOf("const perQuery"), SOURCE.indexOf("const perQuery") + 300);
  assert.match(call, /Promise\.all\(/);
  assert.match(call, /searchQueries\.map\(/);
});
