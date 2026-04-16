import { z } from "zod";
import { errorResponse, ok, parseJson } from "@/lib/http";
import { getAuthenticatedAccountContext } from "@/lib/services/session-service";
import { createPaidCheckoutSession } from "@/lib/services/subscription-service";
import { ApiError } from "@/lib/errors";

export const runtime = "nodejs";

const checkoutSchema = z.object({
  plan: z.literal("paid"),
  successUrl: z.string().url(),
  cancelUrl: z.string().url()
});

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedAccountContext(request);
    const body = checkoutSchema.parse(await parseJson(request));

    if (body.plan !== "paid") {
      throw new ApiError("Invalid plan", 400, "INVALID_PLAN");
    }

    const result = await createPaidCheckoutSession({
      account: context.account,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl
    });

    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
