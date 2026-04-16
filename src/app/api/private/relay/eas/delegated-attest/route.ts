import { z } from "zod";
import { errorResponse, ok, parseJson } from "@/lib/http";
import { getAuthenticatedAccountContext } from "@/lib/services/session-service";
import { submitDelegatedAttestation } from "@/lib/services/relay-eas-service";

export const runtime = "nodejs";

const delegatedAttestSchema = z.object({
  attester: z.string().trim().min(1),
  prepared: z.object({
    delegatedRequest: z.record(z.any()),
    typedData: z.object({
      domain: z.record(z.any()),
      types: z.record(z.any()),
      message: z.record(z.any())
    })
  }),
  signature: z.string().trim().min(1)
});

export async function POST(request: Request) {
  try {
    const accountContext = await getAuthenticatedAccountContext(request);
    const body = delegatedAttestSchema.parse(await parseJson(request));
    const result = await submitDelegatedAttestation({
      accountContext,
      attester: body.attester,
      prepared: body.prepared,
      signature: body.signature
    });

    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
