create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  display_name text,
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_state (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  plan text not null check (plan in ('free', 'paid')),
  status text not null check (status in ('active', 'canceled', 'past_due', 'incomplete', 'trialing')),
  annual_sponsored_write_limit integer not null default 0,
  sponsored_writes_used_current_year integer not null default 0,
  annual_premium_read_limit integer not null default 0,
  premium_reads_used_current_year integer not null default 0,
  entitlement_period_start timestamptz not null default now(),
  entitlement_period_end timestamptz not null,
  stripe_subscription_id text unique,
  stripe_price_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_state_one_per_account unique (account_id)
);

create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  did text not null unique,
  wallet_address text not null,
  wallet_provider_id text,
  execution_mode text not null default 'subscription' check (execution_mode in ('subscription', 'native')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  constraint wallets_account_address_unique unique (account_id, wallet_address)
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  canonical_did text not null unique,
  subject_did_hash text not null unique,
  display_name text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  constraint subjects_account_did_unique unique (account_id, canonical_did)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  client_id text not null unique,
  auth_mode text not null check (auth_mode in ('siwe_session', 'oauth_dcr')),
  display_name text not null,
  did text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.credentials (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  wallet_id uuid references public.wallets(id) on delete set null,
  credential_kind text not null check (credential_kind in ('wallet_auth', 'jwt', 'server_wallet')),
  credential_identifier text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint credentials_account_client_identifier_unique unique (account_id, client_id, credential_identifier)
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  credential_id uuid not null references public.credentials(id) on delete restrict,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.siwe_challenges (
  id uuid primary key default gen_random_uuid(),
  wallet_did text not null,
  nonce text not null unique,
  domain text not null,
  uri text not null,
  chain_id bigint not null,
  statement text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.key_metadata (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  key_did text not null,
  key_type text not null check (key_type in ('attestation', 'service-signing')),
  display_name text not null,
  tags text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint key_metadata_account_key_did unique (account_id, key_did)
);

create index if not exists sessions_account_id_idx on public.sessions(account_id);
create index if not exists sessions_credential_id_idx on public.sessions(credential_id);
create index if not exists wallets_account_id_idx on public.wallets(account_id);
create index if not exists credentials_account_id_idx on public.credentials(account_id);
create index if not exists subjects_account_id_idx on public.subjects(account_id);
create index if not exists subscription_state_status_idx on public.subscription_state(status);
create index if not exists siwe_challenges_wallet_did_idx on public.siwe_challenges(wallet_did);
create index if not exists key_metadata_account_id_idx on public.key_metadata(account_id);

drop trigger if exists accounts_set_updated_at on public.accounts;
create trigger accounts_set_updated_at
before update on public.accounts
for each row execute function public.set_updated_at();

drop trigger if exists subscription_state_set_updated_at on public.subscription_state;
create trigger subscription_state_set_updated_at
before update on public.subscription_state
for each row execute function public.set_updated_at();

drop trigger if exists key_metadata_set_updated_at on public.key_metadata;
create trigger key_metadata_set_updated_at
before update on public.key_metadata
for each row execute function public.set_updated_at();


-- Grants: ensure service_role (used by the backend) can access all tables.
-- authenticated and anon get grants for completeness; RLS blocks direct access.
grant all on public.accounts to service_role, authenticated, anon;
grant all on public.subscription_state to service_role, authenticated, anon;
grant all on public.wallets to service_role, authenticated, anon;
grant all on public.subjects to service_role, authenticated, anon;
grant all on public.clients to service_role, authenticated, anon;
grant all on public.credentials to service_role, authenticated, anon;
grant all on public.sessions to service_role, authenticated, anon;
grant all on public.siwe_challenges to service_role, authenticated, anon;
grant all on public.key_metadata to service_role, authenticated, anon;

-- Row-Level Security: enable on all tables with no policies.
-- The backend uses the Supabase secret key which bypasses RLS.
-- This prevents the anon/public key from accessing any data.
alter table public.accounts enable row level security;
alter table public.subscription_state enable row level security;
alter table public.wallets enable row level security;
alter table public.subjects enable row level security;
alter table public.clients enable row level security;
alter table public.credentials enable row level security;
alter table public.sessions enable row level security;
alter table public.siwe_challenges enable row level security;
alter table public.key_metadata enable row level security;

-- Ensure service_role can use the public schema and access sequences.
grant usage on schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
