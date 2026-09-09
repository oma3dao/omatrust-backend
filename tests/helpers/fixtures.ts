import type { AccountContext } from "@/lib/services/account-service";
import type {
  AccountRow,
  SubscriptionStateRow,
  WalletRow
} from "@/lib/db/types";

export const TEST_WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
export const TEST_WALLET_DID = `did:pkh:eip155:66238:${TEST_WALLET_ADDRESS}`;

const TIMESTAMP = "2026-01-01T00:00:00.000Z";

export function createAccount(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: "account-1",
    display_name: null,
    stripe_customer_id: null,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides
  };
}

export function createSubscriptionState(
  overrides: Partial<SubscriptionStateRow> = {}
): SubscriptionStateRow {
  return {
    id: "subscription-1",
    account_id: "account-1",
    plan: "free",
    status: "active",
    annual_sponsored_write_limit: 10,
    sponsored_writes_used_current_year: 0,
    annual_premium_read_limit: 100,
    premium_reads_used_current_year: 0,
    entitlement_period_start: TIMESTAMP,
    entitlement_period_end: "2027-01-01T00:00:00.000Z",
    stripe_subscription_id: null,
    stripe_price_id: null,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides
  };
}

export function createWallet(overrides: Partial<WalletRow> = {}): WalletRow {
  return {
    id: "wallet-1",
    account_id: "account-1",
    did: TEST_WALLET_DID,
    wallet_address: TEST_WALLET_ADDRESS,
    wallet_provider_id: "inApp",
    execution_mode: "subscription",
    is_primary: true,
    created_at: TIMESTAMP,
    ...overrides
  };
}

export function createAccountContext(
  overrides: Partial<AccountContext> = {}
): AccountContext {
  return {
    account: createAccount(),
    subscriptionState: createSubscriptionState(),
    wallets: [createWallet()],
    subjects: [],
    primarySubject: null,
    client: null,
    credential: null,
    session: null,
    ...overrides
  };
}
