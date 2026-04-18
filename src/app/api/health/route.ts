import { withRoute } from "@/lib/routes/with-route";
import { getHealth } from "@/lib/routes/health";

export const runtime = "nodejs";

export const GET = withRoute({
  debugName: "health",
  handler: getHealth
});
