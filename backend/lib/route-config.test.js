const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

/**
 * Rate limiters and body-size exemptions must name routes that exist.
 *
 * Three did not. `/api/quick`, `/api/vision` and `/api/image` each had a rate
 * limiter, and two of them were also on IMAGE_ROUTES, which is the list that
 * grants a 50 MB request body instead of 1 MB. There is no handler for any of
 * them and nothing in the frontend calls them.
 *
 * That is not merely untidy. Express parses the body before it routes, so a
 * POST to `/api/image` buffered up to 50 MB and then returned 404 — the raised
 * ceiling was attached to a door that was not there. And config naming a route
 * that does not exist is worse than absent config, because the next person to
 * add `/api/image` inherits a 50 MB limit and a 10/min cap they never chose and
 * will not think to look for.
 *
 * Dead config is invisible in every test that exercises real routes, because
 * the whole problem is that these are not real routes.
 */

const SRC = readFileSync(join(__dirname, "..", "server.js"), "utf8");

/** Paths that have an actual handler: app.get/post/put/delete('...'). */
const handlers = new Set(
  [...SRC.matchAll(/app\.(?:get|post|put|delete)\('([^']+)'/g)].map((m) => m[1]),
);

/** Paths named by a rate limiter: app.use('...', createLimiter(...)). */
const limited = [...SRC.matchAll(/app\.use\('([^']+)',\s*createLimiter/g)].map((m) => m[1]);

/** Paths granted the 50 MB body. */
const bigBody = (() => {
  const m = /const IMAGE_ROUTES = \[([^\]]*)\]/.exec(SRC);
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
})();

/**
 * A configured path covers a handler if any handler starts with it — these are
 * express prefix mounts, so `/api/admin/` covers `/api/admin/users`, and
 * `/api/chats` covers `/api/chats/:id/files`.
 */
const covers = (prefix) => [...handlers].some((h) => h.startsWith(prefix));

test("the parser found the routes and the config at all", () => {
  // A guard on the guard: if these regexes stop matching, every assertion below
  // becomes vacuously true.
  assert.ok(handlers.size >= 15, `only ${handlers.size} handlers parsed`);
  assert.ok(limited.length >= 8, `only ${limited.length} limiters parsed`);
  assert.ok(Array.isArray(bigBody) && bigBody.length >= 1, "IMAGE_ROUTES did not parse");
});

test("every rate limiter names a route that exists", () => {
  // `/api/` and `/health` are the two deliberate floors: `/api/` is the blanket
  // limit every route inherits, and /health sits outside it.
  const dead = limited.filter((p) => p !== "/api/" && !covers(p));
  assert.deepEqual(dead, [], `limiters for routes with no handler: ${dead.join(", ")}`);
});

test("every 50 MB body exemption names a route that exists", () => {
  const dead = bigBody.filter((p) => !covers(p));
  assert.deepEqual(dead, [], `50 MB granted to routes with no handler: ${dead.join(", ")}`);
});

test("the 50 MB body is granted only where an image can legitimately arrive", () => {
  // The ceiling exists for base64 image data URLs. Any other route on this list
  // is an endpoint that can be made to buffer fifty megabytes for no reason.
  assert.deepEqual([...bigBody].sort(), ["/api/council", "/api/overlay"]);
});

test("council vision starts before its independent context reads", () => {
  // An image description and the summary/feedback/facts reads do not depend on
  // each other. The source test is the reachable seam because server.js exits
  // during import when deployment env is absent; it guards the critical-path
  // ordering without pretending to call Gemini or Supabase in a unit test.
  const vision = SRC.indexOf("visionP = telemetry.measureContext('vision'");
  const context = SRC.indexOf("const dag = await runDag([");
  assert.ok(vision >= 0, "the vision request vanished");
  assert.ok(context >= 0, "the context reads vanished");
  assert.ok(vision < context, "vision is back behind the context round-trip");
  /* And it is still CONCURRENT rather than merely earlier. Vision is a DAG node
   * with no `needs`, which is what makes it start on the first tick alongside
   * the summary and the canonical transcript instead of waiting for them. */
  assert.match(SRC.slice(context, context + 1400), /name: 'vision',[\s\S]{0,200}?run: \(\) => visionP/);
  const visionNode = SRC.indexOf("name: 'vision'", context);
  const nodeBody = SRC.slice(visionNode, SRC.indexOf('},', visionNode));
  assert.doesNotMatch(nodeBody, /needs:/, 'vision depends on nothing and must declare nothing');
});

test("the routes that accept an image are rate limited", () => {
  // A 50 MB body under only the /api/ floor of 120/min is 6 GB a minute.
  for (const p of bigBody) {
    assert.ok(limited.includes(p), `${p} takes a 50 MB body with no limiter of its own`);
  }
});
