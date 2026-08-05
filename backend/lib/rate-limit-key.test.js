const test = require("node:test");
const assert = require("node:assert/strict");
const { rateLimitKey } = require("./rate-limit-key");

/** Stand-in for express-rate-limit's ipKeyGenerator. */
const ipFallback = (req) => req.ip;
const call = (req) => rateLimitKey(req, {}, ipFallback);

test("keys on the authenticated user when there is one", () => {
  assert.equal(call({ ip: "1.2.3.4", auth: { userId: "user_abc" } }), "u:user_abc");
});

test("the same user keeps one bucket across IP changes", () => {
  const a = call({ ip: "1.2.3.4", auth: { userId: "user_abc" } });
  const b = call({ ip: "9.9.9.9", auth: { userId: "user_abc" } });
  assert.equal(a, b);
});

test("falls back to the IP when unauthenticated", () => {
  assert.equal(call({ ip: "1.2.3.4" }), "ip:1.2.3.4");
});

test("different users on one IP are counted separately", () => {
  const a = call({ ip: "1.2.3.4", auth: { userId: "user_a" } });
  const b = call({ ip: "1.2.3.4", auth: { userId: "user_b" } });
  assert.notEqual(a, b);
});

/**
 * The bug. This is the whole reason the module exists: the old key mixed the
 * User-Agent in, so a caller who varied it got a fresh bucket per request and
 * every rate limit in the app became advisory.
 */
test("a changing User-Agent does NOT mint a new bucket", () => {
  const first = call({ ip: "1.2.3.4", headers: { "user-agent": "Mozilla/5.0" } });
  const second = call({ ip: "1.2.3.4", headers: { "user-agent": "totally-different-4821" } });
  const third = call({ ip: "1.2.3.4", headers: {} });
  assert.equal(first, second);
  assert.equal(second, third);
});

test("no client-controlled header reaches the key", () => {
  const withHeaders = call({
    ip: "1.2.3.4",
    headers: {
      "user-agent": "x",
      "x-forwarded-for": "8.8.8.8",
      "x-real-ip": "8.8.8.8",
      "accept-language": "xx",
      cookie: "a=b",
    },
  });
  assert.equal(withHeaders, "ip:1.2.3.4");
});

test("a user cannot collide with an IP bucket by choosing their id", () => {
  // Namespacing is why the prefixes exist: without them a userId of "1.2.3.4"
  // would share a bucket with that address.
  assert.notEqual(call({ ip: "1.2.3.4", auth: { userId: "1.2.3.4" } }), call({ ip: "1.2.3.4" }));
});

test("an empty or missing userId falls through to the IP rather than keying on nothing", () => {
  // A single "" bucket shared by every anonymous caller would be a global limit.
  assert.equal(call({ ip: "1.2.3.4", auth: {} }), "ip:1.2.3.4");
  assert.equal(call({ ip: "1.2.3.4", auth: { userId: "" } }), "ip:1.2.3.4");
  assert.equal(call({ ip: "1.2.3.4", auth: null }), "ip:1.2.3.4");
});
