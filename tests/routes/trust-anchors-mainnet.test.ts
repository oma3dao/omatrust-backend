import test from "node:test";
import assert from "node:assert/strict";
import { applyTestEnv } from "../helpers/env.ts";
import { getPublicTrustAnchors, TRUST_ANCHORS_VERSION } from "@/lib/routes/public/trust-anchors";

/** Issuers that must never be trusted once the active chain is mainnet. */
const TEST_ONLY_ISSUERS = [
  "0x6f05D46cD048d3249F4Db6BAd6d06e2069BCD5eb",
  "0x7D5beD223Bc343F114Aa28961Cc447dbbc9c2330",
  "0x766910dc543034ce7a6525c1307c5b6fe92ebb0b"
].map((address) => address.toLowerCase());

const PRODUCTION_ISSUER = "0x96fa5ab5E519641bD8A840A6b26D17DB7497618b".toLowerCase();

applyTestEnv({ OMATRUST_ACTIVE_CHAIN: "omachain-mainnet" });

/**
 * Trust anchors are served publicly and decide which attesters consumers treat
 * as approved. Development wallets leaking into the mainnet set would let a
 * testnet key vouch for production artifacts, so that boundary is asserted
 * from both sides: here on mainnet, and in the testnet counterpart file.
 */

async function issuerAddresses() {
  const anchors = await getPublicTrustAnchors();
  return anchors.registries
    .flatMap((registry) => registry.issuers)
    .map((issuer) => issuer.address.toLowerCase());
}

test("mainnet trusts no testnet issuer", async () => {
  const addresses = await issuerAddresses();

  for (const testIssuer of TEST_ONLY_ISSUERS) {
    assert.equal(
      addresses.includes(testIssuer),
      false,
      `${testIssuer} must not be trusted on mainnet`
    );
  }
});

test("mainnet keeps its production issuer", async () => {
  assert.equal((await issuerAddresses()).includes(PRODUCTION_ISSUER), true);
});

test("every mainnet issuer is active and scoped to explicit schemas", async () => {
  const anchors = await getPublicTrustAnchors();
  const issuers = anchors.registries.flatMap((registry) => registry.issuers);

  assert.ok(issuers.length > 0, "expected at least one approved issuer");

  for (const issuer of issuers) {
    assert.equal(issuer.status, "active");
    assert.ok(issuer.schemas.length > 0, `${issuer.label} must name the schemas it may issue`);
    assert.ok(Date.parse(issuer.validFrom) > 0, `${issuer.label} needs a parseable validFrom`);
  }
});

test("the published payload carries both chains and the current version", async () => {
  const anchors = await getPublicTrustAnchors();

  assert.equal(anchors.version, TRUST_ANCHORS_VERSION);
  assert.equal(
    anchors.chains["eip155:6623"].easContract,
    "0x00Bd6f0Ee99bD76273B57e6dDEc5B00850c6b76C"
  );
  assert.equal(
    anchors.chains["eip155:66238"].easContract,
    "0x8835AF90f1537777F52E482C8630cE4e947eCa32"
  );
});

test("every advertised schema uid is a 32-byte hex value", async () => {
  const anchors = await getPublicTrustAnchors();

  for (const [caip2, chain] of Object.entries(anchors.chains)) {
    for (const [name, uid] of Object.entries(chain.schemas)) {
      assert.match(uid, /^0x[0-9a-f]{64}$/i, `${caip2} ${name} is not a schema uid`);
    }
  }
});
