import {
  buildDidPkhFromCaip10,
  extractAddressFromDid,
  extractDidMethod,
  getDomainFromDidWeb,
  normalizeDid
} from "@oma3/omatrust/identity";

export type IdentityResolutionType = "did-web" | "did-pkh" | "did-key" | "did-handle" | "did-ethr" | "address" | "unknown";
export type IdentityResolutionSource = "did-web" | "did-pkh" | "did-handle" | "did-key" | "did-ethr" | "caip10" | "address" | "raw";

export interface IdentityResolution {
  input: string;
  canonical: string;
  label: string;
  type: IdentityResolutionType;
  source: IdentityResolutionSource;
}

function truncateMiddle(value: string, head = 10, tail = 8): string {
  return value.length <= head + tail + 3 ? value : `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function isEvmAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function looksLikeCaip10(value: string) {
  return /^[a-z0-9-]+:[a-zA-Z0-9-]+:.+$/i.test(value);
}

export function resolveIdentity(identifier: string): IdentityResolution {
  const input = identifier.trim();

  if (!input) {
    return {
      input: identifier,
      canonical: "",
      label: "Unknown",
      type: "unknown",
      source: "raw"
    };
  }

  if (isEvmAddress(input)) {
    const address = extractAddressFromDid(input);
    return {
      input,
      canonical: address,
      label: truncateMiddle(address, 6, 4),
      type: "address",
      source: "address"
    };
  }

  if (!input.startsWith("did:") && looksLikeCaip10(input)) {
    try {
      const canonical = normalizeDid(buildDidPkhFromCaip10(input));
      const address = extractAddressFromDid(canonical);
      return {
        input,
        canonical,
        label: truncateMiddle(address, 6, 4),
        type: "did-pkh",
        source: "caip10"
      };
    } catch {
      // Fall through to raw handling.
    }
  }

  try {
    const canonical = normalizeDid(input);
    const method = extractDidMethod(canonical);

    if (method === "web") {
      const domain = getDomainFromDidWeb(canonical);
      return {
        input,
        canonical,
        label: domain ?? canonical,
        type: "did-web",
        source: "did-web"
      };
    }

    if (method === "pkh") {
      const address = extractAddressFromDid(canonical);
      return {
        input,
        canonical,
        label: truncateMiddle(address, 6, 4),
        type: "did-pkh",
        source: "did-pkh"
      };
    }

    if (method === "handle") {
      const [, , platform, username] = canonical.split(":");
      return {
        input,
        canonical,
        label: username ? `${username} (${platform})` : canonical,
        type: "did-handle",
        source: "did-handle"
      };
    }

    if (method === "key") {
      return {
        input,
        canonical,
        label: truncateMiddle(canonical, 16, 8),
        type: "did-key",
        source: "did-key"
      };
    }

    if (method === "ethr") {
      const address = extractAddressFromDid(canonical);
      return {
        input,
        canonical,
        label: truncateMiddle(address, 6, 4),
        type: "did-ethr",
        source: "did-ethr"
      };
    }

    return {
      input,
      canonical,
      label: truncateMiddle(canonical, 18, 8),
      type: "unknown",
      source: "raw"
    };
  } catch {
    return {
      input,
      canonical: input,
      label: truncateMiddle(input, 18, 8),
      type: "unknown",
      source: "raw"
    };
  }
}

export function resolveIdentities(identifiers: string[]) {
  return {
    identities: identifiers.map(resolveIdentity)
  };
}
