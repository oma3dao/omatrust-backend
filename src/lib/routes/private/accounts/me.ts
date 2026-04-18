import { z } from "zod";
import type { AccountContext } from "@/lib/services/account-service";
import { updateAccountDisplayName } from "@/lib/services/account-service";

export const accountUpdateBodySchema = z.object({
  displayName: z.string().trim().min(1).max(100).nullable()
});

export async function getAccountsMe(accountContext: AccountContext) {
  return {
    account: {
      id: accountContext.account.id,
      displayName: accountContext.account.display_name
    },
    subscription: {
      plan: accountContext.subscriptionState.plan,
      status: accountContext.subscriptionState.status,
      annualSponsoredWriteLimit: accountContext.subscriptionState.annual_sponsored_write_limit,
      sponsoredWritesUsedCurrentYear: accountContext.subscriptionState.sponsored_writes_used_current_year,
      annualPremiumReadLimit: accountContext.subscriptionState.annual_premium_read_limit,
      premiumReadsUsedCurrentYear: accountContext.subscriptionState.premium_reads_used_current_year
    },
    primarySubject: accountContext.primarySubject
      ? {
          id: accountContext.primarySubject.id,
          canonicalDid: accountContext.primarySubject.canonical_did,
          subjectDidHash: accountContext.primarySubject.subject_did_hash,
          displayName: accountContext.primarySubject.display_name
        }
      : null
  };
}

export async function patchAccountsMe(accountId: string, body: z.infer<typeof accountUpdateBodySchema>) {
  const account = await updateAccountDisplayName(accountId, body.displayName);

  return {
    account: {
      id: account.id,
      displayName: account.display_name
    }
  };
}
