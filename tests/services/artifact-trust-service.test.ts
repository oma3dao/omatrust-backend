import test from "node:test";
import assert from "node:assert/strict";
import type { Hex } from "@oma3/omatrust/reputation";
import { ApiError } from "@/lib/errors";
import { getArtifactTrust } from "@/lib/services/artifact-trust-service";
import {
  ARTIFACT_DID,
  EAS_CONTRACT,
  anchors,
  makeCandidate,
  makeDeps,
  makeRecord,
  provider
} from "../helpers/artifact-trust.ts";

test("artifact trust returns a complete empty result", async () => {
  const result = await getArtifactTrust(ARTIFACT_DID, makeDeps());

  assert.equal(result.artifactDid, ARTIFACT_DID);
  assert.deepEqual(result.chain, {
    chainId: 6623,
    caip2: "eip155:6623",
    easContract: EAS_CONTRACT
  });
  assert.deepEqual(result.responsibilityClaims, []);
  assert.deepEqual(result.securityAssessments, []);
  assert.deepEqual(result.certifications, []);
  assert.deepEqual(result.otherAttestations, []);
  assert.deepEqual(result.summary, {
    totalQueried: 0,
    totalVerified: 0,
    totalExcluded: 0,
    complete: true
  });
});

test("artifact trust groups, sorts, and counts verified candidates", async () => {
  const older = makeCandidate("security-assessment", {
    uid: `0x${"b".repeat(64)}` as Hex,
    time: 1_700_000_001n
  });
  const newer = makeCandidate("security-assessment", {
    uid: `0x${"c".repeat(64)}` as Hex,
    time: 1_700_000_002n
  });
  const excluded = makeCandidate("certification", {
    uid: `0x${"d".repeat(64)}` as Hex
  });

  const result = await getArtifactTrust(
    ARTIFACT_DID,
    makeDeps({
      queryCandidates: async () => [older, excluded, newer],
      verifyCandidate: async (candidate, schemaName) => {
        if (candidate.uid === excluded.uid) {
          return null;
        }
        return {
          group: "securityAssessments",
          record: makeRecord(candidate, schemaName)
        };
      }
    })
  );

  assert.deepEqual(
    result.securityAssessments.map((item) => item.attestation.uid),
    [newer.uid, older.uid]
  );
  assert.deepEqual(result.summary, {
    totalQueried: 3,
    totalVerified: 2,
    totalExcluded: 1,
    complete: true
  });
  assert.equal(
    result.securityAssessments.every((item) => item.verification.valid),
    true
  );
});

test("artifact trust rejects malformed and non-artifact DIDs before RPC", async () => {
  let providerCalls = 0;
  const deps = makeDeps({
    getProvider: () => {
      providerCalls += 1;
      return provider;
    }
  });

  await assert.rejects(
    () => getArtifactTrust("did:web:example.com", deps),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "INVALID_DID"
  );
  assert.equal(providerCalls, 0);
});

test("artifact trust fails unsupported active-chain anchor configuration", async () => {
  await assert.rejects(
    () =>
      getArtifactTrust(
        ARTIFACT_DID,
        makeDeps({
          getTrustAnchors: async () => ({
            ...anchors,
            chains: {}
          })
        })
      ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "UNSUPPORTED_CHAIN"
  );
});

test("artifact trust maps candidate query failures to NETWORK_ERROR", async () => {
  await assert.rejects(
    () =>
      getArtifactTrust(
        ARTIFACT_DID,
        makeDeps({
          queryCandidates: async () => {
            throw new ApiError("RPC failed", 502, "NETWORK_ERROR");
          }
        })
      ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "NETWORK_ERROR" &&
      error.message === "RPC failed"
  );
});

test("artifact trust excludes revoked candidates with the production validator", async () => {
  const revoked = makeCandidate("security-assessment", {
    revocationTime: 1_650_000_000n
  });

  const result = await getArtifactTrust(
    ARTIFACT_DID,
    makeDeps({
      queryCandidates: async () => [revoked]
    })
  );

  assert.equal(result.summary.totalQueried, 1);
  assert.equal(result.summary.totalVerified, 0);
  assert.equal(result.summary.totalExcluded, 1);
});

test("artifact trust accepts approved-issuer schemas that do not define proofs", async () => {
  const assessment = makeCandidate("security-assessment");

  const result = await getArtifactTrust(
    ARTIFACT_DID,
    makeDeps({
      queryCandidates: async () => [assessment]
    })
  );

  assert.equal(result.securityAssessments.length, 1);
  assert.deepEqual(result.securityAssessments[0].verification.basis, [
    "approved-issuer"
  ]);
});

test("artifact trust excludes user reviews because they cannot prove a did:artifact subject", async () => {
  let queriedSchemas: string[] = [];

  const result = await getArtifactTrust(
    ARTIFACT_DID,
    makeDeps({
      queryCandidates: async (context) => {
        queriedSchemas = Object.keys(context.schemaUids);
        return [];
      }
    })
  );

  assert.equal(queriedSchemas.includes("user-review"), false);
  assert.equal(result.otherAttestations.length, 0);
  assert.equal(result.summary.totalQueried, 0);
});
