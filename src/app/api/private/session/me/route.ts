import { withRoute } from "@/lib/routes/with-route";
import { getSessionMe } from "@/lib/routes/private/session/me";

export const runtime = "nodejs";

export const GET = withRoute({
  debugName: "private/session/me",
  auth: "session",
  handler: ({ accountContext }) => getSessionMe(accountContext!)
});
