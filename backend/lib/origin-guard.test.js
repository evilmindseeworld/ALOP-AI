const test = require("node:test");
const assert = require("node:assert/strict");
const { isOriginAllowed, originPolicyFromEnv } = require("./origin-guard");

const POLICY = {
  exact: ["https://alop-ai-omega.vercel.app"],
  suffixes: [".alop-ai-evilmindseeworlds-projects.vercel.app"],
};

test("allows the configured frontend exactly", () => {
  assert.equal(isOriginAllowed("https://alop-ai-omega.vercel.app", POLICY), true);
});

test("is case- and port-insensitive the way the browser is", () => {
  assert.equal(isOriginAllowed("https://ALOP-AI-OMEGA.vercel.app", POLICY), true);
  // A different port is a different origin, and must not inherit the allow.
  assert.equal(isOriginAllowed("https://alop-ai-omega.vercel.app:8443", POLICY), false);
});

test("allows a configured suffix", () => {
  assert.equal(
    isOriginAllowed("https://feature-x.alop-ai-evilmindseeworlds-projects.vercel.app", POLICY),
    true,
  );
});

// ---------------------------------------------------------------------------
// The bugs. Each of these was allowed by the substring test this replaces.
// ---------------------------------------------------------------------------

test("rejects an attacker domain that merely CONTAINS the trusted suffix", () => {
  // `'https://x.vercel.app.attacker.com'.includes('.vercel.app')` is true.
  assert.equal(isOriginAllowed("https://x.vercel.app.attacker.com", POLICY), false);
  assert.equal(isOriginAllowed("https://alop-ai-omega.vercel.app.attacker.com", POLICY), false);
});

test("rejects the trusted host smuggled into userinfo", () => {
  assert.equal(isOriginAllowed("https://alop-ai-omega.vercel.app@evil.com", POLICY), false);
  assert.equal(isOriginAllowed("https://user:pass@alop-ai-omega.vercel.app", POLICY), false);
});

test("rejects every OTHER vercel deployment", () => {
  // The substring rule allowed all of these, and vercel.app is free to sign up for.
  assert.equal(isOriginAllowed("https://totally-unrelated.vercel.app", POLICY), false);
  assert.equal(isOriginAllowed("https://attacker-clone.vercel.app", POLICY), false);
});

test("rejects a sibling that shares the suffix without the dot boundary", () => {
  assert.equal(
    isOriginAllowed("https://evil-alop-ai-evilmindseeworlds-projects.vercel.app", POLICY),
    false,
  );
});

test("ignores a configured suffix that is missing its leading dot", () => {
  // Otherwise a typo in one env var silently widens the allowlist to siblings.
  const sloppy = { exact: [], suffixes: ["alop-ai-evilmindseeworlds-projects.vercel.app"] };
  assert.equal(
    isOriginAllowed("https://evil-alop-ai-evilmindseeworlds-projects.vercel.app", sloppy),
    false,
  );
});

test("rejects the literal string null, which sandboxed iframes send", () => {
  assert.equal(isOriginAllowed("null", POLICY), false);
});

test("rejects plain http for anything but loopback", () => {
  assert.equal(isOriginAllowed("http://alop-ai-omega.vercel.app", POLICY), false);
  assert.equal(isOriginAllowed("http://localhost:5173", { exact: ["http://localhost:5173"] }), true);
});

test("rejects a non-URL", () => {
  assert.equal(isOriginAllowed("not a url", POLICY), false);
  assert.equal(isOriginAllowed("javascript:alert(1)", POLICY), false);
});

// ---------------------------------------------------------------------------

test("no Origin header is allowed: curl, webhooks and same-origin send none", () => {
  assert.equal(isOriginAllowed(undefined, POLICY), true);
  assert.equal(isOriginAllowed("", POLICY), true);
});

test("development allows everything, production does not", () => {
  assert.equal(isOriginAllowed("https://anything.example", { ...POLICY, allowAll: true }), true);
  assert.equal(isOriginAllowed("https://anything.example", { ...POLICY, allowAll: false }), false);
});

test("an unset ALLOWED_ORIGIN_SUFFIXES grants nothing extra", () => {
  // The bug class being fixed is a default wider than anyone realised. An
  // absent variable must never be the thing that opens the door.
  const policy = originPolicyFromEnv({ FRONTEND_URL: "https://alop-ai-omega.vercel.app" });
  assert.deepEqual(policy.suffixes, []);
  assert.equal(isOriginAllowed("https://anything-else.vercel.app", policy), false);
  assert.equal(isOriginAllowed("https://alop-ai-omega.vercel.app", policy), true);
});

test("env parsing trims and drops empties", () => {
  const policy = originPolicyFromEnv({
    FRONTEND_URL: "https://a.example",
    ALLOWED_ORIGIN_SUFFIXES: " .one.example , , .two.example ",
  });
  assert.deepEqual(policy.suffixes, [".one.example", ".two.example"]);
});
