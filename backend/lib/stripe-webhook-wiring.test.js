'use strict';

/**
 * The module is proved by `stripe-identity.test.js`. This file proves it is
 * WIRED, which is the half that regresses silently: a decision function nothing
 * calls passes all its own tests forever.
 *
 * server.js calls `process.exit(1)` at import time on a missing env var, so it
 * cannot be required in a test. It is read as text, and the assertions are on
 * proximity rather than exact escaped strings — see AGENTS.md.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SERVER = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
const WEBHOOK = SERVER.slice(
  SERVER.indexOf("app.post('/api/stripe/webhook'"),
  SERVER.indexOf("app.use(compression("),
);

/* Comments stripped, for the assertions that must not see the old code QUOTED.
 * The comment above the handler names `.eq('email', ...)` deliberately — that
 * is what the paragraph is about — and a naive text search finds it and reports
 * the very defect the comment records as fixed. A test whose failure is caused
 * by its own documentation is worse than no test: the next person deletes the
 * explanation to make it pass. */
const CODE = WEBHOOK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('the webhook resolves identity through the module rather than inline', () => {
  assert.ok(WEBHOOK.length > 0, 'the webhook route moved; this test needs updating');
  assert.match(WEBHOOK, /resolveStripeTarget\(event\)/);
});

test('THE REGRESSION: no Stripe event addresses a user by email again', () => {
  // The defect. `.eq('email', ...)` matched on a string the payer typed, against
  // a column refreshed in the background from Clerk, without `.single()`. All
  // three failure modes were silent: the money arrives and `plan` stays free.
  assert.doesNotMatch(CODE, /\.eq\(\s*['"]email['"]/, 'the webhook is addressing users by email again');
  assert.doesNotMatch(CODE, /customer_email/, 'the webhook is reading the session email directly again');
});

test('the update is addressed by the column the decision chose', () => {
  /* The write moved inside `lib/stripe-apply.js` so the ordering predicate and
   * the write are one statement. The invariant did not move: the row is
   * addressed by the column the DECISION picked, never by a column this route
   * chose for itself, because that choice is what stripe-identity.js exists to
   * make and what its confidence rating describes. */
  assert.match(CODE, /match:\s*decision\.match/, 'the webhook must pass the decision own match, not build one');
  assert.match(CODE, /patch:\s*decision\.patch/);
  const apply = readFileSync(join(__dirname, 'stripe-apply.js'), 'utf8');
  assert.match(apply, /\.eq\(match\.column, match\.value\)/, 'stripe-apply must address the row by the matched column');
});

test('an empty patch performs no write', () => {
  // invoice.payment_failed resolves to an identity with an EMPTY patch on
  // purpose — Stripe retries, and a first decline must not revoke access. A
  // route that wrote the patch unconditionally would issue `.update({})`.
  assert.match(WEBHOOK, /Object\.keys\(decision\.patch\)\.length > 0/);
});

test('an unattributable paid event is loud rather than silent', () => {
  assert.match(WEBHOOK, /could not be attributed to a user/);
});

test('a weak (email) match is distinguishable in the log', () => {
  assert.match(WEBHOOK, /decision\.confidence === 'weak'/);
});

test('no event value reaches the log line', () => {
  // `reason` is written to be safe to print; the matched VALUE is an email or a
  // Clerk id and is not. The column name is what a reader needs.
  const logLines = CODE.match(/console\.(log|warn|error)\([^\n]*/g) || [];
  assert.ok(logLines.length >= 3, 'expected the webhook to report what it did');
  for (const line of logLines) {
    assert.doesNotMatch(line, /decision\.match\.value/, `a log line prints the matched identity: ${line}`);
    assert.doesNotMatch(line, /customer_details|customer_email/, `a log line prints an email: ${line}`);
  }
});

test('checkout sends both identity fields, so either version of the webhook can attribute it', () => {
  const checkout = SERVER.slice(SERVER.indexOf("app.post('/api/create-checkout-session'"));
  const route = checkout.slice(0, checkout.indexOf('\napp.'));
  assert.match(route, /client_reference_id: req\.auth\.userId/);
  assert.match(route, /metadata: \{ userId: req\.auth\.userId \}/);
});

test('the event ledger still claims the event id before any of this runs', () => {
  // Stripe is at-least-once. The dedupe must stay ABOVE the handler, or a
  // retried event re-applies the patch.
  const ledger = WEBHOOK.indexOf('claimStripeEvent(');
  const resolve = WEBHOOK.indexOf('resolveStripeTarget(event)');
  assert.ok(ledger > 0 && resolve > 0);
  assert.ok(ledger < resolve, 'the idempotency claim must precede the handler');
});

test('and the claim is SETTLED, which is what makes a retry able to finish the job', () => {
  /* The expensive bug this replaced: the row was claimed before the work and
   * never touched again, so a handler that threw answered 500, Stripe retried,
   * and the retry was dropped as a duplicate. Paid, and still on the free plan.
   *
   * Both halves have to stay: `done` only on the success path, `failed` in the
   * catch. Marking done before the work — or in a `finally` — reinstates the
   * original defect exactly. */
  assert.match(CODE, /markStripeEventDone\(/, 'nothing marks a Stripe event applied; every retry now re-applies it');
  assert.match(CODE, /markStripeEventFailed\(/, 'a failed webhook leaves no record and its retry is dropped as a duplicate');

  const done = CODE.indexOf('markStripeEventDone(');
  const update = CODE.indexOf('applyBillingPatch(');
  assert.ok(update > 0 && done > update, 'the event is marked done before the work it claims to have done');

  const catchAt = CODE.indexOf('} catch (err) {', update);
  assert.ok(catchAt > 0 && done < catchAt, 'marked done outside the success path — a throw would still count as applied');
  assert.ok(CODE.indexOf('markStripeEventFailed(') > catchAt, 'the failure is recorded outside the catch');
  assert.doesNotMatch(CODE, /finally\s*\{[^}]*markStripeEventDone/, 'done in a finally block means a throw is recorded as success');
});

/**
 * A BARE .update().eq() THAT MATCHES NOTHING REPORTS NO ERROR.
 *
 * That is the whole reason `.select('id')` is on the users update: without it,
 * a paid event addressed to a user row that is not there logged the healthy
 * line, marked the event `done`, and left the customer paid and on free — the
 * bug 026 closed, reached by a different road. Every test in
 * billing-read-model.test.js passes with that call reverted, because they are
 * handed rows rather than a database.
 *
 * Asserted against CODE, not WEBHOOK: a comment describing the call must not
 * be able to satisfy a guard about the call.
 */
test('the users update asks which rows it changed', () => {
  const apply = readFileSync(join(__dirname, 'stripe-apply.js'), 'utf8');
  assert.match(
    apply,
    /\.eq\(match\.column, match\.value\)[\s\S]{0,200}?\.select\(/,
    'the users update must .select() — without it, zero rows matched is indistinguishable from success',
  );
  assert.match(CODE, /recordBillingEvent\(/, 'the webhook must record an audit row, or the read model has no event-to-user link');
  assert.match(CODE, /applied[,:} ]/, 'the audit row must carry how many rows the update actually changed');
});

test('nothing that could identify a customer is written to the audit metadata', () => {
  const record = SERVER.slice(SERVER.indexOf('const recordBillingEvent'));
  const body = record.slice(0, record.indexOf('}, ip || null);') + 15);
  // audit_owner_read lets a user SELECT their own audit rows, so this bag is
  // user-visible. decision.match.value can be an email address.
  assert.doesNotMatch(body, /match\.value/, 'decision.match.value can be an email; it must not reach a user-readable row');
  assert.doesNotMatch(body, /customer_email|receipt_email/, 'no address may be written to audit metadata');
});

/**
 * THE ORDERING GUARD HAS TO BE ON THE PATH, not merely in a module.
 *
 * `lib/stripe-apply.js` is fully unit-tested against a fake database and every
 * one of those tests passes while the webhook keeps writing the plan itself —
 * which is exactly how `doc-extract.js` spent its life fully tested and never
 * called. The guard is the call site.
 */
test('the webhook applies billing through the ordering guard', () => {
  assert.match(CODE, /applyBillingPatch\(/, 'the webhook must not write users.plan directly; a reordered event would win');
  assert.match(CODE, /eventTimestamp\(event\)/, 'the guard needs the event CREATED time, not its arrival time');
  assert.doesNotMatch(
    CODE,
    /\.from\('users'\)\.update\(decision\.patch\)/,
    'a direct update bypasses the ordering guard entirely',
  );
});

test('a superseded event is not reported as the failure it is shaped like', () => {
  // stale and missing both change zero rows. Reporting the first as the second
  // turns the ordering guard into a permanent error stream.
  assert.match(CODE, /outcome\.stale/, 'nothing distinguishes a stale event from a missing user row');
  assert.ok(
    CODE.indexOf('outcome.stale') < CODE.indexOf('MATCHED NO USER ROW'),
    'the stale branch must be tested BEFORE the missing-row error, or every superseded event logs as a failure',
  );
});
