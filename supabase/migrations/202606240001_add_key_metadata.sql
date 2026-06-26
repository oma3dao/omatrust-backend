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

create index if not exists key_metadata_account_id_idx on public.key_metadata(account_id);

alter table public.key_metadata enable row level security;

drop trigger if exists key_metadata_set_updated_at on public.key_metadata;
create trigger key_metadata_set_updated_at
before update on public.key_metadata
for each row execute function public.set_updated_at();
