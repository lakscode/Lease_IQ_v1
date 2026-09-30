-- Rent audit: the lease family's base rent schedule (extracted by the
-- lease-insights Edge Function with the opportunities) and the rent audits
-- users run and save on the lease Details page, comparing the rent the lease
-- requires each month with what was billed.

alter table public.lease_insights
  add column rent jsonb;

create table public.rent_audits (
  id uuid primary key default gen_random_uuid(),
  -- Main lease of the family (same key as lease_insights).
  lease_id uuid not null references public.leases (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- First and last month audited, as YYYY-MM.
  start_month text not null check (start_month ~ '^\d{4}-\d{2}$'),
  end_month text not null check (end_month ~ '^\d{4}-\d{2}$'),
  -- Billed amounts entered by the user: see src/lib/rentAudit.ts.
  inputs jsonb not null,
  -- Month-by-month lease rent, billed amounts and totals at the time of saving.
  result jsonb not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lease_id, start_month, end_month),
  check (start_month <= end_month)
);

create index rent_audits_user_id_idx on public.rent_audits (user_id);

alter table public.rent_audits enable row level security;

create policy "Users manage their own rent audits" on public.rent_audits
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
