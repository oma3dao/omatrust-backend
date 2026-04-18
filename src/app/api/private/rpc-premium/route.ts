import { withRoute } from "@/lib/routes/with-route";
import { postPremiumRpc, premiumRpcBodySchema } from "@/lib/routes/private/rpc-premium";

export const runtime = "nodejs";

export const POST = withRoute({
  debugName: "private/rpc-premium:post",
  auth: "session",
  bodySchema: premiumRpcBodySchema,
  handler: ({ accountContext, body }) => postPremiumRpc(accountContext!, body!)
});
