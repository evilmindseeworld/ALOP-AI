"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveStripeTarget } = require("./stripe-identity");

const event = (type, object) => ({ type, data: { object } });

test("client_reference_id is the first rung and beats email", () => {
  const result = resolveStripeTarget(event("checkout.session.completed", {
    client_reference_id: "  user_client  ",
    customer_email: "payer@example.com",
    customer: "cus_123",
    subscription: "sub_123",
    payment_status: "paid",
    status: "complete",
  }));

  assert.deepEqual(result.match, { column: "clerk_id", value: "user_client" });
  assert.equal(result.confidence, "strong");
  assert.equal(result.patch.plan, "pro");
  assert.equal(result.patch.stripe_customer_id, "cus_123");
  assert.equal(result.patch.stripe_subscription_id, "sub_123");
  assert.equal(result.reason.includes("@"), false);
});

test("metadata.userId beats metadata aliases and Stripe ids", () => {
  const result = resolveStripeTarget(event("invoice.paid", {
    metadata: { userId: " user_metadata ", clerkUserId: "wrong_alias", clerk_id: "wrong_id" },
    customer: "cus_123",
    subscription: "sub_123",
  }));

  assert.deepEqual(result.match, { column: "clerk_id", value: "user_metadata" });
  assert.equal(result.confidence, "strong");
  assert.equal(result.patch.plan, "pro");
});

test("metadata Clerk aliases are accepted", () => {
  for (const [key, value] of [["clerkUserId", "user_camel"], ["clerk_id", "user_snake"]]) {
    const result = resolveStripeTarget(event("invoice.paid", {
      metadata: { [key]: ` ${value} ` },
      customer: "cus_123",
    }));
    assert.deepEqual(result.match, { column: "clerk_id", value });
    assert.equal(result.confidence, "strong");
  }
});

test("Stripe customer id precedes subscription id for checkout and invoice events", () => {
  const result = resolveStripeTarget(event("invoice.paid", {
    customer: " cus_customer ",
    subscription: "sub_subscription",
  }));

  assert.deepEqual(result.match, { column: "stripe_customer_id", value: "cus_customer" });
  assert.equal(result.confidence, "strong");
  assert.equal(result.patch.plan, "pro");
});

test("subscription events use subscription id, then customer id as the retry fallback", () => {
  const bySubscription = resolveStripeTarget(event("customer.subscription.updated", {
    id: " sub_123 ",
    customer: "cus_123",
    status: "active",
  }));
  assert.deepEqual(bySubscription.match, { column: "stripe_subscription_id", value: "sub_123" });
  assert.equal(bySubscription.confidence, "strong");
  assert.equal(bySubscription.patch.plan, "pro");

  const byCustomer = resolveStripeTarget(event("customer.subscription.updated", {
    customer: " cus_fallback ",
    status: "active",
  }));
  assert.deepEqual(byCustomer.match, { column: "stripe_customer_id", value: "cus_fallback" });
  assert.equal(byCustomer.reason, "stripe customer id fallback");
  assert.equal(byCustomer.patch.plan, "pro");
});

test("email is the last-resort weak match and is normalized", () => {
  const result = resolveStripeTarget(event("checkout.session.completed", {
    customer_email: "  Payer@Example.COM ",
    payment_status: "paid",
    status: "complete",
  }));

  assert.deepEqual(result.match, { column: "email", value: "payer@example.com" });
  assert.equal(result.confidence, "weak");
  assert.equal(result.reason, "email fallback");
  assert.equal(result.reason.includes("@"), false);
  assert.equal(result.patch.plan, "pro");
});

test("unpaid checkout never grants pro but retains exact Stripe ids for a later invoice", () => {
  const result = resolveStripeTarget(event("checkout.session.completed", {
    client_reference_id: "user_123",
    customer: "cus_123",
    subscription: "sub_123",
    customer_email: "payer@example.com",
    payment_status: "unpaid",
    status: "complete",
  }));

  assert.deepEqual(result.match, { column: "clerk_id", value: "user_123" });
  assert.equal(result.patch.plan, undefined);
  assert.deepEqual(result.patch, {
    stripe_customer_id: "cus_123",
    stripe_subscription_id: "sub_123",
  });
  assert.equal(result.reason, "payment not confirmed");
});

test("a non-complete or non-confirmed checkout also cannot grant pro", () => {
  for (const fields of [
    { payment_status: "paid", status: "open" },
    { payment_status: "pending", status: "complete" },
    { status: "complete" },
  ]) {
    const result = resolveStripeTarget(event("checkout.session.completed", {
      client_reference_id: "user_123",
      customer: "cus_123",
      ...fields,
    }));
    assert.equal(result.patch.plan, undefined, JSON.stringify(fields));
    assert.equal(result.reason, "payment not confirmed");
  }
});

test("subscription status mapping is fail-closed, with past_due still live during retries", () => {
  const expected = new Map([
    ["active", "pro"],
    ["trialing", "pro"],
    ["past_due", "pro"],
    ["unpaid", "free"],
    ["canceled", "free"],
    ["incomplete", "free"],
    ["incomplete_expired", "free"],
    ["paused", "free"],
    ["unknown", "free"],
  ]);

  for (const [status, plan] of expected) {
    const result = resolveStripeTarget(event("customer.subscription.updated", {
      id: "sub_123",
      customer: "cus_123",
      status,
    }));
    assert.equal(result.patch.plan, plan, status);
  }
});

test("deleted subscriptions always revoke the plan", () => {
  const result = resolveStripeTarget(event("customer.subscription.deleted", {
    id: "sub_123",
    customer: "cus_123",
    status: "active",
  }));

  assert.deepEqual(result.match, { column: "stripe_subscription_id", value: "sub_123" });
  assert.equal(result.patch.plan, "free");
});

test("invoice.paid grants pro through its resolved target", () => {
  const result = resolveStripeTarget(event("invoice.paid", {
    customer: "cus_123",
    subscription: "sub_123",
  }));

  assert.equal(result.handled, true);
  assert.deepEqual(result.patch, {
    stripe_customer_id: "cus_123",
    stripe_subscription_id: "sub_123",
    plan: "pro",
  });
});

test("invoice.payment_failed is handled without changing entitlement", () => {
  const result = resolveStripeTarget(event("invoice.payment_failed", {
    customer: "cus_123",
    subscription: "sub_123",
    customer_email: "payer@example.com",
  }));

  assert.equal(result.handled, true);
  assert.deepEqual(result.match, { column: "stripe_customer_id", value: "cus_123" });
  assert.deepEqual(result.patch, {});
  assert.equal(result.reason, "payment failure; entitlement retained");
  assert.equal(result.reason.includes("@"), false);
});

test("unknown event types are explicitly unhandled", () => {
  assert.deepEqual(resolveStripeTarget(event("charge.succeeded", {
    customer: "cus_123",
    customer_email: "payer@example.com",
  })), {
    match: null,
    patch: {},
    confidence: "none",
    reason: "unsupported event",
    handled: false,
  });
});

test("malformed and missing events never throw and never produce a target", () => {
  const malformed = [
    null,
    undefined,
    {},
    [],
    { type: "invoice.paid" },
    { type: "invoice.paid", data: null },
    { type: "invoice.paid", data: { object: null } },
    { type: "invoice.paid", data: { object: [] } },
    { type: "checkout.session.completed", data: { object: { metadata: [], customer: {} } } },
  ];

  for (const input of malformed) {
    let result;
    assert.doesNotThrow(() => { result = resolveStripeTarget(input); }, JSON.stringify(input));
    assert.equal(result.match, null, JSON.stringify(input));
    assert.deepEqual(result.patch, {}, JSON.stringify(input));
  }
});

test("identity values are trimmed, scalar-coerced, and bounded", () => {
  const numeric = resolveStripeTarget(event("invoice.paid", {
    customer: 12345,
  }));
  assert.deepEqual(numeric.match, { column: "stripe_customer_id", value: "12345" });

  const overlong = resolveStripeTarget(event("invoice.paid", {
    customer: "x".repeat(321),
    customer_email: "  payer@example.com  ",
  }));
  assert.deepEqual(overlong.match, { column: "email", value: "payer@example.com" });
  assert.equal(overlong.confidence, "weak");

  const onlyOverlong = resolveStripeTarget(event("invoice.paid", {
    customer: "x".repeat(321),
  }));
  assert.equal(onlyOverlong.match, null);
  assert.deepEqual(onlyOverlong.patch, {});
});

test("every reason is safe to log without echoing email PII", () => {
  const results = [
    resolveStripeTarget(event("checkout.session.completed", {
      customer_email: "person@example.com",
      payment_status: "paid",
      status: "complete",
    })),
    resolveStripeTarget(event("invoice.payment_failed", {
      customer_email: "person@example.com",
    })),
    resolveStripeTarget(event("customer.subscription.updated", {
      id: "sub_123",
      status: "canceled",
    })),
    resolveStripeTarget(event("not.handled", { customer_email: "person@example.com" })),
  ];

  for (const result of results) assert.equal(result.reason.includes("@"), false, result.reason);
});
