import test from "node:test";
import assert from "node:assert/strict";
import { didToAddress } from "@oma3/omatrust/identity";
import type { AttestationQueryResult, Hex } from "@oma3/omatrust/reputation";
import { getArtifactTrust } from "@/lib/services/artifact-trust-service";
import type { TrustAnchors } from "@/lib/routes/public/trust-anchors";
import {
  ARTIFACT_DID,
  ATTESTER,
  EAS_CONTRACT,
  NOW,
  OTHER_ARTIFACT_DID,
  UNKNOWN_ATTESTER,
  anchors,
  makeCandidate,
  makeDeps,
  makeRecord,
  schemaUids
} from "../helpers/artifact-trust.ts";

/**
 * These cases exercise the production verifyCandidate path (no verification stub),
 * so every exclusion below is the real gate a caller would hit in production.
 */

function withIssuer(overrides: Record<string, unknown>): TrustAnchors {
  return {
    ...anchors,
    registries: [
      {
        type: "approved-issuers",
        issuers: [
          {
            address: ATTESTER,
            label: "Test Security Lab",
            schemas: ["security-assessment", "certification"],
            status: "active",
            validFrom: "2020-01-01T00:00:00Z",
            ...overrides
          }
        ]
      }
    ]
  } as TrustAnchors;
}

async function countFor(
  candidates: AttestationQueryResult[],
  anchorsOverride?: TrustAnchors
) {
  return getArtifactTrust(
    ARTIFACT_DID,
    makeDeps({
      queryCandidates: async () => candidates,
      ...(anchorsOverride ? { getTrustAnchors: async () => anchorsOverride } : {})
    })
  );
}

test("artifact trust admits a well-formed approved-issuer attestation", async () => {
  const result = await countFor([makeCandidate("security-assessment")]);

  assert.equal(result.summary.totalVerified, 1);
  assert.equal(result.securityAssessments.length, 1);
});

test("artifact trust ignores candidates whose schema is not an anchored schema", async () => {
  const foreign = makeCandidate("security-assessment", {
    schema: `0x${"f".repeat(64)}` as Hex
  });

  const result = await countFor([foreign]);

  assert.equal(result.summary.totalQueried, 1);
  assert.equal(result.summary.totalVerified, 0);
  assert.equal(result.summary.totalExcluded, 1);
});

test("artifact trust excludes attestations issued to a different artifact address", async () => {
  const misdirected = makeCandidate("security-assessment", {
    recipient: didToAddress(OTHER_ARTIFACT_DID) as Hex
  });

  const result = await countFor([misdirected]);

  assert.equal(result.summary.totalVerified, 0);
  assert.equal(result.securityAssessments.length, 0);
});

test("artifact trust excludes attestations whose payload names a different subject", async () => {
  const mismatched = makeCandidate("security-assessment", {
    data: { subject: OTHER_ARTIFACT_DID }
  });

  const result = await countFor([mismatched]);

  assert.equal(result.summary.totalVerified, 0);
});

test("artifact trust excludes attestations whose on-chain expiration has passed", async () => {
  const expired = makeCandidate("security-assessment", {
    expirationTime: NOW - 1n
  });

  const result = await countFor([expired]);

  assert.equal(result.summary.totalVerified, 0);
  assert.equal(result.summary.totalExcluded, 1);
});

test("artifact trust admits attestations whose on-chain expiration is still ahead", async () => {
  const live = makeCandidate("security-assessment", {
    expirationTime: NOW + 1n
  });

  const result = await countFor([live]);

  assert.equal(result.summary.totalVerified, 1);
});

test("artifact trust excludes attestations from an attester outside the registry", async () => {
  const unapproved = makeCandidate("security-assessment", {
    attester: UNKNOWN_ATTESTER as Hex
  });

  const result = await countFor([unapproved]);

  assert.equal(result.summary.totalVerified, 0);
});

test("artifact trust excludes issuers whose registry entry is not active", async () => {
  const result = await countFor(
    [makeCandidate("security-assessment")],
    withIssuer({ status: "suspended" })
  );

  assert.equal(result.summary.totalVerified, 0);
});

test("artifact trust excludes issuers revoked before the attestation was issued", async () => {
  const result = await countFor(
    [makeCandidate("security-assessment", { time: NOW - 100n })],
    withIssuer({ revokedAt: "2020-06-01T00:00:00Z" })
  );

  assert.equal(result.summary.totalVerified, 0);
});

test("artifact trust admits issuers revoked after the attestation was issued", async () => {
  const result = await countFor(
    [makeCandidate("security-assessment", { time: NOW - 100n })],
    withIssuer({ revokedAt: "2100-01-01T00:00:00Z" })
  );

  assert.equal(result.summary.totalVerified, 1);
});

test("artifact trust excludes attestations issued before the issuer was approved", async () => {
  const result = await countFor(
    [makeCandidate("security-assessment", { time: NOW - 100n })],
    withIssuer({ validFrom: "2100-01-01T00:00:00Z" })
  );

  assert.equal(result.summary.totalVerified, 0);
});

test("artifact trust excludes schemas the issuer is not approved to attest", async () => {
  const result = await countFor(
    [makeCandidate("security-assessment")],
    withIssuer({ schemas: ["certification"] })
  );

  assert.equal(result.summary.totalVerified, 0);
});

test("artifact trust rejects anchors whose EAS contract disagrees with the active chain", async () => {
  await assert.rejects(
    () =>
      countFor([], {
        ...anchors,
        chains: {
          "eip155:6623": {
            name: "OMAChain Mainnet",
            easContract: "0x9999999999999999999999999999999999999999",
            schemas: schemaUids
          }
        }
      } as TrustAnchors),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "UNSUPPORTED_CHAIN"
  );
});

test("artifact trust rejects anchors that are missing a required schema uid", async () => {
  const { "security-assessment": _omitted, ...partialSchemas } = schemaUids;

  await assert.rejects(
    () =>
      countFor([], {
        ...anchors,
        chains: {
          "eip155:6623": {
            name: "OMAChain Mainnet",
            easContract: EAS_CONTRACT,
            schemas: partialSchemas
          }
        }
      } as TrustAnchors),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "UNSUPPORTED_CHAIN"
  );
});

test("artifact trust rejects anchors whose schema uid is not a 32-byte value", async () => {
  await assert.rejects(
    () =>
      countFor([], {
        ...anchors,
        chains: {
          "eip155:6623": {
            name: "OMAChain Mainnet",
            easContract: EAS_CONTRACT,
            schemas: { ...schemaUids, "security-assessment": "0xdeadbeef" }
          }
        }
      } as TrustAnchors),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "UNSUPPORTED_CHAIN"
  );
});

test("artifact trust reports on-chain timestamps as decimal strings", async () => {
  const result = await countFor([
    makeCandidate("security-assessment", {
      time: 1_700_000_123n,
      expirationTime: NOW + 500n
    })
  ]);

  const [record] = result.securityAssessments;
  assert.equal(record.attestation.time, "1700000123");
  assert.equal(record.attestation.expirationTime, "1700000500");
  assert.equal(record.attestation.revocationTime, "0");
});

test("artifact trust labels verified records with the approving issuer", async () => {
  const result = await countFor([makeCandidate("security-assessment")]);

  assert.equal(
    result.securityAssessments[0].attestation.attesterLabel,
    "Test Security Lab"
  );
});

test("artifact trust groups certifications separately from security assessments", async () => {
  const result = await countFor([
    makeCandidate("security-assessment", { uid: `0x${"a".repeat(64)}` as Hex }),
    makeCandidate("certification", { uid: `0x${"b".repeat(64)}` as Hex })
  ]);

  assert.equal(result.securityAssessments.length, 1);
  assert.equal(result.certifications.length, 1);
  assert.equal(result.summary.totalVerified, 2);
});

test("artifact trust breaks issuance-time ties by uid so ordering is stable", async () => {
  const first = makeCandidate("security-assessment", {
    uid: `0x${"1".repeat(64)}` as Hex
  });
  const second = makeCandidate("security-assessment", {
    uid: `0x${"2".repeat(64)}` as Hex
  });

  const result = await getArtifactTrust(
    ARTIFACT_DID,
    makeDeps({
      queryCandidates: async () => [second, first],
      verifyCandidate: async (candidate, schemaName) => ({
        group: "securityAssessments",
        record: makeRecord(candidate, schemaName)
      })
    })
  );

  assert.deepEqual(
    result.securityAssessments.map((item) => item.attestation.uid),
    [first.uid, second.uid]
  );
});

test("artifact trust keeps the summary consistent with the returned evidence", async () => {
  const accepted = makeCandidate("security-assessment", {
    uid: `0x${"a".repeat(64)}` as Hex
  });
  const revoked = makeCandidate("certification", {
    uid: `0x${"b".repeat(64)}` as Hex,
    revocationTime: NOW - 1n
  });
  const foreignSubject = makeCandidate("security-assessment", {
    uid: `0x${"c".repeat(64)}` as Hex,
    data: { subject: OTHER_ARTIFACT_DID }
  });

  const result = await countFor([accepted, revoked, foreignSubject]);

  const returned = [
    ...result.responsibilityClaims,
    ...result.securityAssessments,
    ...result.certifications,
    ...result.otherAttestations
  ];

  assert.equal(result.summary.totalQueried, 3);
  assert.equal(result.summary.totalVerified, returned.length);
  assert.equal(
    result.summary.totalQueried,
    result.summary.totalVerified + result.summary.totalExcluded
  );
  assert.equal(
    returned.every((item) => item.verification.valid === true),
    true
  );
  assert.equal(
    returned.every((item) => item.verification.basis.length > 0),
    true
  );
});

test("artifact trust echoes the trust anchors version used for the decision", async () => {
  const result = await countFor([], { ...anchors, version: 42 } as TrustAnchors);

  assert.equal(result.trustAnchorsVersion, 42);
});

/**
 * Payload-level effectiveAt / expiresAt are distinct from the on-chain
 * expirationTime gate. The schema string must declare those fields so
 * validateAttestationData does not reject them before the time check runs.
 */
const TIMED_SCHEMA = "string subject,uint64 effectiveAt,uint64 expiresAt,uint64 issuedAt";

function timedDeps(candidates: AttestationQueryResult[], anchorsOverride?: TrustAnchors) {
  return makeDeps({
    queryCandidates: async () => candidates,
    resolveSchemaStrings: async () => ({
      "security-assessment": TIMED_SCHEMA,
      certification: TIMED_SCHEMA,
      "responsibility-claim": TIMED_SCHEMA,
      "linked-identifier": TIMED_SCHEMA
    }),
    ...(anchorsOverride ? { getTrustAnchors: async () => anchorsOverride } : {})
  });
}

test("artifact trust excludes attestations that are not yet effective", async () => {
  const result = await getArtifactTrust(
    ARTIFACT_DID,
    timedDeps([
      makeCandidate("security-assessment", {
        data: {
          subject: ARTIFACT_DID,
          issuedAt: NOW - 10n,
          effectiveAt: NOW + 60n,
          expiresAt: 0n
        }
      })
    ])
  );

  assert.equal(result.summary.totalVerified, 0);
});

test("artifact trust admits attestations whose effectiveAt is zero (open start)", async () => {
  const result = await getArtifactTrust(
    ARTIFACT_DID,
    timedDeps([
      makeCandidate("security-assessment", {
        data: {
          subject: ARTIFACT_DID,
          issuedAt: NOW - 10n,
          effectiveAt: 0n,
          expiresAt: NOW + 60n
        }
      })
    ])
  );

  assert.equal(result.summary.totalVerified, 1);
});

test("artifact trust excludes attestations whose payload expiresAt has passed", async () => {
  const result = await getArtifactTrust(
    ARTIFACT_DID,
    timedDeps([
      makeCandidate("security-assessment", {
        data: {
          subject: ARTIFACT_DID,
          issuedAt: NOW - 10n,
          effectiveAt: 0n,
          expiresAt: NOW - 1n
        }
      })
    ])
  );

  assert.equal(result.summary.totalVerified, 0);
});

test("artifact trust admits attestations whose payload expiresAt is zero (open-ended)", async () => {
  const result = await getArtifactTrust(
    ARTIFACT_DID,
    timedDeps([
      makeCandidate("security-assessment", {
        data: {
          subject: ARTIFACT_DID,
          issuedAt: NOW - 10n,
          effectiveAt: NOW - 10n,
          expiresAt: 0n
        }
      })
    ])
  );

  assert.equal(result.summary.totalVerified, 1);
});

test("artifact trust excludes attestations whose payload time fields are unparseable", async () => {
  const badEffective = await getArtifactTrust(
    ARTIFACT_DID,
    timedDeps([
      makeCandidate("security-assessment", {
        data: {
          subject: ARTIFACT_DID,
          issuedAt: NOW - 10n,
          effectiveAt: "soon",
          expiresAt: NOW + 60n
        }
      })
    ])
  );
  const badExpires = await getArtifactTrust(
    ARTIFACT_DID,
    timedDeps([
      makeCandidate("security-assessment", {
        data: {
          subject: ARTIFACT_DID,
          issuedAt: NOW - 10n,
          effectiveAt: 0n,
          expiresAt: "never"
        }
      })
    ])
  );

  assert.equal(badEffective.summary.totalVerified, 0);
  assert.equal(badExpires.summary.totalVerified, 0);
});

test("artifact trust serializes nested bigint payload fields as decimal strings", async () => {
  const result = await getArtifactTrust(
    ARTIFACT_DID,
    timedDeps([
      makeCandidate("security-assessment", {
        data: {
          subject: ARTIFACT_DID,
          issuedAt: 1_700_000_042n,
          effectiveAt: 0n,
          expiresAt: NOW + 3_600n
        }
      })
    ])
  );

  const data = result.securityAssessments[0]?.attestation.data;
  assert.equal(data?.issuedAt, "1700000042");
  assert.equal(data?.effectiveAt, "0");
  assert.equal(data?.expiresAt, "1700003600");
});

test("artifact trust maps SCHEMA_NOT_FOUND from a dependency to UNSUPPORTED_CHAIN", async () => {
  await assert.rejects(
    () =>
      getArtifactTrust(
        ARTIFACT_DID,
        makeDeps({
          getTrustAnchors: async () => {
            throw Object.assign(new Error("schema missing"), { code: "SCHEMA_NOT_FOUND" });
          }
        })
      ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "UNSUPPORTED_CHAIN" &&
      "statusCode" in error &&
      error.statusCode === 400
  );
});

test("artifact trust maps an unexpected dependency failure to INTERNAL_ERROR", async () => {
  await assert.rejects(
    () =>
      getArtifactTrust(
        ARTIFACT_DID,
        makeDeps({
          queryCandidates: async () => {
            throw new Error("upstream timeout");
          }
        })
      ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "INTERNAL_ERROR" &&
      "statusCode" in error &&
      error.statusCode === 500
  );
});

test("artifact trust excludes an issuer whose revokedAt timestamp cannot be parsed", async () => {
  const result = await countFor([makeCandidate("security-assessment")], withIssuer({
    revokedAt: "not-a-date"
  }));

  assert.equal(result.summary.totalVerified, 0);
});
