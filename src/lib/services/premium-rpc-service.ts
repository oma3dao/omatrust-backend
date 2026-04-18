import { z } from "zod";
import { isAddress } from "ethers";
import { getEnv } from "@/lib/config/env";
import { ApiError } from "@/lib/errors";
import type { AccountContext } from "@/lib/services/account-service";
import { assertSubscriptionActive } from "@/lib/services/account-service";
import { consumePremiumReadEntitlement } from "@/lib/services/subscription-service";

const premiumRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string().min(1),
  params: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional()
});

export type PremiumRpcRequest = z.infer<typeof premiumRpcRequestSchema>;

const allowedMethods = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt"
]);

function parseHexBlockNumber(value: string): bigint {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new ApiError("Invalid block tag", 400, "INVALID_RPC_REQUEST");
  }

  return BigInt(value);
}

function normalizeBlockTag(value: unknown): bigint | null {
  if (typeof value !== "string") {
    return null;
  }

  if (["latest", "earliest", "pending", "safe", "finalized"].includes(value)) {
    return null;
  }

  return parseHexBlockNumber(value);
}

function validateEthCall(params: PremiumRpcRequest["params"]) {
  if (!Array.isArray(params) || params.length === 0) {
    throw new ApiError("Invalid eth_call params", 400, "INVALID_RPC_REQUEST");
  }

  const call = params[0];
  if (!call || typeof call !== "object" || Array.isArray(call)) {
    throw new ApiError("Invalid eth_call params", 400, "INVALID_RPC_REQUEST");
  }

  const maybeTo = (call as { to?: unknown }).to;
  if (typeof maybeTo !== "string" || !isAddress(maybeTo)) {
    throw new ApiError("Invalid eth_call target", 400, "INVALID_RPC_REQUEST");
  }
}

function validateEthGetLogs(params: PremiumRpcRequest["params"]) {
  if (!Array.isArray(params) || params.length === 0) {
    throw new ApiError("Invalid eth_getLogs params", 400, "INVALID_RPC_REQUEST");
  }

  const filter = params[0];
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
    throw new ApiError("Invalid eth_getLogs params", 400, "INVALID_RPC_REQUEST");
  }

  const env = getEnv();
  const typedFilter = filter as {
    address?: unknown;
    fromBlock?: unknown;
    toBlock?: unknown;
  };

  if (typedFilter.address != null) {
    if (typeof typedFilter.address === "string") {
      if (!isAddress(typedFilter.address)) {
        throw new ApiError("Invalid eth_getLogs address", 400, "INVALID_RPC_REQUEST");
      }
    } else if (Array.isArray(typedFilter.address)) {
      if (!typedFilter.address.every((entry) => typeof entry === "string" && isAddress(entry))) {
        throw new ApiError("Invalid eth_getLogs address", 400, "INVALID_RPC_REQUEST");
      }
    } else {
      throw new ApiError("Invalid eth_getLogs address", 400, "INVALID_RPC_REQUEST");
    }
  }

  const fromBlock = normalizeBlockTag(typedFilter.fromBlock);
  const toBlock = normalizeBlockTag(typedFilter.toBlock);
  if (fromBlock != null && toBlock != null && toBlock < fromBlock) {
    throw new ApiError("Invalid log block range", 400, "INVALID_RPC_REQUEST");
  }

  if (fromBlock != null && toBlock != null) {
    const span = toBlock - fromBlock;
    if (span > BigInt(env.OMATRUST_PREMIUM_RPC_MAX_LOG_RANGE)) {
      throw new ApiError("Requested log range exceeds premium RPC policy", 403, "RPC_RANGE_TOO_LARGE");
    }
  }
}

function validatePremiumRpcRequest(request: PremiumRpcRequest) {
  const parsed = premiumRpcRequestSchema.parse(request);

  if (!allowedMethods.has(parsed.method)) {
    throw new ApiError("RPC method not allowed on premium endpoint", 403, "RPC_METHOD_NOT_ALLOWED");
  }

  if (parsed.method === "eth_call") {
    validateEthCall(parsed.params);
  }

  if (parsed.method === "eth_getLogs") {
    validateEthGetLogs(parsed.params);
  }

  return parsed;
}

export async function forwardPremiumRpcRequest(accountContext: AccountContext, request: PremiumRpcRequest) {
  assertSubscriptionActive(accountContext.subscriptionState);
  const validatedRequest = validatePremiumRpcRequest(request);

  const upstreamResponse = await fetch(getEnv().OMATRUST_PREMIUM_RPC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(validatedRequest)
  }).catch(() => {
    throw new ApiError("Premium RPC request failed", 502, "PREMIUM_RPC_FAILED");
  });

  const responseText = await upstreamResponse.text();
  if (!upstreamResponse.ok) {
    throw new ApiError("Premium RPC request failed", 502, "PREMIUM_RPC_FAILED");
  }

  await consumePremiumReadEntitlement(accountContext.subscriptionState);

  return new Response(responseText, {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}
