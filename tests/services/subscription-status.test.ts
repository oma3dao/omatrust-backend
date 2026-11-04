import test from "node:test";
import assert from "node:assert/strict";
import { applyTestEnv } from "../helpers/env.ts";
import { createSubscriptionState } from "../helpers/fixtures.ts";
import type { SubscriptionStatus } from "@/lib/db/types";
import { ApiError } from "@/lib/errors";
import { assertSubscriptionActive } from "@/lib/services/account-service";

applyTestEnv();

/**
 * Every sponsored write and premium read is gated on this one check, so which
 * Stripe-derived statuses count as entitled decides whether a lapsed customer
 * keeps spending the relay's gas.
 */

const ENTITLED: SubscriptionStatus[] = ["active", "trialing"];
const BLOCKED: SubscriptionStatus[] = ["canceled", "past_due", "incomplete"];

test("active and trialing subscriptions are entitled", () => {
  for (const status of ENTITLED) {
    assert.doesNotThrow(
      () => assertSubscriptionActive(createSubscriptionState({ status })),
      `${status} should be entitled`
    );
  }
});

test("every other status is refused with 403 SUBSCRIPTION_INACTIVE", () => {
  for (const status of BLOCKED) {
    assert.throws(
      () => assertSubscriptionActive(createSubscriptionState({ status })),
      (error: unknown) =>
        error instanceof ApiError &&
        error.statusCode === 403 &&
        error.code === "SUBSCRIPTION_INACTIVE",
      `${status} should be refused`
    );
  }
});

test("a past_due subscription loses entitlement immediately", () => {
  // Stripe marks a subscription past_due the moment a renewal payment fails,
  // so this is the status a lapsing customer sits in.
  assert.throws(
    () => assertSubscriptionActive(createSubscriptionState({ status: "past_due" })),
    (error: unknown) => error instanceof ApiError && error.code === "SUBSCRIPTION_INACTIVE"
  );
});
