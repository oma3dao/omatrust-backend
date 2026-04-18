import { withRoute } from "@/lib/routes/with-route";
import {
  checkoutSessionBodySchema,
  postCheckoutSession
} from "@/lib/routes/private/subscriptions/checkout-session";

export const runtime = "nodejs";

export const POST = withRoute({
  debugName: "private/subscriptions/checkout-session",
  auth: "session",
  bodySchema: checkoutSessionBodySchema,
  handler: ({ accountContext, body }) => postCheckoutSession(accountContext!, body!)
});
