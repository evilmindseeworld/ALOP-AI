const test = require("node:test");
const assert = require("node:assert/strict");
const { checkTerminalAccess, terminalConfig, safeEqual, parseAdmins } = require("./terminal-access");

const SECRET = "a".repeat(32);
const ENV = { TERMINAL_ADMINS: "user_owner", TERMINAL_SECRET: SECRET };
const OK = { clerkUserId: "user_owner", isAdmin: true, secret: SECRET };

test("all four conditions together are allowed", () => {
  assert.equal(checkTerminalAccess(OK, ENV).allowed, true);
});

// ===== each condition is independently sufficient to refuse =====

test("a valid admin session with the wrong secret is refused", () => {
  // The condition that survives a stolen session: a hijacked cookie satisfies
  // everything else and stops here, because the secret is never in the browser.
  assert.equal(checkTerminalAccess({ ...OK, secret: "wrong" }, ENV).allowed, false);
  assert.equal(checkTerminalAccess({ ...OK, secret: "" }, ENV).allowed, false);
  assert.equal(checkTerminalAccess({ ...OK, secret: undefined }, ENV).allowed, false);
});

test("ANOTHER ADMIN IS STILL REFUSED", () => {
  // This is the condition that makes the console one person's. is_admin is a
  // database column and anything that can write to that table can grant it;
  // TERMINAL_ADMINS lives in the environment and needs Render, not SQL.
  assert.equal(checkTerminalAccess({ ...OK, clerkUserId: "user_someone_else" }, ENV).allowed, false);
});

test("a non-admin on the allowlist is refused", () => {
  assert.equal(checkTerminalAccess({ ...OK, isAdmin: false }, ENV).allowed, false);
});

test("no session is refused", () => {
  assert.equal(checkTerminalAccess({ ...OK, clerkUserId: "" }, ENV).allowed, false);
  assert.equal(checkTerminalAccess({}, ENV).allowed, false);
  assert.equal(checkTerminalAccess(undefined, ENV).allowed, false);
});

// ===== fails closed =====

test("UNCONFIGURED MEANS DISABLED, NEVER OPEN", () => {
  // The most likely way this becomes dangerous is a deploy that lands before
  // the variables are set. It must not fall back to is_admin.
  for (const env of [
    {},
    { TERMINAL_SECRET: SECRET },
    { TERMINAL_ADMINS: "user_owner" },
    { TERMINAL_ADMINS: "", TERMINAL_SECRET: SECRET },
    { TERMINAL_ADMINS: "   ", TERMINAL_SECRET: SECRET },
  ]) {
    assert.equal(checkTerminalAccess(OK, env).allowed, false, JSON.stringify(env));
    assert.equal(terminalConfig(env).enabled, false, JSON.stringify(env));
  }
});

test("a short secret counts as unconfigured, because it looks configured", () => {
  const env = { TERMINAL_ADMINS: "user_owner", TERMINAL_SECRET: "hunter2" };
  assert.equal(terminalConfig(env).enabled, false);
  assert.match(terminalConfig(env).reason, /24 characters/);
  assert.equal(checkTerminalAccess({ ...OK, secret: "hunter2" }, env).allowed, false);
});

// ===== the refusal reveals nothing =====

test("the reason is for the audit log and is never a map of the lock", () => {
  // Distinct reasons are recorded so a real intrusion can be read afterwards.
  // The ROUTE must return one generic 403 — asserted in server.js, not here.
  const reasons = [
    checkTerminalAccess({ ...OK, secret: "x" }, ENV).reason,
    checkTerminalAccess({ ...OK, clerkUserId: "other" }, ENV).reason,
    checkTerminalAccess({ ...OK, isAdmin: false }, ENV).reason,
  ];
  assert.equal(new Set(reasons).size, 3);
  for (const r of reasons) assert.equal(typeof r, "string");
});

// ===== the comparison =====

test("safeEqual matches only exact equal strings", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("abcd", "abc"), false);
});

test("safeEqual treats empty and non-string as never matching", () => {
  // Otherwise an unset secret on both sides would compare equal and open the
  // door — which is the same class of bug as failing open when unconfigured.
  assert.equal(safeEqual("", ""), false);
  assert.equal(safeEqual(undefined, undefined), false);
  assert.equal(safeEqual(null, null), false);
  assert.equal(safeEqual(0, 0), false);
  assert.equal(safeEqual({}, {}), false);
});

test("safeEqual does not return early on a length mismatch", () => {
  // An early return leaks the length, which is a slow but real oracle. This
  // asserts the shape rather than timing: it must still produce a boolean for
  // wildly different lengths without throwing.
  assert.equal(safeEqual("a", "a".repeat(4096)), false);
  assert.equal(safeEqual("a".repeat(4096), "a"), false);
});

test("the admin list tolerates spacing and empty entries", () => {
  assert.deepEqual(parseAdmins(" user_a , , user_b "), ["user_a", "user_b"]);
  assert.deepEqual(parseAdmins(undefined), []);
  assert.deepEqual(parseAdmins(""), []);
  const env = { TERMINAL_ADMINS: " user_owner , user_two ", TERMINAL_SECRET: SECRET };
  assert.equal(checkTerminalAccess(OK, env).allowed, true);
  assert.equal(checkTerminalAccess({ ...OK, clerkUserId: "user_two" }, env).allowed, true);
  assert.equal(checkTerminalAccess({ ...OK, clerkUserId: "user_three" }, env).allowed, false);
});
