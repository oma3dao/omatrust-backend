export type Plan = "free" | "paid";
export type SubscriptionStatus = "active" | "canceled" | "past_due" | "incomplete" | "trialing";
export type ClientAuthMode = "siwe_session" | "oauth_dcr";

export interface AccountRow {
  id: string;
  display_name: string | null;
  stripe_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionRow {
  id: string;
  account_id: string;
  plan: Plan;
  status: SubscriptionStatus;
  monthly_sponsored_write_limit: number;
  sponsored_writes_used_current_period: number;
  monthly_api_read_limit: number;
  api_reads_used_current_period: number;
  current_period_start: string;
  current_period_end: string;
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
  caip2_chain_id: string;
  is_primary: boolean;
  created_at: string;
}

export interface SubjectRow {
  id: string;
  account_id: string;
  canonical_did: string;
  subject_did_hash: string;
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
  wallet_id: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
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
