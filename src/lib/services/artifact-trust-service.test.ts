import test from "node:test";
import assert from "node:assert/strict";
import { didToAddress } from "@oma3/omatrust/identity";
import type {
  AttestationQueryResult,
  Hex
} from "@oma3/omatrust/reputation";
import type { Provider } from "ethers";
import { ApiError } from "@/lib/errors";
import {
  getArtifactTrust,
  type ArtifactTrustServiceDeps,
  type VerifiedArtifactTrustAttestation
} from "./artifact-trust-service.ts";
import type { TrustAnchors } from "@/lib/routes/public/trust-anchors";

const ARTIFACT_DID =
  "did:artifact:bafkreibuuyyqyb7jqrlflorjiiko2efz2xgagwxxdgathcrdpcniiyzhfi";
const EAS_CONTRACT = "0x1111111111111111111111111111111111111111";
const ATTESTER = "0x2222222222222222222222222222222222222222";
const SCHEMA_NAMES = [
  "security-assessment",
  "certification",
  "user-review",
  "responsibility-claim",
  "linked-identifier"
] as const;

const schemaUids = Object.fromEntries(
  SCHEMA_NAMES.map((name, index) => [
    name,
    `0x${String(index + 1).padStart(64, "0")}`
  ])
) as Record<(typeof SCHEMA_NAMES)[number], Hex>;

const anchors: TrustAnchors = {
  version: 1,
  updatedAt: "2026-05-04T00:00:00Z",
  widgetOrigins: [],
  chains: {
    "eip155:6623": {
      name: "OMAChain Mainnet",
      easContract: EAS_CONTRACT,
      schemas: schemaUids
    }
  },
  registries: [
    {
      type: "approved-issuers",
      issuers: [
        {
          address: ATTESTER,
          label: "Test Security Lab",
          schemas: ["security-assessment", "certification", "user-review"],
          status: "active",
          validFrom: "2020-01-01T00:00:00Z"
        }
      ]
    }
  ]
};

const provider = {
  getBlockNumber: async () => 0
} as unknown as Provider;

function makeCandidate(
  schemaName: keyof typeof schemaUids,
  overrides: Partial<AttestationQueryResult> = {}
): AttestationQueryResult {
  return {
    uid: `0x${"a".repeat(64)}` as Hex,
    schema: schemaUids[schemaName],
    attester: ATTESTER as Hex,
    recipient: didToAddress(ARTIFACT_DID) as Hex,
    revocable: true,
    revocationTime: 0n,
    expirationTime: 0n,
    time: 1_800_000_000n,
    refUID: `0x${"0".repeat(64)}` as Hex,
    data: { subject: ARTIFACT_DID },
    ...overrides
  };
}

function makeRecord(
  candidate: AttestationQueryResult,
  schemaName: VerifiedArtifactTrustAttestation["attestation"]["schemaName"]
): VerifiedArtifactTrustAttestation {
  return {
    attestation: {
      uid: candidate.uid,
      schema: candidate.schema,
      schemaName,
      attester: candidate.attester,
      recipient: candidate.recipient,
      time: candidate.time.toString(),
      expirationTime: candidate.expirationTime.toString(),
      revocationTime: candidate.revocationTime.toString(),
      data: candidate.data
    },
    verification: {
      valid: true,
      basis: ["approved-issuer"]
    }
  };
}

function makeDeps(
  overrides: ArtifactTrustServiceDeps = {}
): ArtifactTrustServiceDeps {
  return {
    getActiveChain: () => ({
      chainId: 6623,
      contracts: { easContract: EAS_CONTRACT }
    }),
    getTrustAnchors: async () => anchors,
    getProvider: () => provider,
    resolveSchemaStrings: async () =>
      Object.fromEntries(
        SCHEMA_NAMES.map((name) => [name, "string subject"])
      ) as Record<(typeof SCHEMA_NAMES)[number], string>,
    queryCandidates: async () => [],
    now: () => 1_700_000_000n,
    ...overrides
  };
}

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
