import test from "node:test";
import assert from "node:assert/strict";
import {
  createAccount,
  createAccountContext,
  createSubscriptionState
} from "../helpers/fixtures.ts";
import {
  accountUpdateBodySchema,
  getAccountsMe
} from "@/lib/routes/private/accounts/me";
import { getSubscriptionsCurrent } from "@/lib/routes/private/subscriptions/current";
import type { SubjectRow } from "@/lib/db/types";

/**
 * These mappers shape every authenticated `/me` and `/subscriptions/current`
 * response. They never touch the database, so they are the contract the
 * dashboard relies on when reading an already-loaded AccountContext.
 */

const PRIMARY_SUBJECT: SubjectRow = {
  id: "subject-1",
  account_id: "account-1",
  canonical_did: "did:web:example.com",
  subject_did_hash: "hash-1",
  display_name: "Example",
  is_default: true,
  created_at: "2026-01-01T00:00:00.000Z"
};

test("getAccountsMe maps subscription counters into camelCase fields", async () => {
  const response = await getAccountsMe(
    createAccountContext({
      account: createAccount({ id: "account-42", display_name: "Ops" }),
      subscriptionState: createSubscriptionState({
        plan: "paid",
        status: "active",
        annual_sponsored_write_limit: 100,
        sponsored_writes_used_current_year: 7,
        annual_premium_read_limit: 1000,
        premium_reads_used_current_year: 12
      })
    })
  );

  assert.deepEqual(response.account, { id: "account-42", displayName: "Ops" });
  assert.deepEqual(response.subscription, {
    plan: "paid",
    status: "active",
    annualSponsoredWriteLimit: 100,
    sponsoredWritesUsedCurrentYear: 7,
    annualPremiumReadLimit: 1000,
    premiumReadsUsedCurrentYear: 12
  });
  assert.equal(response.primarySubject, null);
});

test("getAccountsMe includes the primary subject when one is set", async () => {
  const response = await getAccountsMe(
    createAccountContext({ primarySubject: PRIMARY_SUBJECT })
  );

  assert.deepEqual(response.primarySubject, {
    id: "subject-1",
    canonicalDid: "did:web:example.com",
    subjectDidHash: "hash-1",
    displayName: "Example"
  });
});

test("getAccountsMe preserves a null display name rather than coercing it", async () => {
  const response = await getAccountsMe(
    createAccountContext({
      account: createAccount({ display_name: null }),
      primarySubject: { ...PRIMARY_SUBJECT, display_name: null }
    })
  );

  assert.equal(response.account.displayName, null);
  assert.equal(response.primarySubject?.displayName, null);
});

test("getSubscriptionsCurrent exposes entitlement period bounds the account mapper omits", async () => {
  const response = await getSubscriptionsCurrent(
    createAccountContext({
      subscriptionState: createSubscriptionState({
        plan: "free",
        entitlement_period_start: "2026-01-01T00:00:00.000Z",
        entitlement_period_end: "2027-01-01T00:00:00.000Z",
        sponsored_writes_used_current_year: 3,
        premium_reads_used_current_year: 9
      })
    })
  );

  assert.deepEqual(response.subscription, {
    plan: "free",
    status: "active",
    annualSponsoredWriteLimit: 10,
    sponsoredWritesUsedCurrentYear: 3,
    annualPremiumReadLimit: 100,
    premiumReadsUsedCurrentYear: 9,
    entitlementPeriodStart: "2026-01-01T00:00:00.000Z",
    entitlementPeriodEnd: "2027-01-01T00:00:00.000Z"
  });
});

test("accountUpdateBodySchema accepts a trimmed display name and null", () => {
  assert.deepEqual(accountUpdateBodySchema.parse({ displayName: "  Ops  " }), {
    displayName: "Ops"
  });
  assert.deepEqual(accountUpdateBodySchema.parse({ displayName: null }), {
    displayName: null
  });
});

test("accountUpdateBodySchema rejects empty, whitespace-only, and oversized names", () => {
  assert.equal(accountUpdateBodySchema.safeParse({ displayName: "" }).success, false);
  assert.equal(accountUpdateBodySchema.safeParse({ displayName: "   " }).success, false);
  assert.equal(
    accountUpdateBodySchema.safeParse({ displayName: "a".repeat(101) }).success,
    false
  );
});

test("accountUpdateBodySchema requires the displayName field", () => {
  assert.equal(accountUpdateBodySchema.safeParse({}).success, false);
});
