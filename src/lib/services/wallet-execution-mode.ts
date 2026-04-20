import { ApiError } from "../errors.ts";
import type { WalletExecutionMode, WalletRow } from "../db/types.ts";

export function isManagedWalletProvider(walletProviderId?: string | null) {
  return walletProviderId === "inApp";
}

export function resolveInitialWalletExecutionMode(params: {
  walletProviderId?: string | null;
  requestedExecutionMode?: WalletExecutionMode | null;
}): WalletExecutionMode {
  if (isManagedWalletProvider(params.walletProviderId)) {
    if (params.requestedExecutionMode && params.requestedExecutionMode !== "subscription") {
      throw new ApiError(
        "Managed in-app wallets must use subscription execution",
        400,
        "INVALID_EXECUTION_MODE"
      );
    }

    return "subscription";
  }

  if (!params.requestedExecutionMode) {
    throw new ApiError(
      "Execution mode is required for non-managed wallets on first sign-in",
      400,
      "EXECUTION_MODE_REQUIRED"
    );
  }

  return params.requestedExecutionMode;
}

export function assertRequestedExecutionModeMatchesWallet(
  wallet: WalletRow,
  requestedExecutionMode?: WalletExecutionMode | null
) {
  if (!requestedExecutionMode) {
    return;
  }

  if (requestedExecutionMode !== wallet.execution_mode) {
    throw new ApiError(
      "Execution mode is already set for this wallet",
      409,
      "EXECUTION_MODE_ALREADY_SET"
    );
  }
}

export function assertWalletUsesSubscriptionExecution(wallet: WalletRow) {
  if (wallet.execution_mode !== "subscription") {
    throw new ApiError(
      "Wallet is configured for native execution",
      403,
      "EXECUTION_MODE_NATIVE"
    );
  }
}

export function getAuthenticatedWalletFromContext(params: {
  wallets: WalletRow[];
  credentialWalletId?: string | null;
}) {
  return (
    (params.credentialWalletId
      ? params.wallets.find((wallet) => wallet.id === params.credentialWalletId)
      : null) ??
    params.wallets.find((wallet) => wallet.is_primary) ??
    params.wallets[0] ??
    null
  );
}
