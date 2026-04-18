import type { AccountContext } from "@/lib/services/account-service";

export async function getSubscriptionsCurrent(accountContext: AccountContext) {
  return {
    subscription: {
      plan: accountContext.subscriptionState.plan,
      status: accountContext.subscriptionState.status,
      annualSponsoredWriteLimit: accountContext.subscriptionState.annual_sponsored_write_limit,
      sponsoredWritesUsedCurrentYear: accountContext.subscriptionState.sponsored_writes_used_current_year,
      annualPremiumReadLimit: accountContext.subscriptionState.annual_premium_read_limit,
      premiumReadsUsedCurrentYear: accountContext.subscriptionState.premium_reads_used_current_year,
      entitlementPeriodStart: accountContext.subscriptionState.entitlement_period_start,
      entitlementPeriodEnd: accountContext.subscriptionState.entitlement_period_end
    }
  };
}
