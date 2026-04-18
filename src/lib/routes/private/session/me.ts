import type { AccountContext } from "@/lib/services/account-service";

export async function getSessionMe(accountContext: AccountContext) {
  return {
    account: {
      id: accountContext.account.id,
      displayName: accountContext.account.display_name
    },
    wallet: accountContext.wallets[0]
      ? {
          did: accountContext.wallets[0].did,
          walletProviderId: accountContext.wallets[0].wallet_provider_id,
          isManagedWallet: accountContext.wallets[0].wallet_provider_id === "inApp"
        }
      : null,
    credential: accountContext.credential
      ? {
          id: accountContext.credential.id,
          kind: accountContext.credential.credential_kind,
          identifier: accountContext.credential.credential_identifier
        }
      : null,
    subscription: {
      plan: accountContext.subscriptionState.plan,
      status: accountContext.subscriptionState.status
    },
    client: accountContext.client
      ? {
          clientId: accountContext.client.client_id,
          authMode: accountContext.client.auth_mode
        }
      : null,
    primarySubject: accountContext.primarySubject
      ? {
          canonicalDid: accountContext.primarySubject.canonical_did,
          subjectDidHash: accountContext.primarySubject.subject_did_hash
        }
      : null
  };
}
