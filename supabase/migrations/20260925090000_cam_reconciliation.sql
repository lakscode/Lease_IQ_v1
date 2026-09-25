-- CAM reconciliation: the lease family's CAM terms (extracted by the
-- lease-insights Edge Function with the opportunities) and the yearly
-- reconciliations users calculate and save on the lease Details page.

alter table public.lease_insights
  add column cam jsonb;

create table public.cam_reconciliations (
  id uuid primary key default gen_random_uuid(),
  -- Main lease of the family (same key as lease_insights).
  lease_id uuid not null references public.leases (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  year integer not null check (year between 1900 and 2200),
  -- Amounts entered by the user and the rates used: see src/lib/cam.ts.
  inputs jsonb not null,
  -- Calculated figures at the time of saving.
  result jsonb not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lease_id, year)
);

create index cam_reconciliations_user_id_idx on public.cam_reconciliations (user_id);

alter table public.cam_reconciliations enable row level security;

create policy "Users manage their own CAM reconciliations" on public.cam_reconciliations
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
