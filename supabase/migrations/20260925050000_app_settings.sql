-- App-wide settings chosen on the super admin Settings page, e.g.
--   claude_model: "claude-opus-5"  (model the Edge Functions call)
-- Every signed-in user can read them (the Edge Functions run as the caller);
-- only super admins can change them.

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null default auth.uid()
);

alter table public.app_settings enable row level security;

create policy "Signed-in users read app settings" on public.app_settings
  for select to authenticated
  using (true);

create policy "Super admins add app settings" on public.app_settings
  for insert to authenticated
  with check ((select public.is_super_admin()));

create policy "Super admins change app settings" on public.app_settings
  for update to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

create policy "Super admins remove app settings" on public.app_settings
  for delete to authenticated
  using ((select public.is_super_admin()));

notify pgrst, 'reload schema';
