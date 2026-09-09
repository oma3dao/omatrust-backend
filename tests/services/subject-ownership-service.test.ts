import test from "node:test";
import assert from "node:assert/strict";
import type { EvmOwnershipProvider } from "@oma3/omatrust/reputation";
import { handleSubjectOwnershipVerification } from "@/lib/services/subject-ownership-service";
import { applyTestEnv } from "../helpers/env.ts";

applyTestEnv();

const WALLET_DID = "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111";
const OTHER_WALLET_DID = "did:pkh:eip155:66238:0x2222222222222222222222222222222222222222";

function createProvider(overrides: Partial<EvmOwnershipProvider> = {}): EvmOwnershipProvider {
  return {
    call: async () => {
      throw new Error("call not mocked");
    },
    getCode: async () => "0x",
    getStorage: async () => "0x",
    getTransaction: async () => null,
    getTransactionReceipt: async () => null,
    getBlockNumber: async () => 100,
    getBlock: async () => ({ timestamp: Math.floor(Date.now() / 1000) }),
    ...overrides
  };
}

test("verifySubjectOwnership rejects unsupported DID methods", async () => {
  await assert.rejects(
    () =>
      handleSubjectOwnershipVerification({
        subjectDid: "did:key:z6Mkgfakesubject",
        connectedWalletDid: "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111"
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && (error as { code?: string }).code === "INVALID_DID"
  );
});

test("verifySubjectOwnership verifies did:web via DNS TXT", async () => {
  const result = await handleSubjectOwnershipVerification(
    {
      subjectDid: "did:web:example.com",
      connectedWalletDid: "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111"
    },
    {
      resolveTxt: async () => [
        ["v=1;controller=did:pkh:eip155:66238:0x1111111111111111111111111111111111111111"]
      ]
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "verified");
  assert.equal(result.method, "dns");
});

test("verifySubjectOwnership falls back to did.json for did:web", async () => {
  const result = await handleSubjectOwnershipVerification(
    {
      subjectDid: "did:web:example.com",
      connectedWalletDid: "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111"
    },
    {
      resolveTxt: async () => [],
      fetchDidDocument: async () => ({
        verificationMethod: [
          {
            blockchainAccountId: "eip155:66238:0x1111111111111111111111111111111111111111"
          }
        ]
      })
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "verified");
  assert.equal(result.method, "did-document");
});

test("verifySubjectOwnership verifies direct did:pkh wallet ownership", async () => {
  const result = await handleSubjectOwnershipVerification(
    {
      subjectDid: "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111",
      connectedWalletDid: "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111"
    },
    {
      provider: createProvider({
        getCode: async () => "0x"
      })
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "verified");
  assert.equal(result.method, "wallet");
});

test("verifySubjectOwnership refuses a did:web controlled by a different wallet", async () => {
  const result = await handleSubjectOwnershipVerification(
    {
      subjectDid: "did:web:example.com",
      connectedWalletDid: WALLET_DID
    },
    {
      resolveTxt: async () => [[`v=1;controller=${OTHER_WALLET_DID}`]]
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.ok(result.error);
});

test("verifySubjectOwnership refuses a did:web that publishes no controller", async () => {
  const result = await handleSubjectOwnershipVerification(
    {
      subjectDid: "did:web:example.com",
      connectedWalletDid: WALLET_DID
    },
    {
      resolveTxt: async () => [],
      fetchDidDocument: async () => ({})
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.ok(result.error);
});

test("verifySubjectOwnership refuses a did:web whose did.json points at another wallet", async () => {
  const result = await handleSubjectOwnershipVerification(
    {
      subjectDid: "did:web:example.com",
      connectedWalletDid: WALLET_DID
    },
    {
      resolveTxt: async () => [],
      fetchDidDocument: async () => ({
        verificationMethod: [
          { blockchainAccountId: "eip155:66238:0x2222222222222222222222222222222222222222" }
        ]
      })
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
});

test("verifySubjectOwnership refuses a did:pkh wallet the caller does not control", async () => {
  const result = await handleSubjectOwnershipVerification(
    {
      subjectDid: OTHER_WALLET_DID,
      connectedWalletDid: WALLET_DID
    },
    {
      provider: createProvider({ getCode: async () => "0x" })
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.ok(result.error);
});

test("verifySubjectOwnership rejects did:pkh subjects on a non-active chain", async () => {
  await assert.rejects(
    () =>
      handleSubjectOwnershipVerification({
        subjectDid: "did:pkh:eip155:1:0x1111111111111111111111111111111111111111",
        connectedWalletDid: WALLET_DID
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "UNSUPPORTED_CHAIN"
  );
});

/**
 * The public route serializes this object straight into its 403 body, so the
 * fields asserted here are the contract a caller sees when a proof fails. The
 * route cannot be driven through this path in a test because it builds its own
 * JsonRpcProvider for did:pkh subjects.
 */
test("a failed did:pkh proof produces the body the public route returns as 403", async () => {
  const result = await handleSubjectOwnershipVerification(
    {
      subjectDid: OTHER_WALLET_DID,
      connectedWalletDid: WALLET_DID
    },
    {
      provider: createProvider({ getCode: async () => "0x" })
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(result.subjectDid, OTHER_WALLET_DID);
  assert.equal(result.connectedWalletDid, WALLET_DID);
  assert.equal(typeof result.error, "string");
  assert.ok((result.error ?? "").length > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(result)).ok, false);
});

test("verifySubjectOwnership never reports a controlling wallet on failure", async () => {
  const result = await handleSubjectOwnershipVerification(
    {
      subjectDid: OTHER_WALLET_DID,
      connectedWalletDid: WALLET_DID
    },
    {
      provider: createProvider({ getCode: async () => "0x" })
    }
  );

  assert.equal(result.ok, false);
  assert.notEqual(result.controllingWalletDid, WALLET_DID);
});
