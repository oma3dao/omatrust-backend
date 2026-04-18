import { withRoute } from "@/lib/routes/with-route";
import {
  getSubjectById,
  subjectIdParamsSchema
} from "@/lib/routes/private/subjects/subject-id";

export const runtime = "nodejs";

export const GET = withRoute({
  debugName: "private/subjects/[subjectId]",
  auth: "session",
  paramsSchema: subjectIdParamsSchema,
  handler: ({ accountContext, params }) => getSubjectById(accountContext!.account.id, params!)
});
