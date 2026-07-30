import { withRoute } from "@/lib/routes/with-route";
import {
  artifactTrustQuerySchema,
  getPublicArtifactTrust
} from "@/lib/routes/public/artifact-trust";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRoute({
  auth: "none",
  querySchema: artifactTrustQuerySchema,
  debugName: "public.artifact-trust",
  handler: ({ query }) => getPublicArtifactTrust(query!)
});
