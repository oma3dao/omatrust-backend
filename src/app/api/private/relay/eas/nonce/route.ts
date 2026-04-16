import { errorResponse, ok } from "@/lib/http";
import { getAuthenticatedAccountContext } from "@/lib/services/session-service";
import { getRelayNonce } from "@/lib/services/relay-eas-service";
import { assertApiReadAllowed, incrementApiReadUsage } from "@/lib/services/subscription-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedAccountContext(request);
    assertApiReadAllowed(context.subscription);
    await incrementApiReadUsage(context.subscription);
    const attester = new URL(request.url).searchParams.get("attester") || "";
    const result = await getRelayNonce(attester);
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
