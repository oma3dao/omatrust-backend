import test from "node:test";
import assert from "node:assert/strict";
import type { AccountContext } from "@/lib/services/account-service";
import {
  assertSubjectOwnershipVerifiedForAccount,
  shouldReplaceBootstrapWalletSubject
} from "@/lib/services/subject-service";

function createAccountContext(): AccountContext {
  return {
    account: {
      id: "account-1",
      display_name: null,
      stripe_customer_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    subscriptionState: {
      id: "sub-1",
      account_id: "account-1",
      plan: "free",
      status: "active",
      annual_sponsored_write_limit: 10,
      sponsored_writes_used_current_year: 0,
      annual_premium_read_limit: 100,
      premium_reads_used_current_year: 0,
      entitlement_period_start: new Date().toISOString(),
      entitlement_period_end: new Date().toISOString(),
      stripe_subscription_id: null,
      stripe_price_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    wallets: [
      {
        id: "wallet-1",
        account_id: "account-1",
        did: "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111",
        wallet_address: "0x1111111111111111111111111111111111111111",
        wallet_provider_id: "inApp",
        execution_mode: "subscription",
        is_primary: true,
        created_at: new Date().toISOString()
      }
    ],
    subjects: [
      {
        id: "subject-1",
        account_id: "account-1",
        canonical_did: "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111",
        subject_did_hash: "0xwalletsubject",
        display_name: null,
        is_default: true,
        created_at: new Date().toISOString()
      }
    ],
    primarySubject: {
      id: "subject-1",
      account_id: "account-1",
      canonical_did: "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111",
      subject_did_hash: "0xwalletsubject",
      display_name: null,
      is_default: true,
      created_at: new Date().toISOString()
    },
    client: null,
    credential: {
      id: "credential-1",
      account_id: "account-1",
      client_id: "client-1",
      wallet_id: "wallet-1",
      credential_kind: "wallet_auth",
      credential_identifier: "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111",
      created_at: new Date().toISOString(),
      revoked_at: null
    },
    session: null
  };
}

test("assertSubjectOwnershipVerifiedForAccount uses authenticated wallet DID", async () => {
  const accountContext = createAccountContext();

  let captured: { subjectDid: string; connectedWalletDid: string } | null = null;

  await assert.doesNotReject(() =>
    assertSubjectOwnershipVerifiedForAccount(accountContext, "did:web:example.com", {
      verifyFn: async (params) => {
        captured = params;
        return {
          ok: true,
          status: "verified",
          subjectDid: params.subjectDid,
          connectedWalletDid: params.connectedWalletDid,
          method: "dns"
        };
      }
    })
  );

  assert.deepEqual(captured, {
    subjectDid: "did:web:example.com",
    connectedWalletDid: "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111"
  });
});

test("assertSubjectOwnershipVerifiedForAccount returns user-fixable verification failure", async () => {
  const accountContext = createAccountContext();

  await assert.rejects(
    () =>
      assertSubjectOwnershipVerifiedForAccount(accountContext, "did:web:example.com", {
        verifyFn: async (params) => ({
          ok: false,
          status: "failed",
          subjectDid: params.subjectDid,
          connectedWalletDid: params.connectedWalletDid,
          error: "Subject ownership verification failed",
          details: "Add a TXT record at _controllers.example.com pointing to your wallet DID."
        })
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      "details" in error &&
      (error as { code?: string }).code === "SUBJECT_OWNERSHIP_VERIFICATION_FAILED" &&
      (error as { details?: string }).details ===
        "Add a TXT record at _controllers.example.com pointing to your wallet DID."
  );
});

test("shouldReplaceBootstrapWalletSubject returns true for first meaningful subject", () => {
  const accountContext = createAccountContext();

  assert.equal(
    shouldReplaceBootstrapWalletSubject({
      accountContext,
      canonicalDid: "did:web:example.com",
      authenticatedWalletDid: "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111"
    }),
    true
  );
});

test("shouldReplaceBootstrapWalletSubject returns false for wallet DID subject", () => {
  const accountContext = createAccountContext();

  assert.equal(
    shouldReplaceBootstrapWalletSubject({
      accountContext,
      canonicalDid: "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111",
      authenticatedWalletDid: "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111"
    }),
    false
  );
});

test("assertSubjectOwnershipVerifiedForAccount falls back to the primary wallet without a credential", async () => {
  const accountContext = createAccountContext();
  accountContext.credential = null;
  accountContext.wallets.unshift({
    id: "wallet-2",
    account_id: "account-1",
    did: "did:pkh:eip155:66238:0x2222222222222222222222222222222222222222",
    wallet_address: "0x2222222222222222222222222222222222222222",
    wallet_provider_id: "inApp",
    execution_mode: "subscription",
    is_primary: false,
    created_at: new Date().toISOString()
  });

  const result = await assertSubjectOwnershipVerifiedForAccount(
    accountContext,
    "did:web:example.com",
    {
      verifyFn: async (params) => ({
        ok: true,
        status: "verified",
        subjectDid: params.subjectDid,
        connectedWalletDid: params.connectedWalletDid,
        method: "dns"
      })
    }
  );

  assert.equal(
    result.authenticatedWalletDid,
    "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111"
  );
});

test("assertSubjectOwnershipVerifiedForAccount refuses when the credential wallet is unknown", async () => {
  const accountContext = createAccountContext();
  accountContext.wallets = [];

  await assert.rejects(
    () =>
      assertSubjectOwnershipVerifiedForAccount(accountContext, "did:web:example.com", {
        verifyFn: async () => {
          throw new Error("verification must not be attempted");
        }
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "WALLET_AUTH_REQUIRED"
  );
});

test("assertSubjectOwnershipVerifiedForAccount still explains a bare verification failure", async () => {
  const accountContext = createAccountContext();

  await assert.rejects(
    () =>
      assertSubjectOwnershipVerifiedForAccount(accountContext, "did:web:example.com", {
        verifyFn: async (params) => ({
          ok: false,
          status: "failed",
          subjectDid: params.subjectDid,
          connectedWalletDid: params.connectedWalletDid
        })
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Subject ownership verification failed" &&
      "details" in error &&
      typeof (error as { details?: string }).details === "string" &&
      (error as { details: string }).details.length > 0
  );
});

test("assertSubjectOwnershipVerifiedForAccount reports the wallet that satisfied the check", async () => {
  const accountContext = createAccountContext();

  const result = await assertSubjectOwnershipVerifiedForAccount(
    accountContext,
    "did:web:example.com",
    {
      verifyFn: async (params) => ({
        ok: true,
        status: "verified",
        subjectDid: params.subjectDid,
        connectedWalletDid: params.connectedWalletDid,
        method: "dns"
      })
    }
  );

  assert.equal(
    result.authenticatedWalletDid,
    "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111"
  );
  assert.equal(result.verification.ok, true);
});

test("shouldReplaceBootstrapWalletSubject keeps a sole subject that is not the bootstrap default", () => {
  const accountContext = createAccountContext();
  accountContext.subjects[0].is_default = false;

  assert.equal(
    shouldReplaceBootstrapWalletSubject({
      accountContext,
      canonicalDid: "did:web:example.com",
      authenticatedWalletDid: "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111"
    }),
    false
  );
});

test("shouldReplaceBootstrapWalletSubject keeps a sole subject that is not the wallet subject", () => {
  const accountContext = createAccountContext();
  accountContext.subjects[0].canonical_did = "did:web:already-owned.example.com";

  assert.equal(
    shouldReplaceBootstrapWalletSubject({
      accountContext,
      canonicalDid: "did:web:example.com",
      authenticatedWalletDid: "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111"
    }),
    false
  );
});

test("shouldReplaceBootstrapWalletSubject compares wallet DIDs in normalized form", () => {
  const accountContext = createAccountContext();

  assert.equal(
    shouldReplaceBootstrapWalletSubject({
      accountContext,
      canonicalDid: "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111",
      authenticatedWalletDid: "DID:PKH:eip155:66238:0x1111111111111111111111111111111111111111"
    }),
    false
  );
});

test("shouldReplaceBootstrapWalletSubject returns false when account already has multiple subjects", () => {
  const accountContext = createAccountContext();
  accountContext.subjects.push({
    id: "subject-2",
    account_id: "account-1",
    canonical_did: "did:web:existing.example.com",
    subject_did_hash: "0xabc",
    display_name: null,
    is_default: false,
    created_at: new Date().toISOString()
  });

  assert.equal(
    shouldReplaceBootstrapWalletSubject({
      accountContext,
      canonicalDid: "did:web:new.example.com",
      authenticatedWalletDid: "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111"
    }),
    false
  );
});
