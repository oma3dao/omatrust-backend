import test from "node:test";
import assert from "node:assert/strict";
import { applyTestEnv } from "../helpers/env.ts";
import { assertAllowedSiweDomain, buildSiweChallengeMessage } from "@/lib/auth/siwe";

/**
 * An empty allowlist is the local-dev and CI default. It must not lock out
 * every domain — that would make sign-in impossible until the env is set.
 * This file is separate because getEnv() caches OMATRUST_ALLOWED_SIWE_DOMAINS
 * for the life of the process.
 */
applyTestEnv({ OMATRUST_ALLOWED_SIWE_DOMAINS: "" });

const WALLET_DID = "did:pkh:eip155:66238:0x1111111111111111111111111111111111111111";

test("an empty SIWE domain allowlist accepts any domain", () => {
  assert.doesNotThrow(() => assertAllowedSiweDomain("app.example.com"));
  assert.doesNotThrow(() => assertAllowedSiweDomain("localhost:3000"));
  assert.doesNotThrow(() => assertAllowedSiweDomain("evil.example.com"));
});

test("buildSiweChallengeMessage accepts an unlisted domain when the allowlist is empty", () => {
  const challenge = buildSiweChallengeMessage(
    {
      walletDid: WALLET_DID,
      chainId: 66238,
      domain: "preview.example.com",
      uri: "https://preview.example.com/login"
    },
    "nonceEmptyAllowlist1",
    new Date(Date.now() + 60_000)
  );

  assert.match(challenge.siweMessage, /preview\.example\.com wants you to sign in/);
  assert.equal(challenge.walletDid, WALLET_DID);
});
