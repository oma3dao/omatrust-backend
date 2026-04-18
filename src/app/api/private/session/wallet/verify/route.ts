import { withRoute } from "@/lib/routes/with-route";
import {
  postSessionVerify,
  sessionVerifyBodySchema
} from "@/lib/routes/private/session/wallet/verify";

export const runtime = "nodejs";

export const POST = withRoute({
  debugName: "private/session/wallet/verify",
  bodySchema: sessionVerifyBodySchema,
  handler: ({ body }) => postSessionVerify(body!)
});
