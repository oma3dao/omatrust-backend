import { withRoute } from "@/lib/routes/with-route";
import {
  postVerifySubjectOwnership,
  verifySubjectOwnershipBodySchema
} from "@/lib/routes/verify/subject-ownership";

export const runtime = "nodejs";

export const POST = withRoute({
  auth: "none",
  bodySchema: verifySubjectOwnershipBodySchema,
  debugName: "verify.subject-ownership",
  handler: ({ body }) => postVerifySubjectOwnership(body!)
});
