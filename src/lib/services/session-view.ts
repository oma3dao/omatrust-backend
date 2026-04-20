import type { AccountContext } from "./account-service.ts";
import { getAuthenticatedWalletFromContext } from "./wallet-execution-mode.ts";

export function buildSessionMeResponse(accountContext: AccountContext) {
  const authenticatedWallet = getAuthenticatedWalletFromContext({
    wallets: accountContext.wallets,
    credentialWalletId: accountContext.credential?.wallet_id ?? null
  });

  return {
    account: {
      id: accountContext.account.id,
      displayName: accountContext.account.display_name
    },
    wallet: authenticatedWallet
      ? {
          did: authenticatedWallet.did,
          walletProviderId: authenticatedWallet.wallet_provider_id,
          executionMode: authenticatedWallet.execution_mode,
          isManagedWallet: authenticatedWallet.wallet_provider_id === "inApp"
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
