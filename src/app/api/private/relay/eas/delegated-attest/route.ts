import { withRoute } from "@/lib/routes/with-route";
import {
  delegatedAttestBodySchema,
  postRelayEasDelegatedAttest
} from "@/lib/routes/private/relay/eas/delegated-attest";

export const runtime = "nodejs";

export const POST = withRoute({
  debugName: "private/relay/eas/delegated-attest",
  auth: "session",
  bodySchema: delegatedAttestBodySchema,
  handler: ({ accountContext, body }) => postRelayEasDelegatedAttest(accountContext!, body!)
});
