const test = require("node:test");
const assert = require("node:assert");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

/**
 * EVERY PROMPT THAT ANSWERS A USER STATES THE DATE.
 *
 * server.js cannot be required in a test — it calls process.exit(1) at import
 * time when env vars are missing — so this reads it as text, which is the same
 * thing route-config.test.js and env-example.test.js already do here.
 *
 * The regression this exists for is not a crash. Adding a sixth answering
 * branch without the date line produces an app that is correct on five paths
 * and quietly two years out of date on the sixth, and nothing in any log says
 * which one you got. That is exactly how the original bug survived: the date
 * was missing from ALL of them, so no path looked anomalous next to another.
 *
 * Asserted by NAME rather than by counting `todayLine()` calls, so the failure
 * message says which prompt lost it.
 */

const SOURCE = readFileSync(join(__dirname, "..", "server.js"), "utf8");

/** The system-prompt variables that end up in front of a user's question. */
const ANSWERING_PROMPTS = [
  "extSys",   // search results -> answer
  "councilSys", // no search: the council answering from what it knows
  "synthSys", // the panel reconciled into the reply the user reads
  "fbSys",    // fallback when the council produced nothing
  "wikiSys",  // Wikipedia extraction
];

for (const name of ANSWERING_PROMPTS) {
  test(`${name} states today's date`, () => {
    const decl = new RegExp(`const ${name} = \`([\\s\\S]{0,200})`);
    const match = SOURCE.match(decl);
    assert.ok(match, `${name} not found — renamed? update this test rather than deleting it`);
    assert.match(
      match[1],
      /\$\{todayLine\(\)\}/,
      `${name} does not open with todayLine(). A model with no date answers from its training cutoff and cannot tell you it did.`,
    );
  });
}

test("the search DECISION knows the date too", () => {
  // Under-triggering is the failure here rather than a stale assertion: a model
  // that believes its training is current judges "what is the latest X" to be
  // answerable from memory and returns NO, so no source is ever fetched and
  // every later rule about preferring recent sources has nothing to act on.
  // `planTurn` since 2026-08-13, when the memory check and the search plan
  // became one call. The prompt is the same one; only the function around it
  // was renamed and given a third output branch.
  const decision = SOURCE.slice(SOURCE.indexOf("const planTurn"), SOURCE.indexOf("// ===== SEARCH FUNCTIONS"));
  assert.ok(decision, "planTurn is gone; the search decision has moved and this test needs updating");
  assert.match(decision, /\$\{todayLine\(\)\}/);
  assert.match(decision, /If in doubt, search/i);
});

test("the overlay states the date", () => {
  // The overlay is a separate route with its own prompt and was the last one
  // still answering time-dependent questions purely from recall.
  const overlay = SOURCE.slice(SOURCE.indexOf("You are ALOP-AI Overlay") - 400, SOURCE.indexOf("You are ALOP-AI Overlay"));
  assert.match(overlay, /todayLine\(\)/);
});

test("search results reach the prompt with their publication dates attached", () => {
  // Without this the model has a date for TODAY and no date for anything it is
  // reading, which is half a fix: it knows the year and still cannot tell which
  // of two contradicting sources is the current one.
  assert.match(SOURCE, /dateLabel\(r\.date\)/);
  // And it has to be told what to DO with them. Its default when two sources
  // disagree is to prefer the more detailed one, and stale pages are usually
  // the more detailed ones.
  assert.match(SOURCE, /prefer the most recent one/i);
});

test("the freshness window is derived from the user's question, not the generated query", () => {
  // The model is told to include a year "only when recency is the point", so
  // the query text is not a reliable signal — a question that plainly says
  // "right now" can produce a query with nothing time-ish in it at all.
  assert.match(SOURCE, /freshnessWindow\(pv\.value\)/);
});

test("the freshness window is part of the search cache key", () => {
  // Two questions can produce identical query text and want different windows.
  // Keying on the text alone serves the year-wide results to the question that
  // asked for today — the same staleness, reintroduced by the cache.
  const line = SOURCE.match(/const cacheKey = .*/);
  assert.ok(line, "cacheKey assignment not found");
  assert.match(line[0], /fresh/);
});
