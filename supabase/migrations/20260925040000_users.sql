-- users: one row per registered account, with its app role. Replaces
-- super_admins. New sign-ups are added automatically as 'user'; change a
-- role from the SQL Editor, e.g.
--   update public.users set role = 'superadmin' where email = 'admin@example.com';

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('superadmin', 'user')),
  created_at timestamptz not null default now()
);

create index users_email_idx on public.users (email);

-- Existing accounts; anyone already in super_admins keeps the role.
insert into public.users (id, email, role, created_at)
select u.id, u.email,
       case when exists (select 1 from public.super_admins s where s.user_id = u.id) then 'superadmin' else 'user' end,
       u.created_at
from auth.users u
on conflict (id) do nothing;

-- Keep users in step with auth.users.
create or replace function public.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_auth_user_change();

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_auth_user_change();

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.users where id = (select auth.uid()) and role = 'superadmin');
$$;

revoke execute on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

-- Users read their own row; super admins read everyone's. There are no write
-- policies, so nobody can change a role (or their own) through the API.
alter table public.users enable row level security;

create policy "Users read their own user row" on public.users
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "Super admins read all users" on public.users
  for select to authenticated
  using ((select public.is_super_admin()));

-- recreate_lease_clauses() keeps calling is_super_admin(), now backed by users.
drop table public.super_admins;

notify pgrst, 'reload schema';
