import {
  Contract,
  TypedDataEncoder,
  getAddress,
  hashMessage,
  type TypedDataDomain,
  verifyMessage,
  verifyTypedData
} from "ethers";
import { SiweMessage, generateNonce } from "siwe";
import { getAddressFromDidPkh, getChainIdFromDidPkh, normalizeDid } from "@oma3/omatrust/identity";
import { parseCsv, getEnv } from "@/lib/config/env";
import { getPublicRpcProvider } from "@/lib/config/rpc";
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

type TypedDataField = {
  name: string;
  type: string;
};

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
  const provider = getPublicRpcProvider();
  const checksummedWalletAddress = getAddress(walletAddress);
  const code = await provider.getCode(checksummedWalletAddress);

  if (!code || code === "0x") {
    const recovered = verifyMessage(message, signature);
    if (getAddress(recovered) !== checksummedWalletAddress) {
      throw new ApiError("Invalid signature", 401, "INVALID_SIGNATURE");
    }
    return;
  }

  const contract = new Contract(checksummedWalletAddress, ERC1271_ABI, provider);
  const result = await contract.isValidSignature(hashMessage(message), signature);

  if (String(result).toLowerCase() !== ERC1271_MAGIC_VALUE) {
    throw new ApiError("Invalid signature", 401, "INVALID_SIGNATURE");
  }
}

export async function verifyWalletTypedDataSignature(params: {
  walletAddress: string;
  domain: TypedDataDomain | Record<string, unknown>;
  types: Record<string, Array<TypedDataField>>;
  value: Record<string, unknown>;
  signature: string;
}) {
  const provider = getPublicRpcProvider();
  const checksummedWalletAddress = getAddress(params.walletAddress);
  const code = await provider.getCode(checksummedWalletAddress);

  if (!code || code === "0x") {
    const recovered = verifyTypedData(
      params.domain as TypedDataDomain,
      params.types,
      params.value,
      params.signature
    );

    if (getAddress(recovered) !== checksummedWalletAddress) {
      throw new ApiError("Invalid signature", 401, "INVALID_SIGNATURE");
    }

    return;
  }

  const contract = new Contract(checksummedWalletAddress, ERC1271_ABI, provider);
  const digest = TypedDataEncoder.hash(
    params.domain as TypedDataDomain,
    params.types,
    params.value
  );
  const result = await contract.isValidSignature(digest, params.signature);

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
