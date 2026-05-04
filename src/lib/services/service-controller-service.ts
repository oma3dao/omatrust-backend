import dns from "node:dns";
import { promisify } from "node:util";
import {
  buildDidPkhFromCaip10,
  extractAddressFromDid,
  getDomainFromDidWeb,
  normalizeDid
} from "@oma3/omatrust/identity";
import {
  parseDnsTxtRecord,
  fetchDidDocument,
  extractAddressesFromDidDocument,
} from "@oma3/omatrust/reputation";
import { ApiError } from "@/lib/errors";
import { resolveIdentity, type IdentityResolution } from "@/lib/services/identity-resolver-service";

const resolveTxt = promisify(dns.resolveTxt);

export type ControllerEvidenceKind = "dns-txt" | "did-json" | "account-wallet";
export type ControllerEvidenceStatus = "found" | "not-found" | "unavailable" | "unsupported";
export type ApprovedIssuerStatus = "approved" | "not-approved" | "unavailable" | "not-configured";

export interface ControllerEvidenceSource {
  kind: ControllerEvidenceKind;
  status: ControllerEvidenceStatus;
  location: string;
  keys: string[];
  error?: string;
}

export interface ControllerKeySummary {
  id: string;
  canonicalId: string;
  label: string;
  sources: ControllerEvidenceKind[];
  basic: boolean;
}

export interface ServiceControllerSummary {
  subject: IdentityResolution;
  domain: string | null;
  controllerKeys: ControllerKeySummary[];
  evidence: ControllerEvidenceSource[];
  approvedIssuer: {
    status: ApprovedIssuerStatus;
    checkedIdentifiers: string[];
    registryUrl: string | null;
  };
  warnings: string[];
}

interface ServiceControllerSummaryParams {
  subjectDid: string;
  walletDid?: string | null;
  includeAccountWallet?: boolean;
  includeApprovedIssuer?: boolean;
}

export type ControllerEndpointConfirmation = Omit<ServiceControllerSummary, "approvedIssuer">;

function canonicalKey(value: string): string | null {
  const trimmed = value.trim().replace(/^"|"$/g, "");
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith("did:")) {
      const normalized = normalizeDid(trimmed);
      return normalized.startsWith("did:pkh:") || normalized.startsWith("did:ethr:")
        ? normalized.toLowerCase()
        : normalized;
    }

    if (/^[a-z0-9-]+:[a-zA-Z0-9-]+:.+$/i.test(trimmed)) {
      return normalizeDid(buildDidPkhFromCaip10(trimmed)).toLowerCase();
    }
  } catch {
    return null;
  }

  return null;
}

async function discoverDnsKeys(domain: string, host: string): Promise<ControllerEvidenceSource> {
  const location = `${host}.${domain}`;

  try {
    const records = await resolveTxt(location);
    const keys: string[] = [];

    for (const recordParts of records) {
      const record = recordParts.join("");
      try {
        const parsed = parseDnsTxtRecord(record);
        if (parsed.controller) {
          const key = canonicalKey(parsed.controller);
          if (key && !keys.includes(key)) keys.push(key);
        }
      } catch {
        // Skip malformed records
      }
    }

    return {
      kind: "dns-txt",
      status: keys.length > 0 ? "found" : "not-found",
      location,
      keys
    };
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    return {
      kind: "dns-txt",
      status: code === "ENODATA" || code === "ENOTFOUND" ? "not-found" : "unavailable",
      location,
      keys: [],
      error: error instanceof Error ? error.message : "DNS lookup failed"
    };
  }
}

/**
 * Discover controller keys from a DID document using the SDK's parser.
 * Uses extractAddressesFromDidDocument which properly parses verificationMethod entries.
 */
async function discoverDidJsonKeys(domain: string): Promise<ControllerEvidenceSource> {
  const url = `https://${domain}/.well-known/did.json`;

  try {
    const didDocument = await fetchDidDocument(domain);
    const addresses = extractAddressesFromDidDocument(didDocument);
    const keys = addresses
      .map((addr) => canonicalKey(`did:pkh:eip155:1:${addr}`))
      .filter((key): key is string => !!key);

    return {
      kind: "did-json",
      status: keys.length > 0 ? "found" : "not-found",
      location: url,
      keys
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fetch failed";
    // OmaTrustError with NETWORK_ERROR code includes HTTP status info
    const isNotFound = message.includes("404");
    return {
      kind: "did-json",
      status: isNotFound ? "not-found" : "unavailable",
      location: url,
      keys: [],
      error: message
    };
  }
}

function addControllerKey(
  keyMap: Map<string, ControllerKeySummary>,
  keyId: string,
  source: ControllerEvidenceKind
) {
  const canonicalId = canonicalKey(keyId) ?? keyId;
  const existing = keyMap.get(canonicalId) ?? {
    id: keyId,
    canonicalId,
    label: resolveIdentity(canonicalId).label,
    sources: [],
    basic: false
  };

  if (!existing.sources.includes(source)) {
    existing.sources.push(source);
  }

  if (source === "dns-txt" || source === "did-json") {
    existing.basic = true;
  }

  keyMap.set(canonicalId, existing);
}

function registryIncludesIssuer(issuers: Array<{ address: string; schemas: string[] }>, identifiers: string[]) {
  const needles = identifiers.flatMap((identifier) => {
    const values = [identifier];
    try {
      values.push(normalizeDid(identifier));
    } catch {
      // Ignore non-DID identifiers.
    }
    try {
      values.push(extractAddressFromDid(identifier));
    } catch {
      // Ignore identifiers without an address.
    }
    return values;
  }).map((value) => value.toLowerCase());

  return issuers.some((issuer) =>
    needles.some((needle) => issuer.address.toLowerCase() === needle)
  );
}

async function checkApprovedIssuer(walletDid?: string | null) {
  const checkedIdentifiers = walletDid ? Array.from(new Set([walletDid, canonicalKey(walletDid) ?? walletDid])) : [];

  if (!walletDid || checkedIdentifiers.length === 0) {
    return { status: "not-configured" as const, checkedIdentifiers, registryUrl: null };
  }

  try {
    const { getPublicTrustAnchors } = await import("@/lib/routes/public/trust-anchors");
    const anchors = await getPublicTrustAnchors();
    const issuerRegistry = anchors.registries.find((r) => r.type === "approved-issuers");

    if (!issuerRegistry || issuerRegistry.issuers.length === 0) {
      return { status: "not-configured" as const, checkedIdentifiers, registryUrl: null };
    }

    const approved = registryIncludesIssuer(issuerRegistry.issuers, checkedIdentifiers);
    return {
      status: approved ? "approved" as const : "not-approved" as const,
      checkedIdentifiers,
      registryUrl: null
    };
  } catch {
    return { status: "unavailable" as const, checkedIdentifiers, registryUrl: null };
  }
}

export async function getServiceControllerSummary(
  params: ServiceControllerSummaryParams
): Promise<ServiceControllerSummary> {
  const includeAccountWallet = params.includeAccountWallet ?? true;
  const includeApprovedIssuer = params.includeApprovedIssuer ?? true;
  let subjectDid: string;
  try {
    subjectDid = normalizeDid(params.subjectDid);
  } catch (error) {
    throw new ApiError("Invalid subjectDid", 400, "INVALID_DID", error instanceof Error ? error.message : undefined);
  }

  const subject = resolveIdentity(subjectDid);
  const domain = getDomainFromDidWeb(subjectDid);
  const keyMap = new Map<string, ControllerKeySummary>();
  const warnings: string[] = [];

  const evidence: ControllerEvidenceSource[] = [];
  if (includeAccountWallet && params.walletDid) {
    const walletKey = canonicalKey(params.walletDid);
    if (walletKey) {
      addControllerKey(keyMap, walletKey, "account-wallet");
      evidence.push({
        kind: "account-wallet",
        status: "found",
        location: "request.walletDid",
        keys: [walletKey]
      });
    }
  }

  if (domain) {
    const discovered = await Promise.all([
      discoverDnsKeys(domain, "_controllers"),
      discoverDnsKeys(domain, "_omatrust"),
      discoverDidJsonKeys(domain)
    ]);

    for (const source of discovered) {
      evidence.push(source);
      for (const key of source.keys) {
        addControllerKey(keyMap, key, source.kind);
      }
    }
  } else {
    warnings.push("Offchain controller discovery is currently supported only for did:web subjects.");
    evidence.push(
      { kind: "dns-txt", status: "unsupported", location: "did:web only", keys: [] },
      { kind: "did-json", status: "unsupported", location: "did:web only", keys: [] }
    );
  }

  const approvedIssuer = includeApprovedIssuer
    ? await checkApprovedIssuer(params.walletDid)
    : {
        status: "not-configured" as const,
        checkedIdentifiers: [],
        registryUrl: null
      };

  return {
    subject,
    domain,
    controllerKeys: Array.from(keyMap.values()).sort((a, b) =>
      Number(b.basic) - Number(a.basic) || a.canonicalId.localeCompare(b.canonicalId)
    ),
    evidence,
    approvedIssuer,
    warnings
  };
}

export async function getControllerEndpointConfirmation(
  params: Pick<ServiceControllerSummaryParams, "subjectDid">
): Promise<ControllerEndpointConfirmation> {
  const { approvedIssuer: _approvedIssuer, ...summary } = await getServiceControllerSummary({
    subjectDid: params.subjectDid,
    includeAccountWallet: false,
    includeApprovedIssuer: false
  });

  return summary;
}
