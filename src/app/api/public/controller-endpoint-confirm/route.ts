import { withRoute } from "@/lib/routes/with-route";
import {
  controllerEndpointConfirmQuerySchema,
  getPublicControllerEndpointConfirmation
} from "@/lib/routes/public/controller-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRoute({
  auth: "none",
  querySchema: controllerEndpointConfirmQuerySchema,
  debugName: "public.controller-endpoint-confirm",
  handler: ({ query }) => getPublicControllerEndpointConfirmation(query!)
});
