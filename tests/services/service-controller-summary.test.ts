import test from "node:test";
import assert from "node:assert/strict";
import { applyTestEnv } from "../helpers/env.ts";
import { ApiError } from "@/lib/errors";
import {
  getControllerEndpointConfirmation,
  getServiceControllerSummary
} from "@/lib/services/service-controller-service";

/**
 * Only did:web subjects trigger DNS and did.json discovery, so every case here
 * uses a key-based subject and stays entirely offline.
 */
applyTestEnv();

const SUBJECT_DID = "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111";
const WALLET_DID = "did:pkh:eip155:66238:0x2222222222222222222222222222222222222222";
const APPROVED_TESTNET_ISSUER_DID =
  "did:pkh:eip155:66238:0x6f05D46cD048d3249F4Db6BAd6d06e2069BCD5eb";

test("controller summary rejects a subject DID it cannot normalize", async () => {
  await assert.rejects(
    () => getServiceControllerSummary({ subjectDid: "" }),
    (error: unknown) =>
      error instanceof ApiError && error.code === "INVALID_DID" && error.statusCode === 400
  );
});

test("controller summary marks offchain discovery unsupported for key subjects", async () => {
  const summary = await getServiceControllerSummary({
    subjectDid: SUBJECT_DID,
    includeApprovedIssuer: false
  });

  assert.equal(summary.domain, null);
  assert.equal(summary.warnings.length, 1);
  assert.deepEqual(
    summary.evidence.map((entry) => [entry.kind, entry.status]),
    [
      ["dns-txt", "unsupported"],
      ["did-json", "unsupported"]
    ]
  );
});

test("controller summary records the requesting wallet as account-wallet evidence", async () => {
  const summary = await getServiceControllerSummary({
    subjectDid: SUBJECT_DID,
    walletDid: WALLET_DID,
    includeApprovedIssuer: false
  });

  const accountWallet = summary.evidence.find((entry) => entry.kind === "account-wallet");
  assert.ok(accountWallet, "expected account-wallet evidence");
  assert.equal(accountWallet.status, "found");
  assert.deepEqual(
    summary.controllerKeys.map((key) => key.canonicalId),
    [WALLET_DID]
  );
});

test("controller summary omits the wallet when the caller opts out", async () => {
  const summary = await getServiceControllerSummary({
    subjectDid: SUBJECT_DID,
    walletDid: WALLET_DID,
    includeAccountWallet: false,
    includeApprovedIssuer: false
  });

  assert.equal(
    summary.evidence.some((entry) => entry.kind === "account-wallet"),
    false
  );
  assert.deepEqual(summary.controllerKeys, []);
});

test("controller summary refuses to treat a non-signing DID as a controller key", async () => {
  const summary = await getServiceControllerSummary({
    subjectDid: SUBJECT_DID,
    walletDid: "did:web:example.com",
    includeApprovedIssuer: false
  });

  assert.deepEqual(summary.controllerKeys, []);
  assert.equal(
    summary.evidence.some((entry) => entry.kind === "account-wallet"),
    false
  );
});

test("controller summary accepts a CAIP-10 wallet and canonicalizes it to did:pkh", async () => {
  const summary = await getServiceControllerSummary({
    subjectDid: SUBJECT_DID,
    walletDid: "eip155:66238:0x2222222222222222222222222222222222222222",
    includeApprovedIssuer: false
  });

  assert.deepEqual(
    summary.controllerKeys.map((key) => key.canonicalId),
    [WALLET_DID]
  );
});

test("controller summary reports an unknown wallet as not an approved issuer", async () => {
  const summary = await getServiceControllerSummary({
    subjectDid: SUBJECT_DID,
    walletDid: WALLET_DID
  });

  assert.equal(summary.approvedIssuer.status, "not-approved");
  assert.ok(summary.approvedIssuer.checkedIdentifiers.includes(WALLET_DID));
});

test("controller summary recognizes a registry issuer for the active chain", async () => {
  const summary = await getServiceControllerSummary({
    subjectDid: SUBJECT_DID,
    walletDid: APPROVED_TESTNET_ISSUER_DID
  });

  assert.equal(summary.approvedIssuer.status, "approved");
});

test("controller summary reports no issuer check when no wallet is supplied", async () => {
  const summary = await getServiceControllerSummary({ subjectDid: SUBJECT_DID });

  assert.equal(summary.approvedIssuer.status, "not-configured");
  assert.deepEqual(summary.approvedIssuer.checkedIdentifiers, []);
});

test("controller endpoint confirmation withholds the issuer verdict", async () => {
  const confirmation = await getControllerEndpointConfirmation({
    subjectDid: SUBJECT_DID
  });

  assert.equal("approvedIssuer" in confirmation, false);
  assert.equal(confirmation.domain, null);
  assert.ok(Array.isArray(confirmation.evidence));
});
