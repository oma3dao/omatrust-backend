import test from "node:test";
import assert from "node:assert/strict";
import { applyTestEnv } from "../helpers/env.ts";
import { createSubscriptionState } from "../helpers/fixtures.ts";
import { ApiError } from "@/lib/errors";
import { assertPremiumReadAllowed, getPlanLimits } from "@/lib/services/subscription-service";

const FREE_WRITES = 10;
const FREE_READS = 100;
const PAID_WRITES = 250;
const PAID_READS = 5000;

applyTestEnv({
  OMATRUST_FREE_ANNUAL_SPONSORED_WRITES: String(FREE_WRITES),
  OMATRUST_FREE_ANNUAL_PREMIUM_READS: String(FREE_READS),
  OMATRUST_PAID_ANNUAL_SPONSORED_WRITES: String(PAID_WRITES),
  OMATRUST_PAID_ANNUAL_PREMIUM_READS: String(PAID_READS)
});

/**
 * Plan limits are what a new account is provisioned with and what the relay
 * charges against, so a plan resolving to the wrong tier's numbers either gives
 * away paid capacity or throttles a paying customer.
 */

test("each plan resolves to its own configured allowances", () => {
  assert.deepEqual(getPlanLimits("free"), {
    annualSponsoredWriteLimit: FREE_WRITES,
    annualPremiumReadLimit: FREE_READS
  });
  assert.deepEqual(getPlanLimits("paid"), {
    annualSponsoredWriteLimit: PAID_WRITES,
    annualPremiumReadLimit: PAID_READS
  });
});

test("a premium read below the limit is allowed", () => {
  assert.doesNotThrow(() =>
    assertPremiumReadAllowed(
      createSubscriptionState({
        premium_reads_used_current_year: 99,
        annual_premium_read_limit: 100
      })
    )
  );
});

test("the premium read limit is exhausted at the limit, not past it", () => {
  assert.throws(
    () =>
      assertPremiumReadAllowed(
        createSubscriptionState({
          premium_reads_used_current_year: 100,
          annual_premium_read_limit: 100
        })
      ),
    (error: unknown) =>
      error instanceof ApiError &&
      error.statusCode === 403 &&
      error.code === "PREMIUM_READ_LIMIT_EXCEEDED"
  );
});

test("usage that already overshot the limit stays blocked", () => {
  assert.throws(
    () =>
      assertPremiumReadAllowed(
        createSubscriptionState({
          premium_reads_used_current_year: 250,
          annual_premium_read_limit: 100
        })
      ),
    (error: unknown) => error instanceof ApiError && error.code === "PREMIUM_READ_LIMIT_EXCEEDED"
  );
});

test("a zero allowance blocks the first read", () => {
  assert.throws(
    () =>
      assertPremiumReadAllowed(
        createSubscriptionState({
          premium_reads_used_current_year: 0,
          annual_premium_read_limit: 0
        })
      ),
    (error: unknown) => error instanceof ApiError && error.code === "PREMIUM_READ_LIMIT_EXCEEDED"
  );
});
