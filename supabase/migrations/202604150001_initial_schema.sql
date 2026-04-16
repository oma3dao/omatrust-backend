create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
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

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  plan text not null check (plan in ('free', 'paid')),
  status text not null check (status in ('active', 'canceled', 'past_due', 'incomplete', 'trialing')),
  monthly_sponsored_write_limit integer not null default 0,
  sponsored_writes_used_current_period integer not null default 0,
  monthly_api_read_limit integer not null default 0,
  api_reads_used_current_period integer not null default 0,
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null,
  stripe_subscription_id text unique,
  stripe_price_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_one_per_account unique (account_id)
);

create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  did text not null unique,
  wallet_address text not null,
  caip2_chain_id text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  constraint wallets_account_chain_address_unique unique (account_id, caip2_chain_id, wallet_address)
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  canonical_did text not null unique,
  subject_did_hash text not null unique,
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

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  wallet_id uuid references public.wallets(id) on delete set null,
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

create index if not exists sessions_account_id_idx on public.sessions(account_id);
create index if not exists sessions_wallet_id_idx on public.sessions(wallet_id);
create index if not exists wallets_account_id_idx on public.wallets(account_id);
create index if not exists subjects_account_id_idx on public.subjects(account_id);
create index if not exists subscriptions_status_idx on public.subscriptions(status);
create index if not exists siwe_challenges_wallet_did_idx on public.siwe_challenges(wallet_did);

drop trigger if exists accounts_set_updated_at on public.accounts;
create trigger accounts_set_updated_at
before update on public.accounts
for each row execute function public.set_updated_at();

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();
