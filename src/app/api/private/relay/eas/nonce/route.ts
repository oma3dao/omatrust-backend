import { withRoute } from "@/lib/routes/with-route";
import {
  getRelayEasNonce,
  relayNonceQuerySchema
} from "@/lib/routes/private/relay/eas/nonce";

export const runtime = "nodejs";

export const GET = withRoute({
  debugName: "private/relay/eas/nonce",
  auth: "session",
  querySchema: relayNonceQuerySchema,
  handler: ({ accountContext, query }) => getRelayEasNonce(accountContext!, query!)
});
