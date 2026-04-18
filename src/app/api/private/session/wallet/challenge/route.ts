import { withRoute } from "@/lib/routes/with-route";
import {
  postSessionChallenge,
  sessionChallengeBodySchema
} from "@/lib/routes/private/session/wallet/challenge";

export const runtime = "nodejs";

export const POST = withRoute({
  debugName: "private/session/wallet/challenge",
  bodySchema: sessionChallengeBodySchema,
  handler: ({ body }) => postSessionChallenge(body!)
});
