const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

/**
 * Every query against a user-owned table must say WHOSE row it wants.
 *
 * This is a source contract rather than a unit test because the thing it
 * guards cannot be reached without a database, and the bug it exists for was
 * invisible in every other way:
 *
 *     supabase.from('chats').select('conversation_summary').eq('id', chatId)
 *     supabase.from('chats').update({ conversation_summary: ... }).eq('id', chatId)
 *
 * `chatId` arrives in the request body of /api/council. Neither line filtered
 * on the owner, so any authenticated account could pass any chat's id and have
 * that conversation's summary read into a model prompt and the result written
 * back over it — one account silently conditioning another account's assistant
 * on text of its choosing. The function three lines below them, doing the same
 * read, had `.eq('user_id', userId)` all along.
 *
 * RLS does not cover this and never would. The server holds
 * SUPABASE_SERVICE_ROLE_KEY, which bypasses row-level security by design, so
 * the policies in migration 002 are simply not consulted for this client. The
 * ownership check has to be in the query, which means something has to check
 * that it is in the query.
 *
 * WHAT THIS DOES NOT CLAIM. It is a grep, not a proof. It cannot tell that the
 * userId being filtered on is the caller's rather than one also taken from the
 * request body. It is calibrated to catch the mistake that was actually made —
 * a query addressed by row id and nothing else — and it fails loudly if the
 * code is reshaped past what it can parse, rather than passing on zero matches.
 */

const SRC = readFileSync(join(__dirname, "..", "server.js"), "utf8");

/** Tables whose rows belong to exactly one user. */
const OWNED = ["chats", "chat_files", "user_facts"];

/**
 * A statement runs from `.from('table')` to the next semicolon, NOT to the end
 * of the line. The first version of this file read one line and reported the
 * file-upload insert as unscoped — it carries `user_id: user.id`, on the
 * following line. The code was right and the parser was wrong, which is worth
 * leaving a note about: a contract that reads source has to match how the
 * source is actually written, and a false positive here trains whoever is next
 * to loosen the check.
 */
const lineOf = (offset) => SRC.slice(0, offset).split("\n").length;

const statements = (table) => {
  const needle = `.from('${table}')`;
  const out = [];
  for (let i = SRC.indexOf(needle); i !== -1; i = SRC.indexOf(needle, i + 1)) {
    const end = SRC.indexOf(";", i);
    out.push({ n: lineOf(i), stmt: SRC.slice(i + needle.length, end === -1 ? undefined : end) });
  }
  return out;
};

/**
 * Routes reached only through requireAdmin, plus the Stripe webhook. An admin
 * listing another user's chats is the feature, not the bug; the webhook is
 * signature-verified and addresses users by Stripe id.
 */
const ADMIN_OR_WEBHOOK = /requireAdmin|stripe|webhook/i;

test("the parser still finds the queries it is meant to be checking", () => {
  // A guard on the guard. If server.js is reformatted so these no longer sit on
  // one line, this file would quietly check nothing and keep passing.
  for (const table of OWNED) {
    assert.ok(
      statements(table).length >= 2,
      `only ${statements(table).length} '${table}' statements parsed — the contract has stopped reading the file`,
    );
  }
});

test("every chats/chat_files query names an owner", () => {
  const unscoped = [];
  for (const table of OWNED) {
    for (const { n, stmt } of statements(table)) {
      // The route's guards sit on the `app.<verb>(` line for these routes, so
      // the enclosing line is where an admin gate is visible.
      const line = SRC.split("\n")[n - 1];
      if (ADMIN_OR_WEBHOOK.test(line)) continue;
      // Covers both shapes: a filter (`.eq('user_id', ...)`) and an insert
      // that supplies the owner in its payload.
      if (/user_id/.test(stmt)) continue;
      unscoped.push(`server.js:${n} — .from('${table}') with no user_id`);
    }
  }
  assert.deepEqual(
    unscoped,
    [],
    `queries addressed by row id alone:\n  ${unscoped.join("\n  ")}`,
  );
});

test("the summary read and the summary write are both scoped", () => {
  // Named specifically, because these two lines are the ones that were wrong
  // and a future refactor that reintroduces either should fail on a test that
  // says what it is about rather than only on the sweep above.
  const summaryLines = SRC.split("\n").filter((l) => l.includes("conversation_summary") && l.includes(".from('chats')"));
  assert.ok(summaryLines.length >= 3, `expected the read, the write and readChatSummary, found ${summaryLines.length}`);
  for (const l of summaryLines) {
    assert.match(l, /user_id/, `unscoped conversation_summary query: ${l.trim().slice(0, 120)}`);
  }
});

test("the turn-memory funnel is called with an owner at every call site", () => {
  // updateChatSummary's signature changed from (chatId, userMsg, assistantMsg)
  // to (chatId, userId, userMsg, assistantMsg). A missed call site would pass
  // the user's message as the userId, which fails closed — the query matches no
  // row — but does so silently, losing memory rather than reporting anything.
  //
  // The terminal paths now call rememberTurn, which fans out to the summary and
  // to fact extraction, so rememberTurn is where the owner has to be right. It
  // is one funnel precisely so a seventh terminal path cannot be added with the
  // arguments in the wrong order.
  const calls = [...SRC.matchAll(/rememberTurn\(([^)]*)\)/g)]
    .map((m) => m[1])
    .filter((args) => !args.includes("=>")); // skip the declaration itself
  assert.ok(calls.length >= 5, `found only ${calls.length} rememberTurn call sites`);
  for (const args of calls) {
    const second = args.split(",")[1]?.trim();
    assert.equal(second, "user.id", `second argument is "${second}", not the owner`);
  }

  // And that the funnel passes its owner through rather than dropping it.
  const inner = [...SRC.matchAll(/updateChatSummary\(([^)]*)\)/g)]
    .map((m) => m[1])
    .filter((args) => !args.includes("=>"));
  assert.equal(inner.length, 1, `updateChatSummary should be called once, inside rememberTurn; found ${inner.length}`);
  assert.equal(inner[0].split(",")[1]?.trim(), "userId");

  const facts = [...SRC.matchAll(/updateUserFacts\(([^)]*)\)/g)]
    .map((m) => m[1])
    .filter((args) => !args.includes("=>"));
  assert.equal(facts.length, 1, `updateUserFacts should be called once, inside rememberTurn; found ${facts.length}`);
  assert.equal(facts[0].split(",")[0]?.trim(), "userId");
});

/* Facts are read from the user's turn and never from the answer, because a
 * stored fact is replayed at system position in every later conversation and
 * an answer carries text fetched from the open web. lib/user-facts.js explains
 * it; this asserts the call actually obeys it, since the argument is the whole
 * defence and it is one edit away from being the wrong one. */
test("fact extraction is fed the user's message, not the assistant's", () => {
  /* AN EXACT SIGNATURE, NOT A PARAMETER LIST, and the difference matters: a
   * destructured options bag contains a comma, so splitting on commas reads
   * `{ turnId = null } = {}` as two parameters and would accept anything
   * inside those braces. Matching the whole signature keeps this as strict as
   * it was — any new parameter, message-bearing or not, is a red test that a
   * person has to look at. The one permitted extra carries an ID and has no
   * way to carry text. */
  const decl = SRC.match(/const updateUserFacts = async \(([^)]*)\)/);
  assert.ok(decl, "updateUserFacts declaration not found — this contract has stopped reading the file");
  assert.equal(
    decl[1].replace(/\s+/g, " ").trim(),
    "userId, userMsg, { turnId = null } = {}",
    "updateUserFacts takes the user's message and an id-only options bag, nothing else",
  );

  const call = SRC.match(/updateUserFacts\(userId, ([^)]*)\)/);
  assert.ok(call, "updateUserFacts is not called with userId first");
  assert.equal(
    call[1].replace(/\s+/g, " ").trim(),
    "userMsg, { turnId }",
    "fact extraction must be fed userMsg, and the only other argument is the turn id",
  );
});

/* Semantic recall reaches the table through an RPC, which the sweep above
 * cannot see: `supabase.rpc('match_user_facts', ...)` contains no
 * `.from('user_facts')` to match on. The function is SECURITY INVOKER and the
 * server connects as service role, which bypasses RLS — so p_user_id is not a
 * filter, it is the entire tenant boundary, and an RPC that took the id from a
 * request body would read another account's memory into this account's prompt.
 * Migration 013 says the same thing at the SQL layer; this is the half of it
 * that can be checked. */
test("every semantic-recall RPC names an owner the server resolved", () => {
  const calls = [...SRC.matchAll(/supabase\.rpc\(\s*'match_user_facts'[\s\S]{0,400}?\}\)/g)].map((m) => m[0]);
  assert.ok(calls.length >= 1, "no match_user_facts call parsed — this contract has stopped reading the file");
  for (const call of calls) {
    assert.match(call, /p_user_id:\s*userId\b/, `match_user_facts called without the server's userId:\n${call.slice(0, 200)}`);
  }

  // And that the id reaching it is the route's authenticated user rather than
  // anything that travelled in the body.
  const decl = SRC.match(/const readUserFactsByMeaning = async \(([^)]*)\)/);
  assert.ok(decl, "readUserFactsByMeaning declaration not found");
  assert.equal(decl[1].split(",")[0].trim(), "userId");

  const injected = SRC.match(/readUserFacts\(user\.id, FACTS_INJECT_LIMIT, ([^)]*)\)/);
  assert.ok(injected, "the council's fact read no longer passes user.id and the turn text");
});

/* PROVENANCE IS ONLY WORTH THE COLUMN IF IT ARRIVES. `source_turn_id` answers
 * "why does the assistant believe this about me" and is the only way to undo
 * one bad turn's memories without clearing all of them — and a threading that
 * is wired but never passed writes null forever while every test passes. */
test('every rememberTurn call carries the canonical turn id', () => {
  const calls = [...SRC.matchAll(/rememberTurn\(([^;]*?)\);/g)].map((m) => m[1]);
  assert.ok(calls.length >= 5, `expected the terminal paths to call rememberTurn; found ${calls.length}`);
  for (const args of calls) {
    if (args.includes('=>')) continue; // the declaration itself
    assert.match(args, /turnContext\.turnId\s*$/, `rememberTurn without a turn id: ${args.slice(0, 80)}`);
  }
});
