import test from "node:test";
import assert from "node:assert/strict";
import type { PrepareDelegatedAttestationResult } from "@oma3/omatrust/reputation";
import { applyTestEnv } from "../helpers/env.ts";
import { createAccountContext, createSubscriptionState, createWallet } from "../helpers/fixtures.ts";
import { ApiError } from "@/lib/errors";
import { getRelayNonce, submitDelegatedAttestation } from "@/lib/services/relay-eas-service";

const ALLOWED_SCHEMA = `0x${"a1".repeat(32)}`;
const SUBJECT_SCOPED_SCHEMA = `0x${"b2".repeat(32)}`;
const BLOCKED_SCHEMA = `0x${"c3".repeat(32)}`;

/** Stored checksum casing differs from what the client sends. */
const ATTESTER = "0xabcdef0000000000000000000000000000000001";
const STORED_WALLET_ADDRESS = "0xABCDEF0000000000000000000000000000000001";
const RECIPIENT = "0x2222222222222222222222222222222222222222";

applyTestEnv({
  OMATRUST_FREE_ALLOWED_SCHEMA_UIDS: `${ALLOWED_SCHEMA},${SUBJECT_SCOPED_SCHEMA}`,
  OMATRUST_SUBJECT_SCOPED_SCHEMA_UIDS: SUBJECT_SCOPED_SCHEMA
});

/**
 * Every gate below runs before the relay spends gas or touches the chain, and
 * each one is the only thing preventing a specific form of abuse: relaying for
 * a wallet the caller does not own, relaying past a paid allowance, or relaying
 * a schema the plan never entitled them to. These tests stop short of the RPC
 * call, so nothing here reaches the network.
 */

function hasCode(code: string, statusCode?: number) {
  return (error: unknown) =>
    error instanceof ApiError &&
    error.code === code &&
    (statusCode === undefined || error.statusCode === statusCode);
}

function accountContextWith(overrides: {
  executionMode?: "subscription" | "native";
  status?: "active" | "canceled" | "past_due";
  writesUsed?: number;
  writeLimit?: number;
}) {
  return createAccountContext({
    wallets: [
      createWallet({
        wallet_address: STORED_WALLET_ADDRESS,
        execution_mode: overrides.executionMode ?? "subscription"
      })
    ],
    subscriptionState: createSubscriptionState({
      status: overrides.status ?? "active",
      sponsored_writes_used_current_year: overrides.writesUsed ?? 0,
      annual_sponsored_write_limit: overrides.writeLimit ?? 10
    })
  });
}

function createPrepared(overrides: { schema?: string | undefined; deadline?: number } = {}) {
  const schema = "schema" in overrides ? overrides.schema : ALLOWED_SCHEMA;
  const deadline = overrides.deadline ?? Math.floor(Date.now() / 1000) + 600;

  return {
    delegatedRequest: { schema },
    typedData: {
      message: {
        attester: ATTESTER,
        schema,
        recipient: RECIPIENT,
        expirationTime: "0",
        revocable: true,
        refUID: `0x${"0".repeat(64)}`,
        data: "0x1234",
        value: "0",
        nonce: "0",
        deadline: String(deadline)
      }
    }
  } as unknown as PrepareDelegatedAttestationResult;
}

type SubmitParams = Parameters<typeof submitDelegatedAttestation>[0];

function submit(overrides: Partial<SubmitParams> = {}) {
  return submitDelegatedAttestation({
    accountContext: accountContextWith({}),
    attester: ATTESTER,
    prepared: createPrepared(),
    signature: `0x${"00".repeat(65)}`,
    ...overrides
  });
}

test("relay refuses an attester that is not an address", async () => {
  await assert.rejects(() => submit({ attester: "not-an-address" }), hasCode("INVALID_INPUT", 400));
});

test("relay refuses to sponsor a wallet the account does not own", async () => {
  await assert.rejects(
    () => submit({ attester: "0x9999999999999999999999999999999999999999" }),
    hasCode("ATTESTER_MISMATCH", 403)
  );
});

test("relay matches the attester regardless of stored address casing", async () => {
  // Reaches a later gate, which proves the wallet lookup itself succeeded
  // despite the request using lowercase and the row storing uppercase.
  await assert.rejects(
    () => submit({ accountContext: accountContextWith({ status: "canceled" }) }),
    hasCode("SUBSCRIPTION_INACTIVE", 403)
  );
});

test("relay refuses a wallet that chose native execution", async () => {
  await assert.rejects(
    () => submit({ accountContext: accountContextWith({ executionMode: "native" }) }),
    hasCode("EXECUTION_MODE_NATIVE", 403)
  );
});

test("relay refuses an inactive subscription", async () => {
  await assert.rejects(
    () => submit({ accountContext: accountContextWith({ status: "past_due" }) }),
    hasCode("SUBSCRIPTION_INACTIVE", 403)
  );
});

test("relay refuses once the annual sponsored write allowance is spent", async () => {
  await assert.rejects(
    () => submit({ accountContext: accountContextWith({ writesUsed: 10, writeLimit: 10 }) }),
    hasCode("SPONSORED_WRITE_LIMIT_EXCEEDED", 403)
  );
});

test("relay still allows the final sponsored write of the year", async () => {
  // The allowance gate is >=, so the last remaining write must get through it.
  // A blocked schema stops the request at the next gate instead of the chain.
  await assert.rejects(
    () =>
      submit({
        accountContext: accountContextWith({ writesUsed: 9, writeLimit: 10 }),
        prepared: createPrepared({ schema: BLOCKED_SCHEMA })
      }),
    hasCode("SCHEMA_NOT_ELIGIBLE", 403)
  );
});

test("relay refuses a schema the plan does not entitle", async () => {
  await assert.rejects(
    () => submit({ prepared: createPrepared({ schema: BLOCKED_SCHEMA }) }),
    hasCode("SCHEMA_NOT_ELIGIBLE", 403)
  );
});

test("relay refuses a request with no schema uid", async () => {
  await assert.rejects(
    () => submit({ prepared: createPrepared({ schema: undefined }) }),
    hasCode("INVALID_INPUT", 400)
  );
});

test("relay refuses a subject-scoped schema with no subject to verify", async () => {
  await assert.rejects(
    () => submit({ prepared: createPrepared({ schema: SUBJECT_SCOPED_SCHEMA }) }),
    hasCode("SUBJECT_OWNERSHIP_REQUIRED", 400)
  );
});

test("relay refuses a signature whose deadline has passed", async () => {
  await assert.rejects(
    () => submit({ prepared: createPrepared({ deadline: Math.floor(Date.now() / 1000) - 60 }) }),
    hasCode("SIGNATURE_EXPIRED", 400)
  );
});

test("nonce lookup refuses an attester that is not an address", async () => {
  await assert.rejects(
    () => getRelayNonce(accountContextWith({}), "not-an-address"),
    hasCode("INVALID_INPUT", 400)
  );
});

test("nonce lookup refuses a wallet the account does not own", async () => {
  await assert.rejects(
    () => getRelayNonce(accountContextWith({}), "0x9999999999999999999999999999999999999999"),
    hasCode("ATTESTER_MISMATCH", 403)
  );
});

test("nonce lookup refuses a wallet that chose native execution", async () => {
  await assert.rejects(
    () => getRelayNonce(accountContextWith({ executionMode: "native" }), ATTESTER),
    hasCode("EXECUTION_MODE_NATIVE", 403)
  );
});

test("nonce lookup refuses an inactive subscription", async () => {
  await assert.rejects(
    () => getRelayNonce(accountContextWith({ status: "canceled" }), ATTESTER),
    hasCode("SUBSCRIPTION_INACTIVE", 403)
  );
});
