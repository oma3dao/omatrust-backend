import { withRoute } from "@/lib/routes/with-route";
import {
  postSessionRegister,
  sessionRegisterBodySchema
} from "@/lib/routes/private/session/wallet/register";

export const runtime = "nodejs";

export const POST = withRoute({
  debugName: "private/session/wallet/register",
  bodySchema: sessionRegisterBodySchema,
  handler: ({ body }) => postSessionRegister(body!)
});
