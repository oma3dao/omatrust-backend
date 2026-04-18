import { z } from "zod";
import type { AccountContext } from "@/lib/services/account-service";
import { forwardPremiumRpcRequest } from "@/lib/services/premium-rpc-service";

export const premiumRpcBodySchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string().min(1),
  params: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional()
});

export async function postPremiumRpc(
  accountContext: AccountContext,
  body: z.infer<typeof premiumRpcBodySchema>
) {
  return forwardPremiumRpcRequest(accountContext, body);
}
