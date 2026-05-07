import { getEnv } from "@/lib/config/env";

const OMACHAIN_TESTNET_CHAIN_ID = "eip155:66238";

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
 * Approved issuers (production).
 *
 * These are trusted on ALL environments including mainnet.
 * Each entry specifies which attestation schemas the issuer is authorized for.
 *
 * Attestations from non-approved issuers are still valid on-chain —
 * approval is a trust signal, not a protocol requirement.
 */
const APPROVED_ISSUERS: ApprovedIssuer[] = [
  // --- OMA3 mainnet wallets: controller-witness only ---
  {
    address: "0x96fa5ab5E519641bD8A840A6b26D17DB7497618b",
    label: "OMA3 Mainnet Attestation Wallet",
    schemas: ["controller-witness"],
  },
  // --- Third-party issuers: certification / security-assessment ---
  // {
  //   address: "0x...",
  //   label: "Example Security Lab",
  //   schemas: ["security-assessment"],
  // },
  // {
  //   address: "0x...",
  //   label: "Example Certification Body",
  //   schemas: ["certification"],
  // },
];

/**
 * Approved test issuers (testnet / devnet only).
 *
 * These are ONLY included when OMATRUST_ACTIVE_CHAIN is not omachain-mainnet.
 * They allow testnet wallets to appear as trusted attesters during development
 * without polluting the mainnet trust set.
 */
const APPROVED_TEST_ISSUERS: ApprovedIssuer[] = [
  {
    address: "0x6f05D46cD048d3249F4Db6BAd6d06e2069BCD5eb",
    label: "OMA3 Testnet Attestation Wallet",
    schemas: ["controller-witness"],
  },
  {
    address: "0x7D5beD223Bc343F114Aa28961Cc447dbbc9c2330",
    label: "OMA3 Legacy Testnet Issuer",
    schemas: ["controller-witness"],
  },
  {
    address: "0x766910dc543034ce7a6525c1307c5b6fe92ebb0b",
    label: "OMA3 Legacy Testnet Issuer",
    schemas: ["controller-witness"],
  },
];

function getEffectiveIssuers(): ApprovedIssuer[] {
  const env = getEnv();
  const isMainnet = env.OMATRUST_ACTIVE_CHAIN === "omachain-mainnet";

  if (isMainnet) {
    return APPROVED_ISSUERS;
  }

  return [...APPROVED_ISSUERS, ...APPROVED_TEST_ISSUERS];
}

export async function getPublicTrustAnchors(): Promise<TrustAnchors> {
  const issuers = getEffectiveIssuers();

  return {
    version: TRUST_ANCHORS_VERSION,
    updatedAt: "2026-05-04T00:00:00Z",
    widgetOrigins: [],
    chains: CHAIN_TRUST_ANCHORS,
    registries: issuers.length > 0
      ? [{ type: "approved-issuers", issuers }]
      : [],
  };
}
