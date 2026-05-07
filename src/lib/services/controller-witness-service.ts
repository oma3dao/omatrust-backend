/**
 * Controller Witness Service
 *
 * Submits controller witness attestations on behalf of authenticated users.
 * The OMA3 server wallet acts as the trusted third-party attester.
 *
 * Flow:
 * 1. Validate session and subscription (write quota)
 * 2. Verify chain is approved
 * 3. Discover endpoint evidence (DNS TXT, DID.json) for the subject/controller pair
 * 4. Submit controller witness attestation via server wallet
 * 5. Deduct a sponsored write
 */

import { SchemaEncoder } from "@ethereum-attestation-service/eas-sdk";
import { Contract } from "ethers";
import { normalizeDid, getDomainFromDidWeb } from "@oma3/omatrust/identity";
import { getActiveChain, getEnv } from "@/lib/config/env";
import { getPremiumRpcProvider } from "@/lib/config/rpc";
import { ApiError } from "@/lib/errors";
import type { AccountContext } from "@/lib/services/account-service";
import { assertSubscriptionActive } from "@/lib/services/account-service";
import { assertWalletUsesSubscriptionExecution } from "@/lib/services/wallet-execution-mode";
import { isSchemaAllowedForPlan } from "@/lib/policy/sponsor-policy";
import { getSupabaseAdmin } from "@/lib/db/admin";
import { assertSupabase } from "@/lib/db/utils";
import { getThirdwebManagedWallet, loadEasDelegatePrivateKey } from "@/lib/services/eas-delegate-key";
import { getServiceControllerSummary } from "@/lib/services/service-controller-service";
import { getPublicTrustAnchors } from "@/lib/routes/public/trust-anchors";
import { createThirdwebClient, getContract, prepareContractCall, defineChain, waitForReceipt, Engine } from "thirdweb";

const ZERO_UID = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ATTESTED_EVENT_TOPIC = "0x8bf46bf4cfd674fa735a3d63ec1c9ad4153f033c290341f3a588b75685141b35";

const EAS_ATTEST_ABI = [
  "function attest((bytes32 schema, (address recipient, uint64 expirationTime, bool revocable, bytes32 refUID, bytes data, uint256 value) data) request) payable returns (bytes32)"
];

export interface ControllerWitnessParams {
  accountContext: AccountContext;
  subjectDid: string;
  controllerDid: string;
}

export interface ControllerWitnessResult {
  success: boolean;
  uid: string | null;
  txHash: string;
  blockNumber: number;
  observedAt: number;
  method: string;
}

export async function submitControllerWitness(
  params: ControllerWitnessParams
): Promise<ControllerWitnessResult> {
  const { accountContext, subjectDid, controllerDid } = params;
  const chain = getActiveChain();
  const env = getEnv();

  // --- Step 1: Subscription and quota checks ---
  assertSubscriptionActive(accountContext.subscriptionState);

  if (
    accountContext.subscriptionState.sponsored_writes_used_current_year >=
    accountContext.subscriptionState.annual_sponsored_write_limit
  ) {
    throw new ApiError("Sponsored write limit exceeded", 403, "SPONSORED_WRITE_LIMIT_EXCEEDED");
  }

  // Verify the requesting wallet uses subscription execution
  const requestingWallet = accountContext.wallets[0];
  if (requestingWallet) {
    assertWalletUsesSubscriptionExecution(requestingWallet);
  }

  // --- Step 2: Verify chain has controller-witness schema deployed ---
  const trustAnchors = await getPublicTrustAnchors();
  const chainAnchors = trustAnchors.chains[String(chain.id)];
  if (!chainAnchors) {
    throw new ApiError(`Chain ${chain.id} not configured in trust anchors`, 500, "CHAIN_NOT_CONFIGURED");
  }

  const controllerWitnessSchemaUid = chainAnchors.schemas["controller-witness"];
  if (!controllerWitnessSchemaUid) {
    throw new ApiError("Controller witness schema not deployed on this chain", 500, "SCHEMA_NOT_DEPLOYED");
  }

  if (!isSchemaAllowedForPlan(accountContext.subscriptionState.plan, controllerWitnessSchemaUid)) {
    throw new ApiError("Controller witness schema not eligible for your plan", 403, "SCHEMA_NOT_ELIGIBLE");
  }

  // --- Step 3: Verify endpoint evidence ---
  let normalizedSubject: string;
  try {
    normalizedSubject = normalizeDid(subjectDid);
  } catch {
    throw new ApiError("Invalid subjectDid", 400, "INVALID_DID");
  }

  let normalizedController: string;
  try {
    normalizedController = normalizeDid(controllerDid);
  } catch {
    throw new ApiError("Invalid controllerDid", 400, "INVALID_DID");
  }

  const domain = getDomainFromDidWeb(normalizedSubject);
  if (!domain) {
    throw new ApiError(
      "Controller witness currently requires a did:web subject for endpoint evidence discovery",
      400,
      "UNSUPPORTED_SUBJECT_TYPE"
    );
  }

  // Use the service-controller-service to discover evidence
  const summary = await getServiceControllerSummary({
    subjectDid: normalizedSubject,
    walletDid: normalizedController,
    includeAccountWallet: false,
    includeApprovedIssuer: false,
  });

  // Check if the controller was found in endpoint evidence
  const controllerKey = summary.controllerKeys.find(
    (key) => key.canonicalId.toLowerCase() === normalizedController.toLowerCase() && key.basic
  );

  if (!controllerKey) {
    const evidenceSummary = summary.evidence
      .map((e) => `${e.kind}: ${e.status}`)
      .join(", ");
    throw new ApiError(
      `Controller ${normalizedController} not confirmed by endpoint evidence for ${normalizedSubject}. Evidence checked: ${evidenceSummary}`,
      422,
      "EVIDENCE_NOT_FOUND"
    );
  }

  const method = controllerKey.sources[0] ?? "unknown";

  // --- Step 4: Submit controller witness attestation ---
  const observedAt = Math.floor(Date.now() / 1000);
  const easSchemaString = "string subject, string controller, string method, uint256 observedAt";

  const encoder = new SchemaEncoder(easSchemaString);
  const encodedData = encoder.encodeData([
    { name: "subject", value: normalizedSubject, type: "string" },
    { name: "controller", value: normalizedController, type: "string" },
    { name: "method", value: method, type: "string" },
    { name: "observedAt", value: BigInt(observedAt), type: "uint256" },
  ]);

  // Derive the DID Address for the subject — used as the EAS recipient for on-chain indexing.
  // DID Address = truncated keccak256 of the canonical DID (not a real wallet address).
  let recipient: string;
  try {
    const { didToAddress } = await import("@oma3/omatrust/identity");
    recipient = didToAddress(normalizedSubject);
  } catch {
    recipient = "0x0000000000000000000000000000000000000000";
  }

  const attestationRequest = {
    schema: controllerWitnessSchemaUid,
    data: {
      recipient,
      expirationTime: 0n,
      revocable: false,
      refUID: ZERO_UID,
      data: encodedData,
      value: 0n,
    },
  };

  let txHash: string;
  let blockNumber: number;
  let uid: string | null = null;

  const managedWallet = getThirdwebManagedWallet();

  if (managedWallet) {
    console.log(`[controller-witness] Using Thirdweb server wallet: ${managedWallet.walletAddress}`);

    const client = createThirdwebClient({ secretKey: managedWallet.secretKey });
    const thirdwebChain = defineChain({ id: chain.id, rpc: chain.rpc });
    const easContract = getContract({ client, chain: thirdwebChain, address: chain.contracts.easContract });

    const serverWallet = Engine.serverWallet({
      client,
      address: managedWallet.walletAddress,
      executionOptions: { type: "EOA", from: managedWallet.walletAddress },
    });

    const transaction = prepareContractCall({
      contract: easContract,
      method: EAS_ATTEST_ABI[0],
      params: [attestationRequest as any],
      gas: BigInt(env.OMATRUST_MAX_GAS_PER_TX),
    });

    const { transactionId } = await serverWallet.enqueueTransaction({ transaction });
    console.log(`[controller-witness] Enqueued transaction: ${transactionId}`);

    const txResult = await Engine.waitForTransactionHash({ client, transactionId });
    console.log(`[controller-witness] Transaction sent: ${txResult.transactionHash}`);

    const receipt = await waitForReceipt({
      client,
      chain: thirdwebChain,
      transactionHash: txResult.transactionHash,
    });

    txHash = receipt.transactionHash;
    blockNumber = Number(receipt.blockNumber);

    for (const log of receipt.logs as Array<{ topics: readonly string[]; data: string }>) {
      if (log.topics[0] === ATTESTED_EVENT_TOPIC) {
        uid = log.data.slice(0, 66);
        break;
      }
    }
  } else {
    console.log("[controller-witness] Using private key fallback");

    let privateKey: `0x${string}`;
    try {
      privateKey = loadEasDelegatePrivateKey();
    } catch {
      throw new ApiError("Server wallet not configured", 500, "SERVER_ERROR");
    }

    const { Wallet: EthersWallet } = await import("ethers");
    const provider = getPremiumRpcProvider();
    const wallet = new EthersWallet(privateKey, provider);

    const eas = new Contract(chain.contracts.easContract, EAS_ATTEST_ABI, wallet);

    const tx = await eas.attest(attestationRequest, {
      gasLimit: env.OMATRUST_MAX_GAS_PER_TX,
    });
    const receipt = await tx.wait();

    txHash = receipt.hash;
    blockNumber = receipt.blockNumber;

    for (const log of receipt.logs as Array<{ topics: readonly string[]; data: string }>) {
      if (log.topics[0] === ATTESTED_EVENT_TOPIC) {
        uid = log.data.slice(0, 66);
        break;
      }
    }
  }

  // --- Step 5: Deduct sponsored write ---
  const supabase = getSupabaseAdmin();
  const update = await supabase
    .from("subscription_state")
    .update({
      sponsored_writes_used_current_year:
        accountContext.subscriptionState.sponsored_writes_used_current_year + 1,
    })
    .eq("id", accountContext.subscriptionState.id);

  assertSupabase(true, update.error, "Failed to increment sponsored write usage");

  console.log(`[controller-witness] Attestation submitted: ${uid ?? "unknown"} (tx: ${txHash})`);

  return {
    success: true,
    uid,
    txHash,
    blockNumber,
    observedAt,
    method,
  };
}
