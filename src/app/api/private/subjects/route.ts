import { withRoute } from "@/lib/routes/with-route";
import {
  createSubjectBodySchema,
  getSubjects,
  postSubjects
} from "@/lib/routes/private/subjects/subjects";

export const runtime = "nodejs";

export const GET = withRoute({
  debugName: "private/subjects:get",
  auth: "session",
  handler: ({ accountContext }) => getSubjects(accountContext!.account.id)
});

export const POST = withRoute({
  debugName: "private/subjects:post",
  auth: "session",
  bodySchema: createSubjectBodySchema,
  handler: ({ accountContext, body }) => postSubjects(accountContext!.account.id, body!)
});
