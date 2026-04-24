import { z } from "zod";
import { json } from "@/lib/http";
import { verifySubjectOwnership } from "@/lib/services/subject-ownership-service";
import logger from "@/lib/logger";

export const verifySubjectOwnershipBodySchema = z.object({
  subjectDid: z.string().min(1),
  connectedWalletDid: z.string().min(1),
  txHash: z.string().min(1).optional().nullable()
});

export async function postVerifySubjectOwnership(body: z.infer<typeof verifySubjectOwnershipBodySchema>) {
  const result = await verifySubjectOwnership(body);

  if (!result.ok) {
    logger.warn("[verify.subject-ownership] verification failed", {
      subjectDid: body.subjectDid,
      connectedWalletDid: body.connectedWalletDid,
      error: result.error,
      details: result.details,
      method: result.method
    });
    return json(result, { status: 403 });
  }

  return result;
}
