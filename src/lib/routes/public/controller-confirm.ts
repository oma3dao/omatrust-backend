import { z } from "zod";
import {
  getControllerEndpointConfirmation,
  getServiceControllerSummary
} from "@/lib/services/service-controller-service";

export const serviceControllerSummaryQuerySchema = z.object({
  subjectDid: z.string().min(1),
  walletDid: z.string().min(1).optional()
});

export async function getPublicServiceControllerSummary(
  query: z.infer<typeof serviceControllerSummaryQuerySchema>
) {
  return getServiceControllerSummary(query);
}

export const controllerEndpointConfirmQuerySchema = z.object({
  subjectDid: z.string().min(1)
});

export async function getPublicControllerEndpointConfirmation(
  query: z.infer<typeof controllerEndpointConfirmQuerySchema>
) {
  return getControllerEndpointConfirmation(query);
}
