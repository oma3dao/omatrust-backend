import { errorResponse, ok } from "@/lib/http";
import { handleStripeWebhook } from "@/lib/services/subscription-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const signature = request.headers.get("stripe-signature");
    const rawBody = await request.text();
    const result = await handleStripeWebhook(rawBody, signature);
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
