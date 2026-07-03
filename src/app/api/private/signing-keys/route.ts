import { withRoute } from "@/lib/routes/with-route";
import {
  upsertSigningKeyBodySchema,
  listSigningKeysQuerySchema,
  postSigningKey,
  getSigningKeys
} from "@/lib/routes/private/signing-keys";

export const runtime = "nodejs";

export const POST = withRoute({
  debugName: "private/signing-keys:post",
  auth: "session",
  bodySchema: upsertSigningKeyBodySchema,
  handler: ({ accountContext, body }) => postSigningKey(accountContext!, body!)
});

export const GET = withRoute({
  debugName: "private/signing-keys:get",
  auth: "session",
  querySchema: listSigningKeysQuerySchema,
  handler: ({ accountContext, query }) => getSigningKeys(accountContext!, query!)
});
