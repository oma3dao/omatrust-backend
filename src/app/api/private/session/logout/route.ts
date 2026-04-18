import { withRoute } from "@/lib/routes/with-route";
import { postSessionLogout } from "@/lib/routes/private/session/logout";

export const runtime = "nodejs";

export const POST = withRoute({
  debugName: "private/session/logout",
  handler: async ({ request }) => postSessionLogout(request)
});
