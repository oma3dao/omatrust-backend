import { withRoute } from "@/lib/routes/with-route";
import {
  controllerWitnessBodySchema,
  postControllerWitness,
} from "@/lib/routes/private/controller-witness";

export const runtime = "nodejs";

export const POST = withRoute({
  debugName: "private/controller-witness",
  auth: "session",
  bodySchema: controllerWitnessBodySchema,
  handler: ({ accountContext, body }) =>
    postControllerWitness(accountContext!, body!),
});
