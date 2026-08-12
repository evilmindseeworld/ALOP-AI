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

/* THE SPEND CEILING'S WIRING, asserted at the route seam.
 *
 * $5/day, $20/month per user (the owner, 2026-08-12). `lib/spend.test.js`
 * covers the cost model exhaustively and the SQL was exercised against the live
 * database. What neither can see is whether server.js actually calls them in
 * the right ORDER — and order is the whole design. Reserve before the first
 * paid call or the ceiling is a report; settle in a `finally` or an aborted
 * turn leaves a permanent over-charge on a real user's balance.
 */
test('the council reserves against the ceiling BEFORE it spends anything', () => {
  const route = SOURCE.slice(at("app.post('/api/council'"), at("// ===== OVERLAY"));
  const reserve = route.indexOf('await reserveSpend(');
  assert.notEqual(reserve, -1, 'no reservation on the council route');

  // The first thing that costs money. If a provider call ever moves above the
  // reservation, the ceiling is being enforced after the spend it exists to
  // prevent.
  for (const spender of ['runCouncil(', 'streamModel(', 'callModel(']) {
    const first = route.indexOf(spender);
    if (first === -1) continue;
    assert.ok(
      reserve < first,
      `${spender} happens before the spend reservation — the money is gone before the ceiling is checked`,
    );
  }
});

test('a refused turn is answered 402 and never reaches a model', () => {
  const route = SOURCE.slice(at("app.post('/api/council'"), at("// ===== OVERLAY"));
  const refusal = route.slice(route.indexOf('if (!budget.allowed)'));
  // 402 rather than 429: the request is not too frequent, it is refused, and a
  // retry in a minute does not help.
  assert.match(refusal.slice(0, 400), /res\.status\(402\)/);
  assert.match(refusal.slice(0, 400), /return res\.status\(402\)/, 'must return, not fall through into the turn');
});

test('the reservation is settled from a finally, so an abort cannot leave it charged', () => {
  const route = SOURCE.slice(at("app.post('/api/council'"), at("// ===== OVERLAY"));
  const tail = route.slice(route.lastIndexOf('} finally {'));
  assert.match(tail, /spendReserved > 0 && auditUserId/);
  assert.match(tail, /settleSpend\(auditUserId, spendReserved, actual\)/);
  // Priced from the telemetry, so an aborted turn is charged for the calls it
  // did make rather than for a full turn or for nothing.
  assert.match(tail, /priceTurn\(telemetry\.snapshot\(/);
});

test('both ledger calls fail OPEN and say so, rather than taking the product down', () => {
  const reserveFn = SOURCE.slice(at('const reserveSpend'), at('const settleSpend'));
  // A Supabase blip must not stop the app. The exposure is a window of
  // unmetered spend; the alternative is a total outage from a partial failure.
  assert.match(reserveFn, /allowed: true/, 'reserveSpend must admit on database error');
  assert.match(reserveFn, /console\.error\(`\[SPEND\]/, 'a ceiling that stopped applying must not be silent');
});
