import type { AccountContext } from "@/lib/services/account-service";
import { buildSessionMeResponse } from "@/lib/services/session-view";

export async function getSessionMe(accountContext: AccountContext) {
  return buildSessionMeResponse(accountContext);
}
