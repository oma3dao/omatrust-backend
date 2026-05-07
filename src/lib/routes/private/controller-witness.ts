import { z } from "zod";
import { submitControllerWitness } from "@/lib/services/controller-witness-service";

export const controllerWitnessBodySchema = z.object({
  // Accept both naming conventions: SDK sends subject/controller,
  // direct callers may send subjectDid/controllerDid
  subjectDid: z.string().min(1).optional(),
  controllerDid: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  controller: z.string().min(1).optional(),
  // SDK also sends these — accepted but not required by the backend
  attestationUid: z.string().optional(),
  chainId: z.number().optional(),
  easContract: z.string().optional(),
  schemaUid: z.string().optional(),
  method: z.string().optional(),
}).transform((data) => ({
  subjectDid: data.subjectDid ?? data.subject ?? "",
  controllerDid: data.controllerDid ?? data.controller ?? "",
})).refine((data) => data.subjectDid.length > 0, { message: "subjectDid or subject is required" })
  .refine((data) => data.controllerDid.length > 0, { message: "controllerDid or controller is required" });

export async function postControllerWitness(
  accountContext: NonNullable<Parameters<typeof submitControllerWitness>[0]["accountContext"]>,
  body: { subjectDid: string; controllerDid: string }
) {
  return submitControllerWitness({
    accountContext,
    subjectDid: body.subjectDid,
    controllerDid: body.controllerDid,
  });
}
