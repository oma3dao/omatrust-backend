import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { applyTestEnv } from "../helpers/env.ts";
import { ApiError, toApiError } from "@/lib/errors";
import { handleStripeWebhook } from "@/lib/services/subscription-service";

const WEBHOOK_SECRET = "whsec_test_secret";

applyTestEnv({
  STRIPE_SECRET_KEY: "sk_test_dummy",
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_PAID_PRICE_ID: "price_paid"
});

/**
 * The webhook is an unauthenticated public endpoint that grants entitlements,
 * so signature verification is the only thing stopping anyone from posting
 * themselves a paid plan. Cases here stop before any database write.
 */

const stripe = new Stripe("sk_test_dummy");

function sign(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  return {
    payload,
    signature: stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })
  };
}

function subscriptionEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_test",
    object: "event",
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_test",
        object: "subscription",
        status: "active",
        metadata: {},
        items: { data: [{ price: { id: "price_other", metadata: {} } }] },
        ...overrides
      }
    }
  };
}

test("a webhook with no signature header is refused", async () => {
  const { payload } = sign(subscriptionEvent());

  await assert.rejects(
    () => handleStripeWebhook(payload, null),
    (error: unknown) =>
      error instanceof ApiError && error.statusCode === 400 && error.code === "STRIPE_ERROR"
  );
});

test("a forged signature is refused", async () => {
  const { payload } = sign(subscriptionEvent());

  await assert.rejects(() =>
    handleStripeWebhook(payload, "t=1700000000,v1=0000000000000000000000000000000000000000000000000000000000000000")
  );
});

test("a signature that does not match the payload is refused", async () => {
  // Signature generated for a different body: replaying a valid header against
  // altered contents must not be accepted.
  const { signature } = sign(subscriptionEvent());
  const tampered = JSON.stringify(subscriptionEvent({ metadata: { accountId: "attacker" } }));

  await assert.rejects(() => handleStripeWebhook(tampered, signature));
});

test("a rejected webhook is reported as a server fault, not a 400", async () => {
  // Stripe's verification error is not an ApiError, so it falls through to the
  // generic 500 mapping. Stripe retries on 5xx, so a genuinely forged request
  // keeps being retried instead of being rejected outright.
  const { payload } = sign(subscriptionEvent());
  let caught: unknown;

  try {
    await handleStripeWebhook(payload, "t=1700000000,v1=deadbeef");
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, "expected the forged webhook to be rejected");
  assert.equal(toApiError(caught).statusCode, 500);
});

test("a correctly signed event we do not handle is acknowledged and ignored", async () => {
  const { payload, signature } = sign({
    id: "evt_ignored",
    object: "event",
    type: "customer.created",
    data: { object: { id: "cus_test", object: "customer" } }
  });

  assert.deepEqual(await handleStripeWebhook(payload, signature), {
    received: true,
    type: "customer.created"
  });
});

test("a subscription event with no account to attribute it to is refused", async () => {
  const { payload, signature } = sign(subscriptionEvent());

  await assert.rejects(
    () => handleStripeWebhook(payload, signature),
    (error: unknown) =>
      error instanceof ApiError && error.statusCode === 400 && error.code === "STRIPE_ERROR"
  );
});

test("a failed-payment event with no subscription is acknowledged without changing state", async () => {
  const { payload, signature } = sign({
    id: "evt_invoice",
    object: "event",
    type: "invoice.payment_failed",
    data: { object: { id: "in_test", object: "invoice" } }
  });

  assert.deepEqual(await handleStripeWebhook(payload, signature), {
    received: true,
    type: "invoice.payment_failed"
  });
});
