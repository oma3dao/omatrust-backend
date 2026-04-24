import dns from "node:dns";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { JsonRpcProvider } from "ethers";
import {
  extractDidMethod,
  getChainIdFromDidPkh,
  normalizeDid
} from "@oma3/omatrust/identity";
import type {
  EvmOwnershipProvider,
  SubjectOwnershipVerificationResult as SdkSubjectOwnershipVerificationResult
} from "@oma3/omatrust/reputation";
import { getActiveChain } from "@/lib/config/env";
import { ApiError } from "@/lib/errors";
import logger from "@/lib/logger";

const require = createRequire(import.meta.url);
const reputationSdk = require("@oma3/omatrust/reputation") as typeof import("@oma3/omatrust/reputation");
const resolveTxt = promisify(dns.resolveTxt);

export type SubjectOwnershipVerificationMethod =
  | "dns"
  | "did-document"
  | "wallet"
  | "contract"
  | "minting-wallet"
  | "transfer";

export interface SubjectOwnershipVerificationResult {
  ok: boolean;
  status: "verified" | "failed";
  subjectDid: string;
  connectedWalletDid: string;
  method?: SubjectOwnershipVerificationMethod;
  error?: string;
  details?: string;
  controllingWalletDid?: string;
}

interface VerifySubjectOwnershipParams {
  subjectDid: string;
  connectedWalletDid: string;
  txHash?: string | null;
}

interface VerifySubjectOwnershipDeps {
  provider?: EvmOwnershipProvider;
  resolveTxt?: (host: string) => Promise<string[][]>;
  fetchDidDocument?: (domain: string) => Promise<Record<string, unknown>>;
}

function buildProviderForSubjectDid(subjectDid: string): EvmOwnershipProvider {
  const chainIdRaw = getChainIdFromDidPkh(subjectDid);
  const activeChain = getActiveChain();

  if (!chainIdRaw) {
    throw new ApiError("Could not determine chain from subjectDid", 400, "INVALID_DID");
  }

  const chainId = Number(chainIdRaw);
  if (!Number.isFinite(chainId)) {
    throw new ApiError("Invalid chain id in subjectDid", 400, "INVALID_DID");
  }

  if (chainId !== activeChain.chainId) {
    throw new ApiError(
      `did:pkh verification currently supports only the configured active chain (${activeChain.chainId})`,
      400,
      "UNSUPPORTED_CHAIN"
    );
  }

  return new JsonRpcProvider(activeChain.rpc);
}

function toHttpResult(
  result: SdkSubjectOwnershipVerificationResult
): SubjectOwnershipVerificationResult {
  return {
    ok: result.valid,
    status: result.valid ? "verified" : "failed",
    subjectDid: result.subjectDid,
    connectedWalletDid: result.connectedWalletDid,
    method: result.method,
    error: result.valid ? undefined : result.reason ?? "Subject ownership verification failed",
    details: result.details,
    controllingWalletDid: result.controllingWalletDid
  };
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? error.code : "INTERNAL_ERROR";

    if (code === "NETWORK_ERROR") {
      return new ApiError(error.message, 502, "NETWORK_ERROR");
    }

    if (code === "UNSUPPORTED_CHAIN") {
      return new ApiError(error.message, 400, "UNSUPPORTED_CHAIN");
    }

    if (code === "INVALID_INPUT" || code === "INVALID_DID") {
      return new ApiError(error.message, 400, "INVALID_DID");
    }

    return new ApiError(error.message, 500, "INTERNAL_ERROR");
  }

  return new ApiError("Internal error", 500, "INTERNAL_ERROR");
}

export async function verifySubjectOwnership(
  params: VerifySubjectOwnershipParams,
  deps: VerifySubjectOwnershipDeps = {}
): Promise<SubjectOwnershipVerificationResult> {
  try {
    const subjectDid = normalizeDid(params.subjectDid);
    const connectedWalletDid = normalizeDid(params.connectedWalletDid);
    const method = extractDidMethod(subjectDid);

    if (method === "web") {
      const result = await reputationSdk.verifyDidWebOwnership({
        subjectDid,
        connectedWalletDid,
        resolveTxt: deps.resolveTxt ?? resolveTxt,
        fetchDidDocument: deps.fetchDidDocument
      });
      return toHttpResult(result);
    }

    if (method === "pkh") {
      const result = await reputationSdk.verifyDidPkhOwnership({
        subjectDid,
        connectedWalletDid,
        provider: deps.provider ?? buildProviderForSubjectDid(subjectDid),
        txHash: params.txHash ?? undefined
      });
      return toHttpResult(result);
    }

    throw new ApiError("Unsupported DID type for ownership verification", 400, "INVALID_DID");
  } catch (error) {
    if (error instanceof ApiError && error.statusCode >= 500) {
      logger.error("[verify.subject-ownership] internal failure", {
        subjectDid: params.subjectDid,
        connectedWalletDid: params.connectedWalletDid,
        code: error.code,
        error: error.message,
        details: error.details
      })
    }

    throw toApiError(error);
  }
}
