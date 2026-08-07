const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

/**
 * The chat LIST must not carry transcripts.
 *
 * GET /api/chats selected `messages` for every chat the user owns, on every app
 * load, to render a sidebar that shows a title and a date. A user with 50
 * conversations of 20 messages downloaded several megabytes of JSON to draw 50
 * rows of text — over a connection that had just paid a cold start — and the
 * client then discarded all but one conversation's messages.
 *
 * This is a source contract because the failure is invisible at the size the
 * developer's own account happens to be. It gets slower per conversation the
 * user has ever created, which means it is worst for the users you least want
 * to lose and fine for everybody testing it.
 */

const SRC = readFileSync(join(__dirname, "..", "server.js"), "utf8");

/** The body of a route handler, from its app.<verb>( to the matching blank line. */
const route = (verb, path) => {
  const i = SRC.indexOf(`app.${verb}('${path}'`);
  if (i === -1) return null;
  // Far enough to cover the handler, short enough not to swallow the next one.
  return SRC.slice(i, i + 2600);
};

test("both chat routes still exist and parse", () => {
  // A guard on the guard: every assertion below is vacuous if these are null.
  assert.ok(route("get", "/api/chats"), "GET /api/chats not found");
  assert.ok(route("get", "/api/chats/:id"), "GET /api/chats/:id not found");
});

test("the LIST does not select messages", () => {
  const list = route("get", "/api/chats");
  const select = /\.select\('([^']+)'\)/.exec(list);
  assert.ok(select, "no .select() found on the list route");
  const columns = select[1].split(",").map((c) => c.trim());
  assert.ok(
    !columns.includes("messages"),
    `the chat list is selecting messages again: ${select[1]}`,
  );
  // And it still returns what the sidebar actually renders.
  for (const needed of ["id", "title", "updated_at", "pinned", "favorite"]) {
    assert.ok(columns.includes(needed), `the sidebar needs ${needed}`);
  }
});

test("the single-chat route DOES select messages", () => {
  // The other half. If this stopped selecting them, transcripts would silently
  // come back empty and the list test above would still pass.
  const one = route("get", "/api/chats/:id");
  const select = /\.select\('([^']+)'\)/.exec(one);
  assert.ok(select, "no .select() found on the single-chat route");
  assert.ok(select[1].split(",").map((c) => c.trim()).includes("messages"));
});

test("the single-chat route is ownership-checked", () => {
  // It reads a whole transcript by UUID. requireOwnership re-checks the row
  // belongs to the caller before the handler runs; without it this is a way to
  // read someone else's conversation by guessing an id.
  const one = route("get", "/api/chats/:id");
  assert.match(one.split("\n")[0], /requireOwnership\('chats'\)/);
  // Belt and braces: the query itself is also scoped, which tenant-scope.test.js
  // enforces across every chats query.
  assert.match(one, /\.eq\('user_id', user\.id\)/);
});

test("the list is bounded, and the bound cannot be raised by the caller", () => {
  const list = route("get", "/api/chats");
  // "select every row this user owns" has no ceiling.
  assert.match(list, /\.range\(/, "the list is unpaginated");
  assert.match(list, /Math\.min\(/, "the limit is not clamped");
  // A caller asking for 100000 must not get 100000.
  assert.match(list, /Number\.parseInt\(req\.query\.limit, 10\)/);
  assert.match(list, /Math\.min\(Math\.max\(parsedLimit, 1\), 100\)/);
  assert.match(list, /: 50;/, "the default page size disappeared");
});

test("offset is non-negative and capped before it reaches Postgres", () => {
  // A negative range start is a Postgres error, while a huge positive offset
  // makes the database walk and discard rows. Neither belongs on a user route.
  const list = route("get", "/api/chats");
  assert.match(list, /Number\.parseInt\(req\.query\.offset, 10\)/);
  assert.match(list, /Math\.min\(Math\.max\(parsedOffset, 0\), MAX_CHAT_OFFSET\)/);
  assert.match(SRC, /const MAX_CHAT_OFFSET = 10000/);
});

test("message PUTs use compare-and-set and reject conflicts", () => {
  const put = route("put", "/api/chats/:id");
  assert.match(put, /expectedUpdatedAt/);
  assert.match(put, /writeChatMessages/);
  assert.match(put, /status\(409\)/);
  assert.match(SRC, /writeChatMessages[\s\S]*?\.eq\('user_id', user\.id\)/);
});

test("the migration indexes exactly the query the list runs", () => {
  // .eq('user_id', …).order('updated_at', desc) — the composite has to be in
  // that column order or the sort stays in the plan.
  const sql = readFileSync(join(__dirname, "..", "migrations", "007_chats_index.sql"), "utf8");
  assert.match(sql, /ON chats \(user_id, updated_at DESC\)/i);
  // CONCURRENTLY, because this runs against a live table.
  assert.match(sql, /CREATE INDEX CONCURRENTLY/i);
});
