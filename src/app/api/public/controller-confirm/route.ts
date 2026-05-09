import { withRoute } from "@/lib/routes/with-route";
import {
  getPublicServiceControllerSummary,
  serviceControllerSummaryQuerySchema
} from "@/lib/routes/public/controller-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRoute({
  auth: "none",
  querySchema: serviceControllerSummaryQuerySchema,
  debugName: "public.controller-confirm",
  handler: ({ query }) => getPublicServiceControllerSummary(query!)
});
