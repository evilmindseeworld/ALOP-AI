"use strict";

// Stripe is an outside system. Keep this boundary small and deterministic: no
// database calls, no SDK objects, and no event value is copied into a log
// reason. Oversized or malformed values are rejected rather than truncated;
// truncating an identity could turn it into another user's key.
const MAX_VALUE_LENGTH = 320;

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

const CONFIRMED_PAYMENT_STATUSES = new Set(["paid", "no_payment_required"]);

// A past_due subscription remains in Stripe's retry window. Keeping access
// until Stripe moves it to unpaid/canceled avoids revoking a paying user's
// access on the first temporary card decline. invoice.payment_failed follows
// the same rule and never downgrades by itself.
const LIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Convert an outside scalar to one bounded, non-empty string. */
function cleanString(value) {
  if (typeof value === "string") value = value.trim();
  else if (value instanceof String) value = value.toString().trim();
  else if (typeof value === "number" && Number.isFinite(value)) value = String(value).trim();
  else return null;

  if (!value || value.length > MAX_VALUE_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

function cleanLower(value) {
  const cleaned = cleanString(value);
  return cleaned ? cleaned.toLowerCase() : null;
}

function read(object, key) {
  return isRecord(object) && hasOwn(object, key) ? object[key] : undefined;
}

function firstClean(object, keys) {
  for (const key of keys) {
    const value = cleanString(read(object, key));
    if (value) return value;
  }
  return null;
}

/** Stripe may send an expanded customer/subscription object instead of its id. */
function firstStripeId(object, keys) {
  for (const key of keys) {
    let value = read(object, key);
    if (isRecord(value)) value = read(value, "id");
    value = cleanString(value);
    if (value) return value;
  }
  return null;
}

function customerId(object) {
  return firstStripeId(object, ["customer", "stripe_customer_id", "customer_id"]);
}

function subscriptionId(object, eventType) {
  // `id` is the subscription id only on customer.subscription.* objects. On
  // sessions and invoices it is the session/invoice id and must not be used.
  const keys = eventType.startsWith("customer.subscription.")
    ? ["id", "stripe_subscription_id", "subscription_id", "subscription"]
    : ["subscription", "stripe_subscription_id", "subscription_id"];
  return firstStripeId(object, keys);
}

function emailAddress(object) {
  const details = read(object, "customer_details");
  const address = read(object, "customer_address");
  const values = [
    read(object, "customer_email"),
    read(details, "email"),
    read(address, "email"),
    read(object, "email"),
  ];

  for (const raw of values) {
    const value = cleanString(raw);
    if (!value) continue;
    const email = value.toLowerCase();
    if (EMAIL_RE.test(email)) return email;
  }
  return null;
}

function matchCandidate(column, value, confidence, reason) {
  const cleaned = cleanString(value);
  return cleaned
    ? { match: { column, value: cleaned }, confidence, reason }
    : null;
}

function identityCandidate(object, eventType) {
  const clientReference = firstClean(object, ["client_reference_id", "clientReferenceId"]);
  if (clientReference) {
    return matchCandidate("clerk_id", clientReference, "strong", "client reference");
  }

  const metadata = read(object, "metadata");
  const metadataUserId = firstClean(metadata, ["userId", "user_id"]);
  if (metadataUserId) {
    return matchCandidate("clerk_id", metadataUserId, "strong", "metadata user id");
  }

  const metadataClerkId = firstClean(metadata, [
    "clerkUserId",
    "clerk_id",
    "clerkId",
    "clerk_user_id",
  ]);
  if (metadataClerkId) {
    return matchCandidate("clerk_id", metadataClerkId, "strong", "metadata clerk id");
  }

  const customer = customerId(object);
  const subscription = subscriptionId(object, eventType);
  const customerCandidate = matchCandidate("stripe_customer_id", customer, "strong", "stripe customer id");
  const subscriptionCandidate = matchCandidate(
    "stripe_subscription_id",
    subscription,
    "strong",
    "stripe subscription id",
  );

  // The natural key for a subscription event is its subscription id. If it
  // was never stored, the customer id is the explicit retry fallback. Other
  // events retain the documented customer-before-subscription precedence.
  const stripeCandidate = eventType.startsWith("customer.subscription.")
    ? (subscriptionCandidate || (customerCandidate && {
      ...customerCandidate,
      reason: "stripe customer id fallback",
    }))
    : (customerCandidate || subscriptionCandidate);
  if (stripeCandidate) return stripeCandidate;

  const email = emailAddress(object);
  return email ? matchCandidate("email", email, "weak", "email fallback") : null;
}

function patchStripeIds(object, eventType) {
  const patch = {};
  const customer = customerId(object);
  const subscription = subscriptionId(object, eventType);
  if (customer) patch.stripe_customer_id = customer;
  if (subscription) patch.stripe_subscription_id = subscription;
  return patch;
}

function baseDecision(handled, reason) {
  return {
    match: null,
    patch: {},
    confidence: "none",
    reason,
    handled,
  };
}

function matchedDecision(identity, patch, reason = identity.reason) {
  return {
    match: identity.match,
    patch,
    confidence: identity.confidence,
    reason,
    handled: true,
  };
}

function eventObject(event) {
  const data = read(event, "data");
  const object = read(data, "object");
  return isRecord(object) ? object : null;
}

function checkoutPaymentConfirmed(object) {
  const paymentStatus = cleanLower(firstClean(object, ["payment_status", "paymentStatus"]));
  const sessionStatus = cleanLower(firstClean(object, ["status"]));

  // The event type establishes that checkout completed. If Stripe supplies a
  // status, it must agree; payment_status still needs a positive paid or
  // no-payment-required value so delayed methods marked unpaid cannot grant.
  return CONFIRMED_PAYMENT_STATUSES.has(paymentStatus) &&
    (!sessionStatus || sessionStatus === "complete");
}

/**
 * Decide which users row a Stripe event may address.
 *
 * The caller owns the actual update. This function only returns a bounded,
 * plain decision and never includes event data in `reason`.
 */
function resolveStripeTarget(event) {
  const eventType = cleanString(read(event, "type"));
  if (!HANDLED_EVENTS.has(eventType)) return baseDecision(false, "unsupported event");

  const object = eventObject(event);
  if (!object) return baseDecision(true, "no safe identity");

  const identity = identityCandidate(object, eventType);
  if (!identity) return baseDecision(true, "no safe identity");

  if (eventType === "checkout.session.completed") {
    const ids = patchStripeIds(object, eventType);
    if (!checkoutPaymentConfirmed(object)) {
      // Preserve exact Stripe ids for a later invoice.paid retry, but never
      // write plan=pro while the session is unpaid or otherwise unconfirmed.
      return matchedDecision(identity, ids, "payment not confirmed");
    }
    return matchedDecision(identity, { ...ids, plan: "pro" });
  }

  if (eventType === "invoice.payment_failed") {
    // Stripe retries failed invoices. A first decline is not proof that the
    // customer should lose access, so this event deliberately patches nothing.
    return matchedDecision(identity, {}, "payment failure; entitlement retained");
  }

  if (eventType === "invoice.paid") {
    return matchedDecision(identity, { ...patchStripeIds(object, eventType), plan: "pro" });
  }

  const status = cleanLower(firstClean(object, ["status"]));
  const isDeleted = eventType === "customer.subscription.deleted";
  const plan = !isDeleted && LIVE_SUBSCRIPTION_STATUSES.has(status) ? "pro" : "free";
  const reason = plan === "pro" ? identity.reason : "subscription not live";
  return matchedDecision(identity, { ...patchStripeIds(object, eventType), plan }, reason);
}

module.exports = { resolveStripeTarget };
