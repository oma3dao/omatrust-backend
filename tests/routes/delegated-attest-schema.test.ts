import test from "node:test";
import assert from "node:assert/strict";
import { delegatedAttestBodySchema } from "@/lib/routes/private/relay/eas/delegated-attest-schema";

/**
 * This schema is the outer boundary of the sponsored-write relay: whatever it
 * accepts is handed to signature recovery and eventually to a transaction the
 * backend pays for. Each case below is rejected before any of that happens.
 */

const ADDRESS = "0x1111111111111111111111111111111111111111";
const WALLET_DID = "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111";
const EAS_CONTRACT = "0x8835AF90f1537777F52E482C8630cE4e947eCa32";
const HEX32 = `0x${"1".repeat(64)}`;
const ZERO_UID = `0x${"0".repeat(64)}`;

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    attester: ADDRESS,
    schema: HEX32,
    recipient: ADDRESS,
    expirationTime: "0",
    revocable: true,
    refUID: ZERO_UID,
    data: "0xdeadbeef",
    value: "0",
    nonce: "0",
    deadline: "1900000000",
    ...overrides
  };
}

function makeBody(overrides: {
  body?: Record<string, unknown>;
  request?: Record<string, unknown>;
  message?: Record<string, unknown>;
  domain?: Record<string, unknown>;
} = {}) {
  return {
    attester: ADDRESS,
    prepared: {
      delegatedRequest: {
        schema: HEX32,
        attester: ADDRESS,
        easContractAddress: EAS_CONTRACT,
        chainId: 66238,
        recipient: ADDRESS,
        expirationTime: "0",
        revocable: true,
        refUID: ZERO_UID,
        data: "0xdeadbeef",
        value: "0",
        nonce: "0",
        deadline: "1900000000",
        ...overrides.request
      },
      typedData: {
        domain: {
          name: "EAS",
          version: "1.2.0",
          chainId: 66238,
          verifyingContract: EAS_CONTRACT,
          ...overrides.domain
        },
        types: { Attest: [{ name: "attester", type: "address" }] },
        message: makeMessage(overrides.message)
      }
    },
    signature: `0x${"ab".repeat(65)}`,
    ...overrides.body
  };
}

function rejects(body: unknown) {
  return delegatedAttestBodySchema.safeParse(body).success === false;
}

test("delegated attest schema accepts a well-formed prepared attestation", () => {
  const result = delegatedAttestBodySchema.safeParse(makeBody());

  assert.equal(result.success, true);
});

test("delegated attest schema accepts numeric as well as string amounts", () => {
  const result = delegatedAttestBodySchema.safeParse(
    makeBody({
      request: { nonce: 7, value: 0, expirationTime: 0, deadline: 1_900_000_000 },
      message: { nonce: 7, value: 0, expirationTime: 0, deadline: 1_900_000_000 }
    })
  );

  assert.equal(result.success, true);
});

test("delegated attest schema accepts an optional subject DID", () => {
  const result = delegatedAttestBodySchema.safeParse(
    makeBody({ body: { subjectDid: "did:web:example.com" } })
  );

  assert.equal(result.success, true);
});

test("delegated attest schema requires an attester that looks like an EVM address", () => {
  assert.ok(rejects(makeBody({ body: { attester: "0x123" } })));
  assert.ok(rejects(makeBody({ body: { attester: `0x${"1".repeat(41)}` } })));
  assert.ok(rejects(makeBody({ body: { attester: WALLET_DID } })));
});

test("delegated attest schema rejects a signature that is not hex", () => {
  assert.ok(rejects(makeBody({ body: { signature: "not-a-signature" } })));
  assert.ok(rejects(makeBody({ body: { signature: "" } })));
});

test("delegated attest schema rejects a missing signature", () => {
  const body = makeBody() as Record<string, unknown>;
  delete body.signature;

  assert.ok(rejects(body));
});

test("delegated attest schema caps encoded attestation data at the documented limit", () => {
  const withinLimit = `0x${"a".repeat(19_998)}`;
  const overLimit = `0x${"a".repeat(20_000)}`;

  assert.equal(withinLimit.length, 20_000);
  assert.equal(
    delegatedAttestBodySchema.safeParse(
      makeBody({ request: { data: withinLimit }, message: { data: withinLimit } })
    ).success,
    true
  );
  assert.ok(rejects(makeBody({ request: { data: overLimit }, message: { data: overLimit } })));
});

test("delegated attest schema rejects a non-positive chain id", () => {
  assert.ok(rejects(makeBody({ request: { chainId: 0 } })));
  assert.ok(rejects(makeBody({ request: { chainId: -1 } })));
  assert.ok(rejects(makeBody({ request: { chainId: 1.5 } })));
});

test("delegated attest schema rejects a negative or non-numeric nonce", () => {
  assert.ok(rejects(makeBody({ request: { nonce: -1 }, message: { nonce: -1 } })));
  assert.ok(rejects(makeBody({ request: { nonce: "abc" }, message: { nonce: "abc" } })));
  assert.ok(rejects(makeBody({ request: { nonce: "1e9" }, message: { nonce: "1e9" } })));
});

test("delegated attest schema rejects a verifying contract that is not an address", () => {
  assert.ok(rejects(makeBody({ domain: { verifyingContract: "0xnope" } })));
  assert.ok(rejects(makeBody({ request: { easContractAddress: "0xnope" } })));
});

test("delegated attest schema rejects a schema uid that is not hex", () => {
  assert.ok(rejects(makeBody({ request: { schema: "security-assessment" } })));
  assert.ok(rejects(makeBody({ message: { schema: "security-assessment" } })));
});

test("delegated attest schema requires the typed-data Attest field list", () => {
  const body = makeBody() as {
    prepared: { typedData: { types: { Attest: unknown[] } } };
  };
  body.prepared.typedData.types.Attest = [];

  assert.ok(rejects(body));
});

test("delegated attest schema requires a revocable flag rather than a truthy string", () => {
  assert.ok(rejects(makeBody({ request: { revocable: "true" }, message: { revocable: "true" } })));
});

test("delegated attest schema rejects a prepared payload with no typed data", () => {
  const body = makeBody() as { prepared: Record<string, unknown> };
  delete body.prepared.typedData;

  assert.ok(rejects(body));
});

test("delegated attest schema rejects a domain missing its name or version", () => {
  assert.ok(rejects(makeBody({ domain: { name: "" } })));
  assert.ok(rejects(makeBody({ domain: { version: "" } })));
});
