import { withRoute } from "@/lib/routes/with-route";
import { getSubscriptionsCurrent } from "@/lib/routes/private/subscriptions/current";

export const runtime = "nodejs";

export const GET = withRoute({
  debugName: "private/subscriptions/current",
  auth: "session",
  handler: ({ accountContext }) => getSubscriptionsCurrent(accountContext!)
});
