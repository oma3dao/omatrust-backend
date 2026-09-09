import test from "node:test";
import assert from "node:assert/strict";
import { applyTestEnv } from "../helpers/env.ts";
import { getPublicTrustAnchors } from "@/lib/routes/public/trust-anchors";

const TEST_ONLY_ISSUERS = [
  "0x6f05D46cD048d3249F4Db6BAd6d06e2069BCD5eb",
  "0x7D5beD223Bc343F114Aa28961Cc447dbbc9c2330",
  "0x766910dc543034ce7a6525c1307c5b6fe92ebb0b"
].map((address) => address.toLowerCase());

const PRODUCTION_ISSUER = "0x96fa5ab5E519641bD8A840A6b26D17DB7497618b".toLowerCase();

applyTestEnv({ OMATRUST_ACTIVE_CHAIN: "omachain-testnet" });

/** Counterpart to the mainnet file: off mainnet, test issuers must be present. */

async function issuerAddresses() {
  const anchors = await getPublicTrustAnchors();
  return anchors.registries
    .flatMap((registry) => registry.issuers)
    .map((issuer) => issuer.address.toLowerCase());
}

test("testnet trusts the development issuers", async () => {
  const addresses = await issuerAddresses();

  for (const testIssuer of TEST_ONLY_ISSUERS) {
    assert.equal(addresses.includes(testIssuer), true, `${testIssuer} should be trusted off mainnet`);
  }
});

test("testnet also keeps the production issuer", async () => {
  assert.equal((await issuerAddresses()).includes(PRODUCTION_ISSUER), true);
});

test("the registry is published as a single approved-issuers entry", async () => {
  const anchors = await getPublicTrustAnchors();

  assert.equal(anchors.registries.length, 1);
  assert.equal(anchors.registries[0].type, "approved-issuers");
});
