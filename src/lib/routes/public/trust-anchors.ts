const OMACHAIN_TESTNET_CHAIN_ID = "66238";

export const TRUST_ANCHORS_VERSION = 1;

export type ChainTrustAnchors = {
  name: string;
  easContract: string;
  schemas: Record<string, string>;
};

export type ApprovedIssuer = {
  address: string;
  label: string;
  schemas: string[];
};

export type ApprovedIssuerRegistry = {
  type: "approved-issuers";
  issuers: ApprovedIssuer[];
};

export type TrustAnchorRegistry = ApprovedIssuerRegistry;

export type TrustAnchors = {
  version: number;
  updatedAt: string;
  widgetOrigins: string[];
  chains: Record<string, ChainTrustAnchors>;
  registries: TrustAnchorRegistry[];
};

const CHAIN_TRUST_ANCHORS: Record<string, ChainTrustAnchors> = {
  [OMACHAIN_TESTNET_CHAIN_ID]: {
    name: "OMAChain Testnet",
    easContract: "0x8835AF90f1537777F52E482C8630cE4e947eCa32",
    schemas: {
      "certification": "0x2b0d1100f7943c0c2ea29e35c1286bd860fa752124e035cafb503bb83f234805",
      "controller-witness": "0xc81419f828755c0be2c49091dcad0887b5ca7342316dfffb4314aadbf8205090",
      "key-binding": "0x807b38ce9aa23fdde4457de01db9c5e8d6ec7c8feebee242e52be70847b7b966",
      "linked-identifier": "0x26e21911c55587925afee4b17839ab091e9829321b4a4e1658c497eb0088b453",
      "security-assessment": "0x67bcc2424e3721d56e85bb650c6aba8bf7f1711d9c9a434c3afae3a22d23eed7",
      "user-review": "0x7ab3911527e5e47eaab9f5a2c571060026532dde8cb4398185553053963b2a47",
      "user-review-response": "0x53498ae8ae4928a8789e09663f44d6e3c77daeb703c3765aa184b958c3ca41be",
    },
  },
};

/**
 * Approved issuers.
 *
 * Each entry specifies which attestation schemas the issuer is authorized for.
 * A certification body may be approved for "certification" but not
 * "security-assessment", and vice versa.
 *
 * These are OMA3-recognized third-party issuers whose attestations carry
 * additional trust weight. Attestations from non-approved issuers are still
 * valid on-chain — approval is a trust signal, not a protocol requirement.
 *
 * Note: OMA3-operated internal wallets (relay, admin, controller-witness
 * attesters) are tracked in oma3-ops/oma3-internal-addresses.json and are
 * NOT listed here. This list is for external issuers recognized by OMA3.
 */
const APPROVED_ISSUERS: ApprovedIssuer[] = [
  // No approved third-party issuers yet. Example:
  // {
  //   address: "0x1234...",
  //   label: "Example Security Lab",
  //   schemas: ["security-assessment"],
  // },
];

export async function getPublicTrustAnchors(): Promise<TrustAnchors> {
  return {
    version: TRUST_ANCHORS_VERSION,
    updatedAt: "2026-05-02T00:00:00Z",
    widgetOrigins: [],
    chains: CHAIN_TRUST_ANCHORS,
    registries: APPROVED_ISSUERS.length > 0
      ? [{ type: "approved-issuers", issuers: APPROVED_ISSUERS }]
      : [],
  };
}
