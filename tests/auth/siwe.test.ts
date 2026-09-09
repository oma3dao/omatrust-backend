import test from "node:test";
import assert from "node:assert/strict";
import { SiweMessage } from "siwe";
import { applyTestEnv } from "../helpers/env.ts";
import { ApiError, toApiError } from "@/lib/errors";
import {
  buildSiweChallengeMessage,
  createNonce,
  normalizeWalletDid,
  verifySiweMessage
} from "@/lib/auth/siwe";

const DOMAIN = "app.omatrust.org";
const URI = "https://app.omatrust.org/login";
const CHAIN_ID = 66238;
const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222";
const WALLET_DID = `did:pkh:eip155:${CHAIN_ID}:${WALLET_ADDRESS}`;
const NONCE = createNonce();

applyTestEnv({ OMATRUST_ALLOWED_SIWE_DOMAINS: `${DOMAIN},localhost:3000` });

/**
 * Signature recovery itself needs a live RPC (getCode decides between EOA and
 * ERC-1271 verification), so it is not exercised here. Everything below is the
 * binding layer that runs first: the checks that stop a valid signature over
 * the wrong domain, chain, nonce or address from being accepted.
 */

function hasCode(code: string) {
  return (error: unknown) => error instanceof ApiError && error.code === code;
}

function buildMessage(overrides: Record<string, unknown> = {}) {
  return new SiweMessage({
    domain: DOMAIN,
    address: WALLET_ADDRESS,
    statement: "Sign in to OMATrust",
    uri: URI,
    version: "1",
    chainId: CHAIN_ID,
    nonce: NONCE,
    issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    ...overrides
  }).prepareMessage();
}

function verify(overrides: Record<string, unknown> = {}) {
  return verifySiweMessage({
    walletDid: WALLET_DID,
    expectedDomain: DOMAIN,
    expectedUri: URI,
    expectedNonce: NONCE,
    expectedChainId: CHAIN_ID,
    signature: `0x${"00".repeat(65)}`,
    siweMessage: buildMessage(),
    ...overrides
  });
}

test("normalizeWalletDid returns a checksummed address and numeric chain id", () => {
  const normalized = normalizeWalletDid(WALLET_DID);

  assert.equal(normalized.walletAddress, WALLET_ADDRESS);
  assert.equal(normalized.chainId, CHAIN_ID);
  assert.equal(typeof normalized.chainId, "number");
});

test("normalizeWalletDid rejects a DID that is not did:pkh", () => {
  assert.throws(() => normalizeWalletDid("did:web:example.com"), hasCode("INVALID_DID"));
});

test("normalizeWalletDid rejects a did:pkh without an address", () => {
  assert.throws(() => normalizeWalletDid(`did:pkh:eip155:${CHAIN_ID}`));
});

test("a structurally malformed did:pkh currently reaches the client as 500, not 400", () => {
  let caught: unknown;
  try {
    normalizeWalletDid(`did:pkh:eip155:${CHAIN_ID}`);
  } catch (error) {
    caught = error;
  }

  // normalizeDid() throws the SDK's own error type before normalizeWalletDid
  // can raise INVALID_DID, and nothing re-wraps it. toApiError is what
  // withRoute applies, so this is the status a caller actually receives — a
  // client input mistake reported as a server fault.
  assert.ok(caught instanceof Error);
  assert.equal(caught instanceof ApiError, false);
  assert.equal(toApiError(caught).statusCode, 500);
  assert.equal(toApiError(caught).code, "INTERNAL_ERROR");
});

test("buildSiweChallengeMessage refuses a domain outside the allowlist", () => {
  assert.throws(
    () =>
      buildSiweChallengeMessage(
        { walletDid: WALLET_DID, chainId: CHAIN_ID, domain: "evil.example.com", uri: URI },
        NONCE,
        new Date(Date.now() + 60_000)
      ),
    (error: unknown) =>
      error instanceof ApiError &&
      error.code === "CLIENT_NOT_ALLOWED" &&
      error.statusCode === 403
  );
});

test("buildSiweChallengeMessage refuses a wallet DID from a different chain", () => {
  assert.throws(
    () =>
      buildSiweChallengeMessage(
        { walletDid: WALLET_DID, chainId: 6623, domain: DOMAIN, uri: URI },
        NONCE,
        new Date(Date.now() + 60_000)
      ),
    hasCode("INVALID_DID")
  );
});

test("buildSiweChallengeMessage binds the nonce, expiry, domain and address into the message", () => {
  const expiresAt = new Date(Date.now() + 60_000);
  const challenge = buildSiweChallengeMessage(
    { walletDid: WALLET_DID, chainId: CHAIN_ID, domain: DOMAIN, uri: URI },
    NONCE,
    expiresAt
  );

  assert.equal(challenge.nonce, NONCE);
  assert.equal(challenge.walletAddress, WALLET_ADDRESS);
  assert.equal(challenge.expiresAt, expiresAt);
  assert.match(challenge.siweMessage, new RegExp(`Nonce: ${NONCE}`));
  assert.match(challenge.siweMessage, new RegExp(`Expiration Time: ${expiresAt.toISOString()}`));
  assert.match(challenge.siweMessage, new RegExp(`^${DOMAIN} wants you to sign in`));
  assert.match(challenge.siweMessage, new RegExp(WALLET_ADDRESS));
});

test("verifySiweMessage rejects a message signed for a different address", async () => {
  await assert.rejects(
    () => verify({ siweMessage: buildMessage({ address: OTHER_ADDRESS }) }),
    hasCode("INVALID_SIGNATURE")
  );
});

test("verifySiweMessage rejects a message issued for a different domain", async () => {
  await assert.rejects(
    () => verify({ siweMessage: buildMessage({ domain: "evil.example.com" }) }),
    hasCode("INVALID_CHALLENGE")
  );
});

test("verifySiweMessage rejects a message issued for a different uri", async () => {
  await assert.rejects(
    () => verify({ siweMessage: buildMessage({ uri: "https://evil.example.com/login" }) }),
    hasCode("INVALID_CHALLENGE")
  );
});

test("verifySiweMessage rejects a replayed nonce", async () => {
  await assert.rejects(
    () => verify({ siweMessage: buildMessage({ nonce: createNonce() }) }),
    hasCode("INVALID_CHALLENGE")
  );
});

test("verifySiweMessage rejects a message bound to a different chain", async () => {
  await assert.rejects(
    () => verify({ siweMessage: buildMessage({ chainId: 6623 }) }),
    hasCode("INVALID_CHALLENGE")
  );
});

test("verifySiweMessage rejects an expired challenge", async () => {
  await assert.rejects(
    () =>
      verify({
        siweMessage: buildMessage({
          issuedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
          expirationTime: new Date(Date.now() - 60 * 1000).toISOString()
        })
      }),
    hasCode("CHALLENGE_EXPIRED")
  );
});
