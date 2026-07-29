import { createRequire } from "node:module";
import { SchemaRegistry } from "@ethereum-attestation-service/eas-sdk";
import { Contract } from "ethers";
import type { Provider } from "ethers";
import { didToAddress, parseArtifactDid } from "@oma3/omatrust/identity";
import type {
  AttestationQueryResult,
  ControllerAuthorizationResult,
  Hex,
  VerifyAttestationResult,
  VerifyResponsibilityClaimResult
} from "@oma3/omatrust/reputation";
import { getActiveChain } from "@/lib/config/env";
import { getPublicRpcProvider } from "@/lib/config/rpc";
import { ApiError } from "@/lib/errors";
import logger from "@/lib/logger";
import {
  getPublicTrustAnchors,
  type ApprovedIssuer,
  type TrustAnchors
} from "@/lib/routes/public/trust-anchors";

const require = createRequire(import.meta.url);
const reputationSdk = require("@oma3/omatrust/reputation") as typeof import("@oma3/omatrust/reputation");

const EAS_SCHEMA_REGISTRY_ABI = [
  "function getSchemaRegistry() view returns (address)"
] as const;
const QUERY_BLOCK_RANGE = 50_000;

const SCHEMA_POLICIES = {
  "security-assessment": {
    group: "securityAssessments",
    verification: "approved-issuer",
    requiresProof: false
  },
  certification: {
    group: "certifications",
    verification: "approved-issuer",
    requiresProof: false
  },
  "responsibility-claim": {
    group: "responsibilityClaims",
    verification: "responsibility",
    // proofs[] is reserved/unused; trust is controller authorization.
    requiresProof: false
  },
  "linked-identifier": {
    group: "otherAttestations",
    verification: "linked-identifier",
    requiresProof: true
  }
} as const;

type SchemaName = keyof typeof SCHEMA_POLICIES;
type EvidenceGroup = (typeof SCHEMA_POLICIES)[SchemaName]["group"];
type VerificationPolicy = (typeof SCHEMA_POLICIES)[SchemaName]["verification"];

export type ArtifactTrustBasis =
  | "approved-issuer"
  | "proof"
  | "controller-authorization"
  | "authorization-window";

export interface ArtifactTrustAttestation {
  uid: string;
  schema: string;
  schemaName: SchemaName;
  attester: string;
  attesterLabel?: string;
  recipient: string;
  time: string;
  expirationTime: string;
  revocationTime: string;
  data: Record<string, unknown>;
}

export interface VerifiedArtifactTrustAttestation {
  attestation: ArtifactTrustAttestation;
  verification: {
    valid: true;
    basis: ArtifactTrustBasis[];
  };
}

export interface ArtifactTrustResponse {
  artifactDid: string;
  chain: {
    chainId: number;
    caip2: string;
    easContract: string;
  };
  trustAnchorsVersion: number;
  responsibilityClaims: VerifiedArtifactTrustAttestation[];
  securityAssessments: VerifiedArtifactTrustAttestation[];
  certifications: VerifiedArtifactTrustAttestation[];
  otherAttestations: VerifiedArtifactTrustAttestation[];
  summary: {
    totalQueried: number;
    totalVerified: number;
    totalExcluded: number;
    complete: true;
  };
}

interface ActiveChain {
  chainId: number;
  contracts: {
    easContract: string;
  };
}

interface ArtifactTrustContext {
  artifactDid: string;
  chainId: number;
  caip2: string;
  easContract: Hex;
  provider: Provider;
  anchors: TrustAnchors;
  schemaUids: Record<SchemaName, Hex>;
  schemaStrings: Record<SchemaName, string>;
}

interface VerifiedCandidate {
  group: EvidenceGroup;
  record: VerifiedArtifactTrustAttestation;
}

export interface ArtifactTrustServiceDeps {
  getActiveChain?: () => ActiveChain;
  getTrustAnchors?: () => Promise<TrustAnchors>;
  getProvider?: () => Provider;
  resolveSchemaStrings?: (
    provider: Provider,
    easContract: Hex,
    schemaUids: Record<SchemaName, Hex>
  ) => Promise<Record<SchemaName, string>>;
  queryCandidates?: (context: ArtifactTrustContext) => Promise<AttestationQueryResult[]>;
  verifyCandidate?: (
    candidate: AttestationQueryResult,
    schemaName: SchemaName,
    schemaString: string,
    context: ArtifactTrustContext,
    now: bigint
  ) => Promise<VerifiedCandidate | null>;
  now?: () => bigint;
}

function isHex32(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isAddress(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function getSchemaUids(
  anchors: TrustAnchors,
  caip2: string,
  configuredEasContract: string
): { easContract: Hex; schemaUids: Record<SchemaName, Hex> } {
  const chainAnchors = anchors.chains[caip2];
  if (
    !chainAnchors ||
    !isAddress(chainAnchors.easContract) ||
    chainAnchors.easContract.toLowerCase() !== configuredEasContract.toLowerCase()
  ) {
    throw new ApiError(
      "The active chain does not have usable artifact trust anchors",
      400,
      "UNSUPPORTED_CHAIN"
    );
  }

  const schemaUids = {} as Record<SchemaName, Hex>;
  for (const schemaName of Object.keys(SCHEMA_POLICIES) as SchemaName[]) {
    const uid = chainAnchors.schemas[schemaName];
    if (!uid || !isHex32(uid)) {
      throw new ApiError(
        `The active chain is missing the ${schemaName} artifact trust schema`,
        400,
        "UNSUPPORTED_CHAIN"
      );
    }
    schemaUids[schemaName] = uid;
  }

  return {
    easContract: chainAnchors.easContract as Hex,
    schemaUids
  };
}

async function resolveSchemaStrings(
  provider: Provider,
  easContract: Hex,
  schemaUids: Record<SchemaName, Hex>
): Promise<Record<SchemaName, string>> {
  try {
    const eas = new Contract(easContract, EAS_SCHEMA_REGISTRY_ABI, provider);
    const schemaRegistryAddress = String(await eas.getSchemaRegistry());
    if (!isAddress(schemaRegistryAddress)) {
      throw new ApiError(
        "The active EAS contract does not expose a usable schema registry",
        400,
        "UNSUPPORTED_CHAIN"
      );
    }

    const registry = new SchemaRegistry(schemaRegistryAddress);
    registry.connect(provider);

    const entries = await Promise.all(
      (Object.entries(schemaUids) as Array<[SchemaName, Hex]>).map(
        async ([schemaName, schemaUid]) => {
          const details = await reputationSdk.getSchemaDetails(registry, schemaUid);
          return [schemaName, details.schema] as const;
        }
      )
    );

    return Object.fromEntries(entries) as Record<SchemaName, string>;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (error instanceof ApiError || code === "SCHEMA_NOT_FOUND") {
      throw error;
    }
    throw new ApiError(
      "Artifact trust schema lookup is temporarily unavailable",
      502,
      "NETWORK_ERROR"
    );
  }
}

async function queryAllCandidates(
  context: ArtifactTrustContext
): Promise<AttestationQueryResult[]> {
  try {
    const latestBlock = await context.provider.getBlockNumber();
    const schemaUids = Object.values(context.schemaUids);
    const candidatesByUid = new Map<string, AttestationQueryResult>();

    for (let fromBlock = 0; fromBlock <= latestBlock; fromBlock += QUERY_BLOCK_RANGE) {
      const toBlock = Math.min(latestBlock, fromBlock + QUERY_BLOCK_RANGE - 1);
      const chunk = await reputationSdk.getAttestationsForDid({
        subjectDid: context.artifactDid,
        provider: context.provider,
        easContractAddress: context.easContract,
        schemas: schemaUids,
        fromBlock,
        toBlock
      });

      for (const candidate of chunk) {
        candidatesByUid.set(candidate.uid.toLowerCase(), candidate);
      }
    }

    return [...candidatesByUid.values()];
  } catch {
    throw new ApiError(
      "Artifact trust chain query is temporarily unavailable",
      502,
      "NETWORK_ERROR"
    );
  }
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

function isCurrentlyEffective(data: Record<string, unknown>, now: bigint): boolean {
  if (data.effectiveAt !== undefined) {
    const effectiveAt = toBigInt(data.effectiveAt);
    if (effectiveAt === null || (effectiveAt !== 0n && effectiveAt > now)) {
      return false;
    }
  }

  if (data.expiresAt !== undefined) {
    const expiresAt = toBigInt(data.expiresAt);
    if (expiresAt === null || (expiresAt !== 0n && expiresAt <= now)) {
      return false;
    }
  }

  return true;
}

function getApprovedIssuer(
  anchors: TrustAnchors,
  schemaName: SchemaName,
  attester: string,
  issuedAt: bigint
): ApprovedIssuer | null {
  const registry = anchors.registries.find(
    (candidate) => candidate.type === "approved-issuers"
  );
  const issuer = registry?.issuers.find(
    (candidate) => candidate.address.toLowerCase() === attester.toLowerCase()
  );

  if (
    !issuer ||
    issuer.status !== "active" ||
    !issuer.schemas.includes(schemaName)
  ) {
    return null;
  }

  const validFrom = Date.parse(issuer.validFrom);
  if (!Number.isFinite(validFrom) || BigInt(Math.floor(validFrom / 1000)) > issuedAt) {
    return null;
  }

  if (issuer.revokedAt) {
    const revokedAt = Date.parse(issuer.revokedAt);
    if (!Number.isFinite(revokedAt) || BigInt(Math.floor(revokedAt / 1000)) <= issuedAt) {
      return null;
    }
  }

  return issuer;
}

function parseProofs(data: Record<string, unknown>): unknown[] {
  if (!Array.isArray(data.proofs)) {
    return [];
  }
  return data.proofs.map((proof) => {
    if (typeof proof !== "string") {
      return proof;
    }
    try {
      return JSON.parse(proof) as unknown;
    } catch {
      return null;
    }
  }).filter((proof) => proof !== null);
}

function issuedDuringAuthorizationWindow(
  authorization: ControllerAuthorizationResult,
  issuedAt: bigint
): boolean {
  if (!authorization.authorized) {
    return false;
  }
  const afterStart =
    authorization.anchoredFrom === null || issuedAt >= authorization.anchoredFrom;
  const beforeEnd = authorization.until === null || issuedAt <= authorization.until;
  return afterStart && beforeEnd;
}

async function verifyApprovedIssuerCandidate(
  candidate: AttestationQueryResult,
  schemaName: SchemaName,
  context: ArtifactTrustContext,
  requiresProof: boolean
): Promise<{ basis: ArtifactTrustBasis[]; issuer: ApprovedIssuer } | null> {
  if (requiresProof) {
    let verification: VerifyAttestationResult;
    try {
      verification = await reputationSdk.verifyAttestation({
        attestation: candidate,
        provider: context.provider,
        context: { subjectDid: context.artifactDid }
      });
    } catch {
      throw new ApiError(
        "Artifact proof verification is temporarily unavailable",
        502,
        "NETWORK_ERROR"
      );
    }
    if (!verification.valid) {
      return null;
    }
  }

  const issuer = getApprovedIssuer(
    context.anchors,
    schemaName,
    candidate.attester,
    candidate.time
  );
  if (!issuer) {
    return null;
  }

  return {
    basis: requiresProof ? ["approved-issuer", "proof"] : ["approved-issuer"],
    issuer
  };
}

async function verifyResponsibilityCandidate(
  candidate: AttestationQueryResult,
  schemaString: string,
  context: ArtifactTrustContext
): Promise<ArtifactTrustBasis[] | null> {
  const verification: VerifyResponsibilityClaimResult =
    await reputationSdk.verifyResponsibilityClaim({
      attestation: candidate,
      artifactDid: context.artifactDid,
      provider: context.provider,
      easContractAddress: context.easContract,
      chain: context.caip2,
      chainId: context.chainId,
      responsibilityClaimSchemaString: schemaString
    });

  if (
    verification.reasons.some((reason) =>
      reason.startsWith("Controller authorization check failed:")
    )
  ) {
    throw new ApiError(
      "Required controller authorization lookup failed",
      502,
      "NETWORK_ERROR"
    );
  }

  if (!verification.valid) {
    return null;
  }

  // Responsibility-claim proofs[] is schema-reserved/unused today. Do not call
  // verifyAttestation() here — empty proofs would fail that gate incorrectly.
  // Material trust is controller authorization + issuance window via the SDK.
  return ["controller-authorization", "authorization-window"];
}

async function verifyLinkedIdentifierCandidate(
  candidate: AttestationQueryResult,
  data: Record<string, unknown>,
  context: ArtifactTrustContext
): Promise<ArtifactTrustBasis[] | null> {
  const subject = data.subject;
  const linkedId = data.linkedId;
  const proofs = parseProofs(data);
  if (
    typeof subject !== "string" ||
    subject !== context.artifactDid ||
    typeof linkedId !== "string" ||
    proofs.length === 0
  ) {
    return null;
  }

  const proofVerification = reputationSdk.verifyLinkedIdentifierProofs({
    subject,
    linkedId,
    proofs: proofs as never[],
    attester: candidate.attester
  });
  if (!proofVerification.valid) {
    return null;
  }

  let genericVerification: VerifyAttestationResult;
  try {
    genericVerification = await reputationSdk.verifyAttestation({
      attestation: candidate,
      provider: context.provider,
      context: { subjectDid: subject }
    });
  } catch {
    throw new ApiError(
      "Linked identifier proof verification is temporarily unavailable",
      502,
      "NETWORK_ERROR"
    );
  }
  if (!genericVerification.valid) {
    return null;
  }

  const controllerDid =
    `did:pkh:eip155:${context.chainId}:${candidate.attester.toLowerCase()}`;
  let authorization: ControllerAuthorizationResult;
  try {
    authorization = await reputationSdk.getControllerAuthorization({
      subjectDid: linkedId,
      controllerDid,
      provider: context.provider,
      chain: context.caip2,
      easContractAddress: context.easContract
    });
  } catch {
    throw new ApiError(
      "Required controller authorization lookup failed",
      502,
      "NETWORK_ERROR"
    );
  }
  const issuedAt = toBigInt(data.issuedAt) ?? candidate.time;
  if (!issuedDuringAuthorizationWindow(authorization, issuedAt)) {
    return null;
  }

  return ["proof", "controller-authorization", "authorization-window"];
}

function serializeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString(10);
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, serializeValue(entry)])
    );
  }
  return value;
}

async function verifyCandidate(
  candidate: AttestationQueryResult,
  schemaName: SchemaName,
  schemaString: string,
  context: ArtifactTrustContext,
  now: bigint
): Promise<VerifiedCandidate | null> {
  const policy = SCHEMA_POLICIES[schemaName];
  const expectedRecipient = didToAddress(context.artifactDid);
  if (
    candidate.schema.toLowerCase() !== context.schemaUids[schemaName].toLowerCase() ||
    candidate.recipient.toLowerCase() !== expectedRecipient.toLowerCase() ||
    candidate.revocationTime !== 0n ||
    (candidate.expirationTime !== 0n && candidate.expirationTime <= now)
  ) {
    return null;
  }

  let data: Record<string, unknown>;
  try {
    data = candidate.raw
      ? reputationSdk.decodeAttestationData(schemaString, candidate.raw)
      : candidate.data;
    if (reputationSdk.validateAttestationData(schemaString, data).length > 0) {
      return null;
    }
  } catch {
    return null;
  }

  if (
    ("subject" in data && data.subject !== context.artifactDid) ||
    !isCurrentlyEffective(data, now)
  ) {
    return null;
  }

  const decodedCandidate: AttestationQueryResult = {
    ...candidate,
    data
  };
  let basis: ArtifactTrustBasis[] | null = null;
  let issuer: ApprovedIssuer | null = null;

  switch (policy.verification as VerificationPolicy) {
    case "approved-issuer": {
      const result = await verifyApprovedIssuerCandidate(
        decodedCandidate,
        schemaName,
        context,
        policy.requiresProof
      );
      basis = result?.basis ?? null;
      issuer = result?.issuer ?? null;
      break;
    }
    case "responsibility":
      basis = await verifyResponsibilityCandidate(
        decodedCandidate,
        schemaString,
        context
      );
      break;
    case "linked-identifier":
      basis = await verifyLinkedIdentifierCandidate(
        decodedCandidate,
        data,
        context
      );
      break;
  }

  if (!basis) {
    return null;
  }

  return {
    group: policy.group,
    record: {
      attestation: {
        uid: candidate.uid,
        schema: candidate.schema,
        schemaName,
        attester: candidate.attester,
        ...(issuer ? { attesterLabel: issuer.label } : {}),
        recipient: candidate.recipient,
        time: candidate.time.toString(10),
        expirationTime: candidate.expirationTime.toString(10),
        revocationTime: candidate.revocationTime.toString(10),
        data: serializeValue(data) as Record<string, unknown>
      },
      verification: {
        valid: true,
        basis
      }
    }
  };
}

function sortEvidence(records: VerifiedArtifactTrustAttestation[]) {
  records.sort((left, right) => {
    const timeOrder =
      BigInt(right.attestation.time) - BigInt(left.attestation.time);
    if (timeOrder !== 0n) {
      return timeOrder > 0n ? 1 : -1;
    }
    return left.attestation.uid.localeCompare(right.attestation.uid);
  });
}

function mapServiceError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (code === "INVALID_DID" || code === "INVALID_INPUT") {
    return new ApiError("artifactDid must be a valid did:artifact DID", 400, "INVALID_DID");
  }
  if (code === "UNSUPPORTED_CHAIN" || code === "SCHEMA_NOT_FOUND") {
    return new ApiError(
      "The active chain does not support artifact trust lookup",
      400,
      "UNSUPPORTED_CHAIN"
    );
  }

  return new ApiError("Artifact trust lookup failed", 500, "INTERNAL_ERROR");
}

export async function getArtifactTrust(
  artifactDid: string,
  deps: ArtifactTrustServiceDeps = {}
): Promise<ArtifactTrustResponse> {
  let canonicalArtifactDid: string;
  try {
    canonicalArtifactDid = parseArtifactDid(artifactDid).did;
  } catch (error) {
    throw mapServiceError(error);
  }

  try {
    const chain = (deps.getActiveChain ?? getActiveChain)();
    const caip2 = `eip155:${chain.chainId}`;
    const anchors = await (deps.getTrustAnchors ?? getPublicTrustAnchors)();
    const { easContract, schemaUids } = getSchemaUids(
      anchors,
      caip2,
      chain.contracts.easContract
    );
    const provider = (deps.getProvider ?? getPublicRpcProvider)();
    const schemaStrings = await (
      deps.resolveSchemaStrings ?? resolveSchemaStrings
    )(provider, easContract, schemaUids);
    const context: ArtifactTrustContext = {
      artifactDid: canonicalArtifactDid,
      chainId: chain.chainId,
      caip2,
      easContract,
      provider,
      anchors,
      schemaUids,
      schemaStrings
    };
    const candidates = await (deps.queryCandidates ?? queryAllCandidates)(context);
    const verify = deps.verifyCandidate ?? verifyCandidate;
    const now = (deps.now ?? (() => BigInt(Math.floor(Date.now() / 1000))))();

    const groups = {
      responsibilityClaims: [] as VerifiedArtifactTrustAttestation[],
      securityAssessments: [] as VerifiedArtifactTrustAttestation[],
      certifications: [] as VerifiedArtifactTrustAttestation[],
      otherAttestations: [] as VerifiedArtifactTrustAttestation[]
    };
    const schemaNameByUid = new Map(
      (Object.entries(schemaUids) as Array<[SchemaName, Hex]>).map(
        ([name, uid]) => [uid.toLowerCase(), name]
      )
    );

    for (const candidate of candidates) {
      const schemaName = schemaNameByUid.get(candidate.schema.toLowerCase());
      if (!schemaName) {
        continue;
      }
      const verified = await verify(
        candidate,
        schemaName,
        schemaStrings[schemaName],
        context,
        now
      );
      if (verified) {
        groups[verified.group].push(verified.record);
      }
    }

    for (const records of Object.values(groups)) {
      sortEvidence(records);
    }

    const totalVerified = Object.values(groups).reduce(
      (total, records) => total + records.length,
      0
    );

    return {
      artifactDid: canonicalArtifactDid,
      chain: {
        chainId: chain.chainId,
        caip2,
        easContract
      },
      trustAnchorsVersion: anchors.version,
      ...groups,
      summary: {
        totalQueried: candidates.length,
        totalVerified,
        totalExcluded: candidates.length - totalVerified,
        complete: true
      }
    };
  } catch (error) {
    const mapped = mapServiceError(error);
    if (mapped.statusCode >= 500) {
      logger.error("[artifact-trust] lookup failed", {
        artifactDid: canonicalArtifactDid,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    throw mapped;
  }
}
