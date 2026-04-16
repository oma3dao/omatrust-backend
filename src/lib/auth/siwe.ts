import { Contract, JsonRpcProvider, getAddress, hashMessage, verifyMessage } from "ethers";
import { SiweMessage, generateNonce } from "siwe";
import { buildEvmDidPkh, getAddressFromDidPkh, getChainIdFromDidPkh, normalizeDid } from "@oma3/omatrust/identity";
import { getEnv, parseCsv } from "@/lib/config/env";
import { ApiError } from "@/lib/errors";

const ERC1271_MAGIC_VALUE = "0x1626ba7e";
const ERC1271_ABI = [
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"
];

export interface CreateChallengeInput {
  walletDid: string;
  chainId: number;
  domain: string;
  uri: string;
}

export interface VerifiedSiwePayload {
  walletDid: string;
  walletAddress: string;
  chainId: number;
  message: SiweMessage;
}

export function assertAllowedSiweDomain(domain: string) {
  const allowed = parseCsv(getEnv().OMATRUST_ALLOWED_SIWE_DOMAINS);
  if (allowed.length === 0) {
    return;
  }

  if (!allowed.includes(domain)) {
    throw new ApiError("Client not allowed for SIWE", 403, "CLIENT_NOT_ALLOWED");
  }
}

export function normalizeWalletDid(walletDid: string) {
  const normalized = normalizeDid(walletDid);
  const address = getAddressFromDidPkh(normalized);
  const chainId = getChainIdFromDidPkh(normalized);

  if (!address || !chainId) {
    throw new ApiError("Invalid did:pkh wallet identifier", 400, "INVALID_DID");
  }

  return {
    walletDid: normalized,
    walletAddress: getAddress(address),
    chainId: Number(chainId)
  };
}

export function buildDefaultWalletDid(chainId: number, address: string) {
  return buildEvmDidPkh(chainId, getAddress(address));
}

export function buildSiweChallengeMessage(input: CreateChallengeInput, nonce: string, expiresAt: Date) {
  assertAllowedSiweDomain(input.domain);

  const normalized = normalizeWalletDid(input.walletDid);

  if (normalized.chainId !== input.chainId) {
    throw new ApiError("Wallet DID chain does not match requested chain", 400, "INVALID_DID");
  }

  const message = new SiweMessage({
    domain: input.domain,
    address: normalized.walletAddress,
    statement: "Sign in to OMATrust",
    uri: input.uri,
    version: "1",
    chainId: input.chainId,
    nonce,
    issuedAt: new Date().toISOString(),
    expirationTime: expiresAt.toISOString()
  });

  return {
    nonce,
    expiresAt,
    siweMessage: message.prepareMessage(),
    walletDid: normalized.walletDid,
    walletAddress: normalized.walletAddress
  };
}

async function verifyWalletMessageSignature(walletAddress: string, message: string, signature: string) {
  const env = getEnv();
  const provider = new JsonRpcProvider(env.OMACHAIN_RPC_URL);
  const code = await provider.getCode(walletAddress);

  if (!code || code === "0x") {
    const recovered = verifyMessage(message, signature);
    if (getAddress(recovered) !== getAddress(walletAddress)) {
      throw new ApiError("Invalid signature", 401, "INVALID_SIGNATURE");
    }
    return;
  }

  const contract = new Contract(walletAddress, ERC1271_ABI, provider);
  const result = await contract.isValidSignature(hashMessage(message), signature);

  if (String(result).toLowerCase() !== ERC1271_MAGIC_VALUE) {
    throw new ApiError("Invalid signature", 401, "INVALID_SIGNATURE");
  }
}

export async function verifySiweMessage(params: {
  walletDid: string;
  expectedDomain: string;
  expectedUri: string;
  expectedNonce: string;
  expectedChainId: number;
  signature: string;
  siweMessage: string;
}) {
  const normalized = normalizeWalletDid(params.walletDid);
  const parsed = new SiweMessage(params.siweMessage);

  if (getAddress(parsed.address) !== normalized.walletAddress) {
    throw new ApiError("Invalid signature", 401, "INVALID_SIGNATURE");
  }

  if (parsed.domain !== params.expectedDomain || parsed.uri !== params.expectedUri) {
    throw new ApiError("Invalid challenge", 400, "INVALID_CHALLENGE");
  }

  if (parsed.nonce !== params.expectedNonce || Number(parsed.chainId) !== params.expectedChainId) {
    throw new ApiError("Invalid challenge", 400, "INVALID_CHALLENGE");
  }

  if (parsed.expirationTime && new Date(parsed.expirationTime) < new Date()) {
    throw new ApiError("Challenge expired", 400, "CHALLENGE_EXPIRED");
  }

  await verifyWalletMessageSignature(normalized.walletAddress, params.siweMessage, params.signature);

  return {
    walletDid: normalized.walletDid,
    walletAddress: normalized.walletAddress,
    chainId: normalized.chainId,
    message: parsed
  } satisfies VerifiedSiwePayload;
}

export function createNonce() {
  return generateNonce();
}
