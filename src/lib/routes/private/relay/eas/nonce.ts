import { z } from "zod";
import type { AccountContext } from "@/lib/services/account-service";
import { getRelayNonce } from "@/lib/services/relay-eas-service";

export const relayNonceQuerySchema = z.object({
  attester: z.string().min(1)
});

export async function getRelayEasNonce(
  accountContext: AccountContext,
  query: z.infer<typeof relayNonceQuerySchema>
) {
  return getRelayNonce(accountContext, query.attester);
}
