import { Contract, Wallet, isAddress, keccak256, toUtf8Bytes } from "ethers";
import { splitSignature, buildDelegatedTypedDataFromEncoded, type Hex, type PrepareDelegatedAttestationResult } from "@oma3/omatrust/reputation";
import { getActiveChain, getEnv } from "@/lib/config/env";
import { getPremiumRpcProvider } from "@/lib/config/rpc";
import { ApiError } from "@/lib/errors";
import type { AccountContext } from "@/lib/services/account-service";
import { assertSubscriptionActive } from "@/lib/services/account-service";
import { consumePremiumReadEntitlement } from "@/lib/services/subscription-service";
import { isSchemaAllowedForPlan } from "@/lib/policy/sponsor-policy";
import { getSupabaseAdmin } from "@/lib/db/admin";
import { assertSupabase } from "@/lib/db/utils";
import type { DelegatedTypedDataMessage } from "@/lib/routes/private/relay/eas/delegated-attest-schema";
import { loadEasDelegatePrivateKey, getThirdwebManagedWallet } from "@/lib/services/eas-delegate-key";
import { verifyWalletTypedDataSignature } from "@/lib/auth/siwe";
import { assertWalletUsesSubscriptionExecution } from "@/lib/services/wallet-execution-mode";
import { createThirdwebClient, getContract, prepareContractCall, defineChain, waitForReceipt, Engine } from "thirdweb";

const EAS_READ_ABI = [
  "function getNonce(address account) view returns (uint256)",
  "function getSchemaRegistry() view returns (address)"
];
const EAS_WRITE_ABI = [
  {
    inputs: [
      {
        components: [
          { name: "schema", type: "bytes32" },
          {
            components: [
              { name: "recipient", type: "address" },
              { name: "expirationTime", type: "uint64" },
              { name: "revocable", type: "bool" },
              { name: "refUID", type: "bytes32" },
              { name: "data", type: "bytes" },
              { name: "value", type: "uint256" }
            ],
            name: "data",
            type: "tuple"
          },
          {
            components: [
              { name: "v", type: "uint8" },
              { name: "r", type: "bytes32" },
              { name: "s", type: "bytes32" }
            ],
            name: "signature",
            type: "tuple"
          },
          { name: "attester", type: "address" },
          { name: "deadline", type: "uint64" }
        ],
        name: "delegatedRequest",
        type: "tuple"
      }
    ],
    name: "attestByDelegation",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "payable",
    type: "function"
  }
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
  return getPremiumRpcProvider();
}

function isMainnet() {
  return getActiveChain().key === "omachain-mainnet";
}

export async function getRelayNonce(accountContext: AccountContext, attester: string) {
  const chain = getActiveChain();

  if (!isAddress(attester)) {
    throw new ApiError("Invalid attester address format", 400, "INVALID_INPUT");
  }

  const attesterWallet = accountContext.wallets.find(
    (wallet) => wallet.wallet_address.toLowerCase() === attester.toLowerCase()
  );

  if (!attesterWallet) {
    throw new ApiError("Attester mismatch", 403, "ATTESTER_MISMATCH");
  }

  assertWalletUsesSubscriptionExecution(attesterWallet);

  assertSubscriptionActive(accountContext.subscriptionState);

  const contract = new Contract(chain.contracts.easContract, EAS_READ_ABI, getProvider());

  try {
    const nonce = await contract.getNonce(attester);
    await consumePremiumReadEntitlement(accountContext.subscriptionState);
    return {
      nonce: nonce.toString(),
      chainId: chain.chainId,
      chain: chain.name,
      easAddress: chain.contracts.easContract
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
  const chain = getActiveChain();
  const attester = params.attester;
  const provider = getProvider();
  const maxGas = env.OMATRUST_MAX_GAS_PER_TX;

  if (!isAddress(attester)) {
    throw new ApiError("Invalid attester address format", 400, "INVALID_INPUT");
  }

  const attesterWallet = params.accountContext.wallets.find(
    (wallet) => wallet.wallet_address.toLowerCase() === attester.toLowerCase()
  );
  if (!attesterWallet) {
    throw new ApiError("Attester mismatch", 403, "ATTESTER_MISMATCH");
  }

  assertWalletUsesSubscriptionExecution(attesterWallet);

  assertSubscriptionActive(params.accountContext.subscriptionState);

  if (
    params.accountContext.subscriptionState.sponsored_writes_used_current_year >=
    params.accountContext.subscriptionState.annual_sponsored_write_limit
  ) {
    throw new ApiError("Sponsored write limit exceeded", 403, "SPONSORED_WRITE_LIMIT_EXCEEDED");
  }

  const delegatedRequest = params.prepared.delegatedRequest;
  const typedDataMessage = params.prepared.typedData.message as DelegatedTypedDataMessage;

  console.log(`[relay/eas/delegated-attest] Active chain: ${chain.name} (${chain.id})`);

  const schemaUid = (delegatedRequest.schema as string | undefined) ?? typedDataMessage.schema;
  if (!schemaUid) {
    throw new ApiError("Missing schema UID", 400, "INVALID_INPUT");
  }

  if (!isSchemaAllowedForPlan(params.accountContext.subscriptionState.plan, schemaUid)) {
    throw new ApiError("Schema not eligible", 403, "SCHEMA_NOT_ELIGIBLE");
  }

  // Subject-scoped authorization still needs a backend-readable subject hint in the
  // request payload before V1 can mirror the full onchain key-binding check here.

  const deadline = Number(typedDataMessage.deadline);
  if (deadline < Math.floor(Date.now() / 1000)) {
    throw new ApiError("Signature expired", 400, "SIGNATURE_EXPIRED");
  }

  const easRead = new Contract(chain.contracts.easContract, EAS_READ_ABI, provider);
  let nonce: bigint;
  try {
    nonce = await easRead.getNonce(attester);
  } catch (error) {
    console.error("[relay/eas/delegated-attest] failed to fetch nonce", error);
    throw new ApiError("Nonce lookup failed", 502, "NONCE_LOOKUP_FAILED");
  }

  try {
    const schemaRegistryAddr = await easRead.getSchemaRegistry();
    console.log(`[relay/eas/delegated-attest] Schema Registry: ${schemaRegistryAddr}`);

    const schemaRegistry = new Contract(
      schemaRegistryAddr,
      ["function getSchema(bytes32 uid) view returns (tuple(bytes32 uid, address resolver, bool revocable, string schema))"],
      provider
    );
    const schemaRecord = await schemaRegistry.getSchema(schemaUid);
    console.log("[relay/eas/delegated-attest] Schema record:", {
      uid: schemaRecord.uid,
      resolver: schemaRecord.resolver,
      revocable: schemaRecord.revocable,
      schema: schemaRecord.schema
    });
  } catch (schemaError: any) {
    console.error("[relay/eas/delegated-attest] Schema lookup failed:", schemaError?.message);
  }

  const typedData = buildDelegatedTypedDataFromEncoded({
    chainId: chain.chainId,
    easContractAddress: chain.contracts.easContract as Hex,
    schemaUid: schemaUid as Hex,
    encodedData: typedDataMessage.data as Hex,
    recipient: typedDataMessage.recipient as Hex,
    attester: attester as Hex,
    nonce,
    revocable: typedDataMessage.revocable,
    expirationTime:
      typedDataMessage.expirationTime != null ? BigInt(typedDataMessage.expirationTime) : undefined,
    refUid: typedDataMessage.refUID as Hex | undefined,
    value: typedDataMessage.value != null ? BigInt(typedDataMessage.value) : undefined,
    deadline: BigInt(deadline)
  });

  try {
    await verifyWalletTypedDataSignature({
      walletAddress: attester,
      domain: typedData.domain as Record<string, unknown>,
      types: typedData.types as Record<string, Array<{ name: string; type: string }>>,
      value: typedData.message as Record<string, unknown>,
      signature: params.signature
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError("Invalid signature", 400, "INVALID_SIGNATURE");
  }

  cleanupProcessedSignatures();
  const signatureHash = keccak256(toUtf8Bytes(params.signature));
  if (processedSignatures.has(signatureHash)) {
    throw new ApiError("Duplicate submission", 409, "DUPLICATE");
  }
  processedSignatures.set(signatureHash, Date.now());

  if (isMainnet()) {
    throw new ApiError("Mainnet delegated attestations not yet available", 501, "MAINNET_NOT_SUPPORTED");
  }

  const { v, r, s } = splitSignature(params.signature);
  const builtMessage = typedData.message as DelegatedTypedDataMessage;
  const request = {
    schema: schemaUid,
    data: {
      recipient: builtMessage.recipient,
      expirationTime: BigInt(builtMessage.expirationTime),
      revocable: builtMessage.revocable,
      refUID: builtMessage.refUID,
      data: builtMessage.data,
      value: BigInt(builtMessage.value)
    },
    signature: { v, r, s },
    attester,
    deadline: BigInt(deadline)
  };

  console.log(`[relay/eas/delegated-attest] Submitting attestation on ${chain.name}`);
  console.log(`[relay/eas/delegated-attest] EAS Contract address: ${chain.contracts.easContract}`);
  console.log(`[relay/eas/delegated-attest] Attester: ${attester}`);
  console.log(`[relay/eas/delegated-attest] Schema: ${schemaUid}`);

  let txHash: string;
  let blockNumber: number;
  let logs: Array<{ topics: readonly string[]; data: string }>;

  const managedWallet = getThirdwebManagedWallet();

  try {
    if (managedWallet) {
      console.log(`[relay/eas/delegated-attest] Using Thirdweb server wallet: ${managedWallet.walletAddress}`);

      const client = createThirdwebClient({ secretKey: managedWallet.secretKey });
      const thirdwebChain = defineChain({ id: chain.id, rpc: chain.rpc });

      const easContract = getContract({ client, chain: thirdwebChain, address: chain.contracts.easContract });
      const serverWallet = Engine.serverWallet({
        client,
        address: managedWallet.walletAddress,
        executionOptions: { type: "EOA", from: managedWallet.walletAddress }
      });

      const transaction = prepareContractCall({
        contract: easContract,
        method:
          "function attestByDelegation((bytes32 schema, (address recipient, uint64 expirationTime, bool revocable, bytes32 refUID, bytes data, uint256 value) data, (uint8 v, bytes32 r, bytes32 s) signature, address attester, uint64 deadline) delegatedRequest) payable returns (bytes32)",
        params: [request as any],
        gas: BigInt(maxGas)
      });

      const { transactionId } = await serverWallet.enqueueTransaction({ transaction });
      console.log(`[relay/eas/delegated-attest] Enqueued transaction: ${transactionId}`);

      const txResult = await Engine.waitForTransactionHash({ client, transactionId });
      console.log(`[relay/eas/delegated-attest] Transaction sent: ${txResult.transactionHash}`);

      const receipt = await waitForReceipt({
        client,
        chain: thirdwebChain,
        transactionHash: txResult.transactionHash
      });
      console.log(`[relay/eas/delegated-attest] Transaction confirmed in block ${receipt.blockNumber}`);

      txHash = receipt.transactionHash;
      blockNumber = Number(receipt.blockNumber);
      logs = receipt.logs as Array<{ topics: readonly string[]; data: string }>;
    } else {
      console.log("[relay/eas/delegated-attest] Using private key fallback");

      let delegateKey: `0x${string}`;
      try {
        delegateKey = loadEasDelegatePrivateKey();
      } catch (error) {
        console.error("[relay/eas/delegated-attest] Failed to load EAS delegate key:", error);
        throw new ApiError(
          "Server misconfigured - no server wallet or delegate key available",
          500,
          "NO_DELEGATE_KEY"
        );
      }

      const easDelegate = new Wallet(delegateKey, provider);
      const eas = new Contract(chain.contracts.easContract, EAS_WRITE_ABI, easDelegate);
      console.log(`[relay/eas/delegated-attest] EAS Delegate address: ${easDelegate.address}`);

      let gasLimit = maxGas;

      try {
        const gasEstimate = await eas.attestByDelegation.estimateGas(request);
        console.log(`[relay/eas/delegated-attest] Gas estimate: ${gasEstimate}`);
        const estimateWithBuffer = (BigInt(gasEstimate) * BigInt(120)) / BigInt(100);
        const maxLimit = BigInt(1000000);
        gasLimit = Number(estimateWithBuffer < maxLimit ? estimateWithBuffer : maxLimit);
      } catch (estimateError: any) {
        console.error(
          "[relay/eas/delegated-attest] Gas estimation failed:",
          estimateError?.reason || estimateError?.message
        );
      }

      const tx = await eas.attestByDelegation(request, { gasLimit });
      console.log(`[relay/eas/delegated-attest] Transaction sent: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`[relay/eas/delegated-attest] Transaction confirmed in block ${receipt.blockNumber}`);

      txHash = receipt.hash;
      blockNumber = receipt.blockNumber;
      logs = receipt.logs as Array<{ topics: readonly string[]; data: string }>;
    }
  } catch (error) {
    console.error("[relay/eas/delegated-attest] submission failed", error);
    if (error instanceof ApiError) {
      throw error;
    }
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
    .from("subscription_state")
    .update({
      sponsored_writes_used_current_year:
        params.accountContext.subscriptionState.sponsored_writes_used_current_year + 1
    })
    .eq("id", params.accountContext.subscriptionState.id);

  assertSupabase(true, update.error, "Failed to increment sponsored write usage");

  return {
    success: true as const,
    txHash,
    uid,
    blockNumber,
    chain: chain.name
  };
}
