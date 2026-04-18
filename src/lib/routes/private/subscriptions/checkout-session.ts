import { z } from "zod";
import type { AccountContext } from "@/lib/services/account-service";
import { createPaidCheckoutSession } from "@/lib/services/subscription-service";

export const checkoutSessionBodySchema = z.object({
  plan: z.literal("paid"),
  successUrl: z.string().url(),
  cancelUrl: z.string().url()
});

export async function postCheckoutSession(
  accountContext: AccountContext,
  body: z.infer<typeof checkoutSessionBodySchema>
) {
  return createPaidCheckoutSession({
    account: accountContext.account,
    successUrl: body.successUrl,
    cancelUrl: body.cancelUrl
  });
}
