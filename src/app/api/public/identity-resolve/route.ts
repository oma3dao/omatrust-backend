import { withRoute } from "@/lib/routes/with-route";
import { identityResolveBodySchema, postIdentityResolve } from "@/lib/routes/public/identity-resolve";

export const runtime = "nodejs";

export const POST = withRoute({
  auth: "none",
  bodySchema: identityResolveBodySchema,
  debugName: "public.identity-resolve",
  handler: ({ body }) => postIdentityResolve(body!)
});
