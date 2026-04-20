export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      accounts: {
        Row: {
          id: string;
          display_name: string | null;
          stripe_customer_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          display_name?: string | null;
          stripe_customer_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          stripe_customer_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      subscription_state: {
        Row: {
          id: string;
          account_id: string;
          plan: "free" | "paid";
          status: "active" | "canceled" | "past_due" | "incomplete" | "trialing";
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
        };
        Insert: {
          id?: string;
          account_id: string;
          plan: "free" | "paid";
          status: "active" | "canceled" | "past_due" | "incomplete" | "trialing";
          annual_sponsored_write_limit?: number;
          sponsored_writes_used_current_year?: number;
          annual_premium_read_limit?: number;
          premium_reads_used_current_year?: number;
          entitlement_period_start?: string;
          entitlement_period_end: string;
          stripe_subscription_id?: string | null;
          stripe_price_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          plan?: "free" | "paid";
          status?: "active" | "canceled" | "past_due" | "incomplete" | "trialing";
          annual_sponsored_write_limit?: number;
          sponsored_writes_used_current_year?: number;
          annual_premium_read_limit?: number;
          premium_reads_used_current_year?: number;
          entitlement_period_start?: string;
          entitlement_period_end?: string;
          stripe_subscription_id?: string | null;
          stripe_price_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      wallets: {
        Row: {
          id: string;
          account_id: string;
          did: string;
          wallet_address: string;
          wallet_provider_id: string | null;
          execution_mode: "subscription" | "native";
          is_primary: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          did: string;
          wallet_address: string;
          wallet_provider_id?: string | null;
          execution_mode?: "subscription" | "native";
          is_primary?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          did?: string;
          wallet_address?: string;
          wallet_provider_id?: string | null;
          execution_mode?: "subscription" | "native";
          is_primary?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      subjects: {
        Row: {
          id: string;
          account_id: string;
          canonical_did: string;
          subject_did_hash: string;
          display_name: string | null;
          is_default: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          canonical_did: string;
          subject_did_hash: string;
          display_name?: string | null;
          is_default?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          canonical_did?: string;
          subject_did_hash?: string;
          display_name?: string | null;
          is_default?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      clients: {
        Row: {
          id: string;
          account_id: string | null;
          client_id: string;
          auth_mode: "siwe_session" | "oauth_dcr";
          display_name: string;
          did: string | null;
          created_at: string;
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          account_id?: string | null;
          client_id: string;
          auth_mode: "siwe_session" | "oauth_dcr";
          display_name: string;
          did?: string | null;
          created_at?: string;
          revoked_at?: string | null;
        };
        Update: {
          id?: string;
          account_id?: string | null;
          client_id?: string;
          auth_mode?: "siwe_session" | "oauth_dcr";
          display_name?: string;
          did?: string | null;
          created_at?: string;
          revoked_at?: string | null;
        };
        Relationships: [];
      };
      credentials: {
        Row: {
          id: string;
          account_id: string;
          client_id: string;
          wallet_id: string | null;
          credential_kind: "wallet_auth" | "jwt" | "server_wallet";
          credential_identifier: string;
          created_at: string;
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          account_id: string;
          client_id: string;
          wallet_id?: string | null;
          credential_kind: "wallet_auth" | "jwt" | "server_wallet";
          credential_identifier: string;
          created_at?: string;
          revoked_at?: string | null;
        };
        Update: {
          id?: string;
          account_id?: string;
          client_id?: string;
          wallet_id?: string | null;
          credential_kind?: "wallet_auth" | "jwt" | "server_wallet";
          credential_identifier?: string;
          created_at?: string;
          revoked_at?: string | null;
        };
        Relationships: [];
      };
      sessions: {
        Row: {
          id: string;
          account_id: string;
          client_id: string;
          credential_id: string;
          expires_at: string;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          client_id: string;
          credential_id: string;
          expires_at: string;
          revoked_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          client_id?: string;
          credential_id?: string;
          expires_at?: string;
          revoked_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      siwe_challenges: {
        Row: {
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
        };
        Insert: {
          id?: string;
          wallet_did: string;
          nonce: string;
          domain: string;
          uri: string;
          chain_id: number;
          statement?: string | null;
          expires_at: string;
          used_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          wallet_did?: string;
          nonce?: string;
          domain?: string;
          uri?: string;
          chain_id?: number;
          statement?: string | null;
          expires_at?: string;
          used_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
