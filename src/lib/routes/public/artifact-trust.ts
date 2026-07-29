import { z } from "zod";
import { getArtifactTrust } from "@/lib/services/artifact-trust-service";

export const artifactTrustQuerySchema = z.object({
  artifactDid: z.string().default("")
});

export async function getPublicArtifactTrust(
  query: z.infer<typeof artifactTrustQuerySchema>
) {
  return getArtifactTrust(query.artifactDid);
}
