alter table public.wallets
add column if not exists execution_mode text;

update public.wallets
set execution_mode = 'subscription'
where execution_mode is null;

alter table public.wallets
alter column execution_mode set default 'subscription';

alter table public.wallets
alter column execution_mode set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'wallets_execution_mode_check'
  ) then
    alter table public.wallets
      add constraint wallets_execution_mode_check
      check (execution_mode in ('subscription', 'native'));
  end if;
end
$$;
