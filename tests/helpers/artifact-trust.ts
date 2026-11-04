import { didToAddress } from "@oma3/omatrust/identity";
import type { AttestationQueryResult, Hex } from "@oma3/omatrust/reputation";
import type { Provider } from "ethers";
import type {
  ArtifactTrustServiceDeps,
  VerifiedArtifactTrustAttestation
} from "@/lib/services/artifact-trust-service";
import type { TrustAnchors } from "@/lib/routes/public/trust-anchors";

export const ARTIFACT_DID =
  "did:artifact:bafkreibuuyyqyb7jqrlflorjiiko2efz2xgagwxxdgathcrdpcniiyzhfi";
export const OTHER_ARTIFACT_DID =
  "did:artifact:bafkreicuuyyqyb7jqrlflorjiiko2efz2xgagwxxdgathcrdpcniiyzhfi";
export const EAS_CONTRACT = "0x1111111111111111111111111111111111111111";
export const ATTESTER = "0x2222222222222222222222222222222222222222";
export const UNKNOWN_ATTESTER = "0x3333333333333333333333333333333333333333";

export const SCHEMA_NAMES = [
  "security-assessment",
  "certification",
  "user-review",
  "responsibility-claim",
  "linked-identifier"
] as const;

export type SchemaName = (typeof SCHEMA_NAMES)[number];

export const schemaUids = Object.fromEntries(
  SCHEMA_NAMES.map((name, index) => [
    name,
    `0x${String(index + 1).padStart(64, "0")}`
  ])
) as Record<SchemaName, Hex>;

export const anchors: TrustAnchors = {
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

export const provider = {
  getBlockNumber: async () => 0
} as unknown as Provider;

/** Fixed clock used by every artifact trust test so time-based gates are deterministic. */
export const NOW = 1_700_000_000n;

export function makeCandidate(
  schemaName: SchemaName,
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

export function makeRecord(
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

export function makeDeps(
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
      ) as Record<SchemaName, string>,
    queryCandidates: async () => [],
    now: () => NOW,
    ...overrides
  };
}
