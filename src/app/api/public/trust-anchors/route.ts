import { withRoute } from "@/lib/routes/with-route";
import { getPublicTrustAnchors } from "@/lib/routes/public/trust-anchors";

export const runtime = "nodejs";

export const GET = withRoute({
  auth: "none",
  debugName: "public.trust-anchors",
  handler: () => getPublicTrustAnchors()
});
