'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * MOUNT ORDER IS A CONTRACT, AND NOTHING ELSE IN THIS SUITE CAN SEE IT.
 *
 * `rateLimitKey` prefers `u:<userId>` and falls back to the caller's IP. It is
 * correct, it is unit-tested, and for as long as anyone can tell it never once
 * returned a user key in production — because `clerkMiddleware` was mounted
 * about a hundred lines BELOW the limiters, so `req.auth` did not exist yet.
 * Its own comment said so: "Only routes that run their auth middleware before
 * the limiter will have it." None did.
 *
 * Every limit in the file was therefore an IP limit wearing a user limit's
 * clothes, and on this product that is money: a council turn is seven paid
 * model calls plus search plus a possible fallback whip, so one valid account
 * rotating source addresses collected a fresh allowance per address.
 *
 * A unit test on `rateLimitKey` passes either way — it is handed a `req` with
 * `auth` set. The defect lives in the ORDER of two `app.use` calls, so this
 * asserts the order, in the source, by position. `server.js` exits during
 * import when deployment configuration is absent, which is why this reads the
 * text rather than booting the app; the same seam
 * `council-runtime-contract.test.js` already uses.
 */
const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

const at = (needle) => {
  const i = SOURCE.indexOf(needle);
  assert.notEqual(i, -1, `anchor vanished from server.js: ${needle}`);
  return i;
};

test('clerkMiddleware is mounted BEFORE the rate limiters, so limits can key on the user', () => {
  const clerk = at('app.use(clerkMiddleware(');
  const firstLimiter = at("app.use('/api/', createLimiter(");
  assert.ok(
    clerk < firstLimiter,
    'clerkMiddleware must run first or req.auth is absent at limiter time and every limit silently degrades to an IP limit',
  );
});

test('every route-specific limiter is also below the Clerk mount', () => {
  const clerk = at('app.use(clerkMiddleware(');
  // A limiter added later, above the mount, would be IP-keyed while the ones
  // around it are user-keyed — the worst version of this bug, because the
  // others working hides it.
  const limiterMounts = [...SOURCE.matchAll(/app\.use\('\/[^']*',\s*createLimiter\(/g)];
  assert.ok(limiterMounts.length >= 10, 'expected the limiter block to still be here');
  for (const m of limiterMounts) {
    assert.ok(
      m.index > clerk,
      `a limiter is mounted above clerkMiddleware and will key on IP only: ...${SOURCE.slice(m.index, m.index + 60)}`,
    );
  }
});

test('the Stripe webhook stays above Clerk, where it needs to be', () => {
  // Not an oversight and must not be "fixed" by the rule above: the webhook
  // authenticates with a Stripe signature over the RAW body, and has no session.
  assert.ok(at("app.post('/api/stripe/webhook'") < at('app.use(clerkMiddleware('));
});

/**
 * A paid route without `checkSuspended` means suspension is not a kill switch.
 *
 * `/api/feedback` calls FAST_MODEL on every rating and had `requireAuth` only,
 * so a suspended account with a live session could keep spending. Found by Sol,
 * 2026-08-12. This asserts the whole set rather than the one route, because the
 * next paid route added is the one at risk.
 */
test('every route that calls a model behind auth also checks suspension', () => {
  const PAID = [
    "app.post('/api/council'",
    "app.post('/api/overlay'",
    "app.post('/api/chat-title'",
    "app.post('/api/speech'",
    "app.post('/api/feedback'",
  ];
  for (const route of PAID) {
    const line = SOURCE.slice(at(route), SOURCE.indexOf('\n', at(route)));
    assert.match(
      line,
      /requireAuth,\s*checkSuspended/,
      `${route} spends money and does not check suspension — suspension is the owner's kill switch and this route ignores it`,
    );
  }
});
