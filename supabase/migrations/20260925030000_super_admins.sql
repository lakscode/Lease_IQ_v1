-- Super admins: users allowed to open Settings and run its maintenance actions.
-- Rows are added from the SQL Editor only (there is no insert policy), e.g.
--   insert into public.super_admins (user_id)
--   select id from auth.users where email = 'admin@example.com';

create table public.super_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.super_admins enable row level security;

create policy "Users can see whether they are a super admin" on public.super_admins
  for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.super_admins where user_id = (select auth.uid()));
$$;

revoke execute on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

-- Same as 20260925000000_recreate_lease_clauses_fn.sql, but only super admins may run it.
create or replace function public.recreate_lease_clauses()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can recreate lease_clauses' using errcode = '42501';
  end if;

  drop table if exists public.lease_clauses;

  create table public.lease_clauses (
    id bigint generated always as identity primary key,
    lease_id uuid not null references public.leases (id) on delete cascade,
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    clause_index integer not null,
    page_number integer not null,
    text text not null,
    label_id text not null,
    -- Display name from ml/clause_labels.csv at the time the clause was classified.
    label text not null,
    score real not null,
    -- Runner-up labels: [{ labelId, label, score }]
    alternatives jsonb not null default '[]'::jsonb,
    unique (lease_id, clause_index)
  );

  create index lease_clauses_user_id_idx on public.lease_clauses (user_id);

  alter table public.lease_clauses enable row level security;

  create policy "Users manage their own lease clauses" on public.lease_clauses
    for all to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

  grant all on public.lease_clauses to authenticated, service_role;

  perform pg_notify('pgrst', 'reload schema');
end;
$$;

revoke execute on function public.recreate_lease_clauses() from public, anon;
grant execute on function public.recreate_lease_clauses() to authenticated;

notify pgrst, 'reload schema';
