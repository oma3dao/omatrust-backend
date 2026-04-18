import { withRoute } from "@/lib/routes/with-route";
import { postStripeWebhook } from "@/lib/routes/private/subscriptions/stripe-webhook";

export const runtime = "nodejs";

export const POST = withRoute({
  debugName: "private/subscriptions/stripe-webhook",
  bodyMode: "text",
  handler: async ({ request, body }) => postStripeWebhook(request, body ?? "")
});
