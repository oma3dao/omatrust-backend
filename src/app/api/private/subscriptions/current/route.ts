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
      subscription: {
        plan: context.subscription.plan,
        status: context.subscription.status,
        monthlySponsoredWriteLimit: context.subscription.monthly_sponsored_write_limit,
        sponsoredWritesUsedCurrentPeriod: context.subscription.sponsored_writes_used_current_period,
        monthlyApiReadLimit: context.subscription.monthly_api_read_limit,
        apiReadsUsedCurrentPeriod: context.subscription.api_reads_used_current_period,
        currentPeriodStart: context.subscription.current_period_start,
        currentPeriodEnd: context.subscription.current_period_end
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
