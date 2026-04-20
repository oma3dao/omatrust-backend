export type Plan = "free" | "paid";
export type SubscriptionStatus = "active" | "canceled" | "past_due" | "incomplete" | "trialing";
export type ClientAuthMode = "siwe_session" | "oauth_dcr";
export type CredentialKind = "wallet_auth" | "jwt" | "server_wallet";
export type WalletExecutionMode = "subscription" | "native";

export interface AccountRow {
  id: string;
  display_name: string | null;
  stripe_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionStateRow {
  id: string;
  account_id: string;
  plan: Plan;
  status: SubscriptionStatus;
  annual_sponsored_write_limit: number;
  sponsored_writes_used_current_year: number;
  annual_premium_read_limit: number;
  premium_reads_used_current_year: number;
  entitlement_period_start: string;
  entitlement_period_end: string;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WalletRow {
  id: string;
  account_id: string;
  did: string;
  wallet_address: string;
  wallet_provider_id: string | null;
  execution_mode: WalletExecutionMode;
  is_primary: boolean;
  created_at: string;
}

export interface SubjectRow {
  id: string;
  account_id: string;
  canonical_did: string;
  subject_did_hash: string;
  display_name: string | null;
  is_default: boolean;
  created_at: string;
}

export interface ClientRow {
  id: string;
  account_id: string | null;
  client_id: string;
  auth_mode: ClientAuthMode;
  display_name: string;
  did: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface SessionRow {
  id: string;
  account_id: string;
  client_id: string;
  credential_id: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface CredentialRow {
  id: string;
  account_id: string;
  client_id: string;
  wallet_id: string | null;
  credential_kind: CredentialKind;
  credential_identifier: string;
  created_at: string;
  revoked_at: string | null;
}

export interface SiweChallengeRow {
  id: string;
  wallet_did: string;
  nonce: string;
  domain: string;
  uri: string;
  chain_id: number;
  statement: string | null;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}
