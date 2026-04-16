import { z } from "zod";
import { errorResponse, ok, parseJson } from "@/lib/http";
import { getAuthenticatedAccountContext } from "@/lib/services/session-service";
import { updateAccountDisplayName } from "@/lib/services/account-service";
import { assertApiReadAllowed, incrementApiReadUsage } from "@/lib/services/subscription-service";

export const runtime = "nodejs";

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(100).nullable()
});

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
      subscription: {
        plan: context.subscription.plan,
        status: context.subscription.status,
        monthlySponsoredWriteLimit: context.subscription.monthly_sponsored_write_limit,
        sponsoredWritesUsedCurrentPeriod: context.subscription.sponsored_writes_used_current_period,
        monthlyApiReadLimit: context.subscription.monthly_api_read_limit,
        apiReadsUsedCurrentPeriod: context.subscription.api_reads_used_current_period
      },
      primarySubject: context.primarySubject
        ? {
            id: context.primarySubject.id,
            canonicalDid: context.primarySubject.canonical_did,
            subjectDidHash: context.primarySubject.subject_did_hash
          }
        : null
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await getAuthenticatedAccountContext(request);
    const body = updateSchema.parse(await parseJson(request));
    const account = await updateAccountDisplayName(context.account.id, body.displayName);

    return ok({
      account: {
        id: account.id,
        displayName: account.display_name
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
