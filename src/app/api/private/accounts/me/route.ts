import { withRoute } from "@/lib/routes/with-route";
import {
  accountUpdateBodySchema,
  getAccountsMe,
  patchAccountsMe
} from "@/lib/routes/private/accounts/me";

export const runtime = "nodejs";

export const GET = withRoute({
  debugName: "private/accounts/me:get",
  auth: "session",
  handler: ({ accountContext }) => getAccountsMe(accountContext!)
});

export const PATCH = withRoute({
  debugName: "private/accounts/me:patch",
  auth: "session",
  bodySchema: accountUpdateBodySchema,
  handler: ({ accountContext, body }) => patchAccountsMe(accountContext!.account.id, body!)
});
