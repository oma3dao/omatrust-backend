import test from "node:test";
import assert from "node:assert/strict";
import type { EvmOwnershipProvider } from "@oma3/omatrust/reputation";
import { handleSubjectOwnershipVerification } from "./subject-ownership-service.ts";

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
