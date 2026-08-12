const test = require("node:test");
const assert = require("node:assert/strict");
const { rateLimitKey } = require("./rate-limit-key");
/* THE FIXTURES HERE USED TO BE THE BUG. Every test below passed
 * `{ auth: { userId } }`, which no Clerk version puts on a request at limiter
 * time — @clerk/express 2.x assigns a branded FUNCTION. So this file proved the
 * key generator worked against an object that never existed, while in production
 * `req.auth.userId` was undefined and every limit fell back to the IP: exactly
 * the defect the module was written to fix, passing its own test the whole time.
 *
 * Clerk's internals are not importable — its `exports` map seals the dist file,
 * and the filename carries a build hash that would rot anyway. So the claim is
 * split in two: the tests below exercise a function-valued `req.auth`, and the
 * LAST test in this file reads the installed library to prove that is really
 * what Clerk assigns. Neither half is worth much alone; together they are the
 * fake and the check that the fake still resembles the thing. */
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

/** Stand-in for express-rate-limit's ipKeyGenerator. */
const ipFallback = (req) => req.ip;
const call = (req) => rateLimitKey(req, {}, ipFallback);

/** A request as `clerkMiddleware` actually leaves it: auth is a function. */
const signedIn = (ip, userId) => {
  const auth = () => ({ userId });
  return { ip, auth };
};
/** A request as `requireAuth` leaves it: the function replaced by the object. */
const resolved = (ip, userId) => ({ ip, auth: { userId } });

test("keys on the authenticated user when there is one", () => {
  assert.equal(call(signedIn("1.2.3.4", "user_abc")), "u:user_abc");
});

test("PRODUCTION SHAPE: a Clerk function-valued req.auth still keys on the user", () => {
  // The regression that matters. `req.auth.userId` on a function is undefined,
  // so this returned "ip:1.2.3.4" and every authenticated limit was keyed on
  // the address — one account rotating IPs collected a fresh allowance per
  // address, which is the exact abuse the per-user key exists to stop.
  const key = call(signedIn("1.2.3.4", "user_abc"));
  assert.ok(key.startsWith("u:"), `keyed on ${key} — the limiter is back on IP`);
});

test("both middleware shapes key identically", () => {
  // clerkMiddleware leaves a function; requireAuth later replaces it with the
  // resolved object. Limiters are mounted on both sides of that, so a generator
  // that understood only one shape would be wrong for half the routes.
  assert.equal(call(signedIn("1.2.3.4", "user_abc")), call(resolved("1.2.3.4", "user_abc")));
});

test("an unauthenticated request does not throw when auth() rejects", () => {
  // req.auth() throws when there is no session. That must fall through to the
  // IP key, not 500 the limiter and take every route with it.
  const req = { ip: "1.2.3.4", auth: () => { throw new Error("no session"); } };
  assert.equal(call(req), "ip:1.2.3.4");
});

test("the same user keeps one bucket across IP changes", () => {
  const a = call(signedIn("1.2.3.4", "user_abc"));
  const b = call(signedIn("9.9.9.9", "user_abc"));
  assert.equal(a, b);
});

test("falls back to the IP when unauthenticated", () => {
  assert.equal(call({ ip: "1.2.3.4" }), "ip:1.2.3.4");
});

test("different users on one IP are counted separately", () => {
  const a = call(signedIn("1.2.3.4", "user_a"));
  const b = call(signedIn("1.2.3.4", "user_b"));
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

/**
 * THE CHECK ON THE FAKE. Everything above uses a plain function for `req.auth`,
 * which is only meaningful if that is genuinely what Clerk puts there — and the
 * previous version of this file is proof that an unchecked fixture can agree
 * with itself for a year while production does the opposite.
 *
 * Clerk's dist file cannot be imported (its `exports` map seals the subpath, and
 * the filename carries a build hash), so the installed source is read instead.
 * If Clerk ever assigns a plain object again, this fails and the fixtures above
 * become suspect in the same commit.
 */
test("the installed Clerk really does assign a FUNCTION to req.auth", () => {
  const dir = join(__dirname, "..", "node_modules", "@clerk", "express", "dist");
  const index = readFileSync(join(dir, "index.js"), "utf8");

  // `const auth = brandRequestAuth((opts) => requestState.toAuth(opts));`
  // followed by `Object.assign(request, { auth });`
  assert.match(index, /brandRequestAuth\(\s*\(/, "Clerk no longer brands a callable auth");
  assert.match(index, /Object\.assign\(request,\s*\{\s*auth\s*\}\)/, "Clerk no longer assigns req.auth this way");

  // And the property lookup this module used to do is undefined on a function,
  // which is the entire defect stated as an assertion rather than as prose.
  const fn = () => ({ userId: "user_abc" });
  assert.equal(fn.userId, undefined);
  assert.equal(call({ ip: "1.2.3.4", auth: fn }), "u:user_abc");
});
