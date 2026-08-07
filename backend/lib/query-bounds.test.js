const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const SOURCE = readFileSync(join(__dirname, "..", "server.js"), "utf8");
const route = (path) => {
  const start = SOURCE.indexOf(`app.get('${path}'`);
  return start === -1 ? "" : SOURCE.slice(start, start + 2200);
};

test("admin users is paginated and does not return a bare unbounded array", () => {
  const source = route("/api/admin/users");
  assert.ok(source);
  assert.match(source, /boundedPage\(req\.query/);
  assert.match(source, /\.range\(page\.offset, page\.offset \+ page\.limit - 1\)/);
  assert.match(source, /res\.json\(\{ users,/);
  assert.doesNotMatch(source, /^\s*\.select\('\*'\)/m);
});

test("admin chat list is paginated and metadata-only", () => {
  const source = route("/api/admin/chats/:userId");
  assert.ok(source);
  assert.match(source, /uuidParam\('userId'\)/);
  assert.match(source, /boundedPage\(req\.query/);
  assert.match(source, /\.range\(page\.offset, page\.offset \+ page\.limit - 1\)/);
  assert.match(source, /\.select\('id,user_id,title,pinned,favorite,created_at,updated_at'\)/);
  assert.doesNotMatch(source, /^\s*\.select\('\*'\)/m);
});

test("file list remains bounded at the per-chat ceiling", () => {
  const start = SOURCE.indexOf("list: async () => {");
  assert.ok(start >= 0);
  const source = SOURCE.slice(start, start + 500);
  assert.match(source, /\.limit\(MAX_FILES_PER_CHAT\)/);
});

test("the new migration covers the only unindexed list shape this audit can prove", () => {
  const sql = readFileSync(join(__dirname, "..", "migrations", "009_query_indexes.sql"), "utf8");
  assert.match(sql, /CREATE INDEX CONCURRENTLY IF NOT EXISTS usage_user_recent/i);
  assert.match(sql, /ON usage \(user_id, date DESC\)/i);
  // A migration that silently adds the known chat/audit indexes again is a
  // duplicate-write regression, not a performance fix.
  assert.doesNotMatch(sql, /ON chats \(user_id, updated_at DESC\)/i);
  assert.doesNotMatch(sql, /ON audit_logs \(created_at DESC\)/i);
});
