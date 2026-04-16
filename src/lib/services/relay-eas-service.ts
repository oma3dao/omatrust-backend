import { Contract, JsonRpcProvider, Wallet, isAddress, keccak256, toUtf8Bytes, verifyTypedData } from "ethers";
import { splitSignature, buildDelegatedTypedDataFromEncoded, type Hex, type PrepareDelegatedAttestationResult } from "@oma3/omatrust/reputation";
import { getEnv, requireConfigured } from "@/lib/config/env";
import { ApiError } from "@/lib/errors";
import type { AccountContext } from "@/lib/services/account-service";
import { assertSubscriptionActive } from "@/lib/services/account-service";
import { isSchemaAllowedForPlan } from "@/lib/policy/sponsor-policy";
import { getSupabaseAdmin } from "@/lib/db/admin";
import { assertSupabase } from "@/lib/db/utils";

const EAS_READ_ABI = ["function getNonce(address account) view returns (uint256)"];
const EAS_WRITE_ABI = [
  "function attestByDelegation((bytes32 schema, (address recipient, uint64 expirationTime, bool revocable, bytes32 refUID, bytes data, uint256 value) data, (uint8 v, bytes32 r, bytes32 s) signature, address attester, uint64 deadline) delegatedRequest) payable returns (bytes32)"
];

const processedSignatures = new Map<string, number>();

function cleanupProcessedSignatures() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, timestamp] of processedSignatures) {
    if (timestamp < cutoff) {
      processedSignatures.delete(key);
    }
  }
}

function getProvider() {
  return new JsonRpcProvider(getEnv().OMACHAIN_RPC_URL);
}

export async function getRelayNonce(attester: string) {
  const env = getEnv();

  if (!isAddress(attester)) {
    throw new ApiError("Invalid attester address format", 400, "INVALID_INPUT");
  }

  const contract = new Contract(env.OMACHAIN_EAS_ADDRESS, EAS_READ_ABI, getProvider());

  try {
    const nonce = await contract.getNonce(attester);
    return {
      nonce: nonce.toString(),
      chainId: env.OMACHAIN_CHAIN_ID,
      chain: env.OMACHAIN_CHAIN_NAME,
      easAddress: env.OMACHAIN_EAS_ADDRESS
    };
  } catch (error) {
    console.error("[relay/eas/nonce] RPC failure", error);
    throw new ApiError("Nonce lookup failed", 502, "NONCE_LOOKUP_FAILED");
  }
}

export async function submitDelegatedAttestation(params: {
  accountContext: AccountContext;
  attester: string;
  prepared: PrepareDelegatedAttestationResult;
  signature: string;
}) {
  const env = getEnv();
  const attester = params.attester;
  const provider = getProvider();

  if (!isAddress(attester)) {
    throw new ApiError("Invalid attester address format", 400, "INVALID_INPUT");
  }

  const accountWallets = params.accountContext.wallets.map((wallet) => wallet.wallet_address.toLowerCase());
  if (!accountWallets.includes(attester.toLowerCase())) {
    throw new ApiError("Attester mismatch", 403, "ATTESTER_MISMATCH");
  }

  assertSubscriptionActive(params.accountContext.subscription);

  if (
    params.accountContext.subscription.sponsored_writes_used_current_period >=
    params.accountContext.subscription.monthly_sponsored_write_limit
  ) {
    throw new ApiError("Sponsored write limit exceeded", 403, "SPONSORED_WRITE_LIMIT_EXCEEDED");
  }

  const delegatedRequest = params.prepared?.delegatedRequest as Record<string, unknown> | undefined;
  const typedDataMessage = params.prepared?.typedData?.message as Record<string, unknown> | undefined;

  if (!delegatedRequest || !typedDataMessage) {
    throw new ApiError("Missing delegated attestation payload", 400, "INVALID_INPUT");
  }

  const schemaUid = String((delegatedRequest.schema ?? delegatedRequest.schemaUid ?? typedDataMessage.schema) || "");
  if (!schemaUid) {
    throw new ApiError("Missing schema UID", 400, "INVALID_INPUT");
  }

  if (!isSchemaAllowedForPlan(params.accountContext.subscription.plan, schemaUid)) {
    throw new ApiError("Schema not eligible", 403, "SCHEMA_NOT_ELIGIBLE");
  }

  // Subject-scoped authorization still needs a backend-readable subject hint in the
  // request payload before V1 can mirror the full onchain key-binding check here.

  const deadline = Number(typedDataMessage.deadline ?? delegatedRequest.deadline ?? 0);
  if (deadline < Math.floor(Date.now() / 1000)) {
    throw new ApiError("Signature expired", 400, "SIGNATURE_EXPIRED");
  }

  const easRead = new Contract(env.OMACHAIN_EAS_ADDRESS, EAS_READ_ABI, provider);
  let nonce: bigint;
  try {
    nonce = await easRead.getNonce(attester);
  } catch (error) {
    console.error("[relay/eas/delegated-attest] failed to fetch nonce", error);
    throw new ApiError("Nonce lookup failed", 502, "NONCE_LOOKUP_FAILED");
  }

  const typedData = buildDelegatedTypedDataFromEncoded({
    chainId: env.OMACHAIN_CHAIN_ID,
    easContractAddress: env.OMACHAIN_EAS_ADDRESS as Hex,
    schemaUid: schemaUid as Hex,
    encodedData: typedDataMessage.data as Hex,
    recipient: typedDataMessage.recipient as Hex,
    attester: attester as Hex,
    nonce,
    revocable: typedDataMessage.revocable as boolean,
    expirationTime:
      typedDataMessage.expirationTime != null ? BigInt(typedDataMessage.expirationTime as string | number) : undefined,
    refUid: typedDataMessage.refUID as Hex | undefined,
    value: typedDataMessage.value != null ? BigInt(typedDataMessage.value as string | number) : undefined,
    deadline: BigInt(deadline)
  });

  let recovered: string;
  try {
    recovered = verifyTypedData(
      typedData.domain as Record<string, unknown>,
      typedData.types as Record<string, Array<{ name: string; type: string }>>,
      typedData.message,
      params.signature
    );
  } catch {
    throw new ApiError("Invalid signature", 400, "INVALID_SIGNATURE");
  }

  if (recovered.toLowerCase() !== attester.toLowerCase()) {
    throw new ApiError("Attester mismatch", 403, "ATTESTER_MISMATCH");
  }

  cleanupProcessedSignatures();
  const signatureHash = keccak256(toUtf8Bytes(params.signature));
  if (processedSignatures.has(signatureHash)) {
    throw new ApiError("Duplicate submission", 409, "DUPLICATE");
  }
  processedSignatures.set(signatureHash, Date.now());

  const { v, r, s } = splitSignature(params.signature);
  const builtMessage = typedData.message as Record<string, unknown>;
  const request = {
    schema: schemaUid,
    data: {
      recipient: builtMessage.recipient as string,
      expirationTime: BigInt((builtMessage.expirationTime as string | number | bigint | undefined) ?? 0),
      revocable: builtMessage.revocable as boolean,
      refUID: builtMessage.refUID as string,
      data: builtMessage.data as string,
      value: BigInt((builtMessage.value as string | number | bigint | undefined) ?? 0)
    },
    signature: { v, r, s },
    attester,
    deadline: BigInt(deadline)
  };

  const signer = new Wallet(requireConfigured(env.OMATRUST_RELAY_PRIVATE_KEY, "OMATRUST_RELAY_PRIVATE_KEY"), provider);
  const eas = new Contract(env.OMACHAIN_EAS_ADDRESS, EAS_WRITE_ABI, signer);

  let txHash: string;
  let blockNumber: number;
  let logs: Array<{ topics: readonly string[]; data: string }>;

  try {
    const tx = await eas.attestByDelegation(request, {
      gasLimit: env.OMATRUST_MAX_GAS_PER_TX
    });
    const receipt = await tx.wait();
    txHash = receipt.hash;
    blockNumber = receipt.blockNumber;
    logs = receipt.logs as Array<{ topics: readonly string[]; data: string }>;
  } catch (error) {
    console.error("[relay/eas/delegated-attest] submission failed", error);
    throw new ApiError("Relay submission failed", 502, "RELAY_SUBMISSION_FAILED");
  }

  const attestedEventTopic = "0x8bf46bf4cfd674fa735a3d63ec1c9ad4153f033c290341f3a588b75685141b35";
  let uid: string | null = null;
  for (const log of logs) {
    if (log.topics[0] === attestedEventTopic) {
      uid = log.data.slice(0, 66) ?? null;
      break;
    }
  }

  const supabase = getSupabaseAdmin();
  const update = await supabase
    .from("subscriptions")
    .update({
      sponsored_writes_used_current_period:
        params.accountContext.subscription.sponsored_writes_used_current_period + 1
    })
    .eq("id", params.accountContext.subscription.id);

  assertSupabase(true, update.error, "Failed to increment sponsored write usage");

  return {
    success: true as const,
    txHash,
    uid,
    blockNumber,
    chain: env.OMACHAIN_CHAIN_NAME
  };
}
