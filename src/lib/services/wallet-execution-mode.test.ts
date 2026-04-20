import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../errors.ts";
import {
  assertRequestedExecutionModeMatchesWallet,
  getAuthenticatedWalletFromContext,
  resolveInitialWalletExecutionMode
} from "./wallet-execution-mode.ts";
import { buildSessionMeResponse } from "./session-view.ts";

test("inApp wallets are forced to subscription execution", () => {
  assert.equal(
    resolveInitialWalletExecutionMode({
      walletProviderId: "inApp",
      requestedExecutionMode: null
    }),
    "subscription"
  );

  assert.throws(
    () =>
      resolveInitialWalletExecutionMode({
        walletProviderId: "inApp",
        requestedExecutionMode: "native"
      }),
    (error: unknown) =>
      error instanceof ApiError && error.code === "INVALID_EXECUTION_MODE"
  );
});

test("non-inApp wallets may choose subscription or native on first sign-in", () => {
  assert.equal(
    resolveInitialWalletExecutionMode({
      walletProviderId: "io.metamask",
      requestedExecutionMode: "subscription"
    }),
    "subscription"
  );

  assert.equal(
    resolveInitialWalletExecutionMode({
      walletProviderId: "walletConnect",
      requestedExecutionMode: "native"
    }),
    "native"
  );
});

test("non-inApp wallets must provide execution mode on first sign-in", () => {
  assert.throws(
    () =>
      resolveInitialWalletExecutionMode({
        walletProviderId: "io.metamask",
        requestedExecutionMode: null
      }),
    (error: unknown) =>
      error instanceof ApiError && error.code === "EXECUTION_MODE_REQUIRED"
  );
});

test("existing wallet execution mode is stable once set", () => {
  assert.throws(
    () =>
      assertRequestedExecutionModeMatchesWallet(
        {
          id: "wallet-1",
          account_id: "account-1",
          did: "did:pkh:eip155:66238:0xabc",
          wallet_address: "0xabc",
          wallet_provider_id: "io.metamask",
          execution_mode: "subscription",
          is_primary: true,
          created_at: new Date().toISOString()
        },
        "native"
      ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "EXECUTION_MODE_ALREADY_SET"
  );
});

test("session wallet selection returns the authenticated credential wallet and exposes execution mode", () => {
  const primaryWallet = {
    id: "wallet-primary",
    account_id: "account-1",
    did: "did:pkh:eip155:66238:0x111",
    wallet_address: "0x111",
    wallet_provider_id: "io.metamask",
    execution_mode: "subscription" as const,
    is_primary: true,
    created_at: new Date().toISOString()
  };
  const credentialWallet = {
    id: "wallet-credential",
    account_id: "account-1",
    did: "did:pkh:eip155:66238:0x222",
    wallet_address: "0x222",
    wallet_provider_id: "walletConnect",
    execution_mode: "native" as const,
    is_primary: false,
    created_at: new Date().toISOString()
  };

  const selected = getAuthenticatedWalletFromContext({
    wallets: [primaryWallet, credentialWallet],
    credentialWalletId: "wallet-credential"
  });

  assert.equal(selected?.id, "wallet-credential");
  assert.equal(selected?.execution_mode, "native");
});

test("session/me response includes the authenticated wallet execution mode", () => {
  const response = buildSessionMeResponse({
    account: {
      id: "account-1",
      display_name: null,
      stripe_customer_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    subscriptionState: {
      id: "subscription-1",
      account_id: "account-1",
      plan: "free",
      status: "active",
      annual_sponsored_write_limit: 5,
      sponsored_writes_used_current_year: 0,
      annual_premium_read_limit: 50,
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
        id: "wallet-primary",
        account_id: "account-1",
        did: "did:pkh:eip155:66238:0x111",
        wallet_address: "0x111",
        wallet_provider_id: "io.metamask",
        execution_mode: "subscription",
        is_primary: true,
        created_at: new Date().toISOString()
      },
      {
        id: "wallet-credential",
        account_id: "account-1",
        did: "did:pkh:eip155:66238:0x222",
        wallet_address: "0x222",
        wallet_provider_id: "walletConnect",
        execution_mode: "native",
        is_primary: false,
        created_at: new Date().toISOString()
      }
    ],
    subjects: [],
    primarySubject: null,
    client: {
      id: "client-1",
      account_id: "account-1",
      client_id: "omatrust-browser",
      did: "did:web:client.omatrust.org:omatrust-browser",
      display_name: "OMATrust Browser",
      auth_mode: "siwe_session",
      created_at: new Date().toISOString(),
      revoked_at: null
    },
    credential: {
      id: "credential-1",
      account_id: "account-1",
      wallet_id: "wallet-credential",
      client_id: "client-1",
      credential_kind: "wallet_auth",
      credential_identifier: "did:pkh:eip155:66238:0x222",
      created_at: new Date().toISOString(),
      revoked_at: null
    },
    session: null
  });

  assert.equal(response.wallet?.executionMode, "native");
  assert.equal(response.wallet?.walletProviderId, "walletConnect");
});
