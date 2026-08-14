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
  assert.match(WEBHOOK, /\.update\(decision\.patch\)\.eq\(decision\.match\.column, decision\.match\.value\)/);
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
  const ledger = WEBHOOK.indexOf("from('stripe_events')");
  const resolve = WEBHOOK.indexOf('resolveStripeTarget(event)');
  assert.ok(ledger > 0 && resolve > 0);
  assert.ok(ledger < resolve, 'the idempotency claim must precede the handler');
});
