import { handleStripeWebhook } from "@/lib/services/subscription-service";

export async function postStripeWebhook(request: Request, rawBody: string) {
  const signature = request.headers.get("stripe-signature");
  return handleStripeWebhook(rawBody, signature);
}
