import { z } from "zod";
import { resolveIdentities } from "@/lib/services/identity-resolver-service";

export const identityResolveBodySchema = z.object({
  identifiers: z.array(z.string().min(1)).max(100)
});

export async function postIdentityResolve(body: z.infer<typeof identityResolveBodySchema>) {
  return resolveIdentities(body.identifiers);
}
