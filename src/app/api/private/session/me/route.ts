import { errorResponse, ok } from "@/lib/http";
import { getAuthenticatedAccountContext } from "@/lib/services/session-service";
import { assertApiReadAllowed, incrementApiReadUsage } from "@/lib/services/subscription-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedAccountContext(request);
    assertApiReadAllowed(context.subscription);
    await incrementApiReadUsage(context.subscription);

    return ok({
      account: {
        id: context.account.id,
        displayName: context.account.display_name
      },
      wallet: context.wallets[0]
        ? {
            did: context.wallets[0].did
          }
        : null,
      subscription: {
        plan: context.subscription.plan,
        status: context.subscription.status
      },
      client: context.client
        ? {
            clientId: context.client.client_id,
            authMode: context.client.auth_mode
          }
        : null,
      primarySubject: context.primarySubject
        ? {
            canonicalDid: context.primarySubject.canonical_did,
            subjectDidHash: context.primarySubject.subject_did_hash
          }
        : null
    });
  } catch (error) {
    return errorResponse(error);
  }
}
