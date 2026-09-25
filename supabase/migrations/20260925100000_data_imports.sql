-- Rent roll data imported from a property management system (Yardi, MRI) or a
-- CSV file, one row per lease, matched to LeaseIQ lease documents so the
-- system's values can be compared with the lease abstracts.

create table public.data_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null check (source in ('yardi', 'mri', 'csv')),
  file_name text not null,
  row_count integer not null default 0,
  matched_count integer not null default 0,
  -- Source column chosen for each field: { tenant: "Lease Name", ... }
  column_map jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index data_imports_user_id_idx on public.data_imports (user_id, created_at desc);

create table public.system_leases (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.data_imports (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null,
  -- LeaseIQ lease document this record belongs to (main lease), if matched.
  matched_lease_id uuid references public.leases (id) on delete set null,
  external_id text,
  property text,
  unit text,
  tenant text not null,
  status text,
  lease_start date,
  lease_end date,
  area_sqft numeric,
  monthly_base_rent numeric,
  cam_monthly numeric,
  tax_monthly numeric,
  insurance_monthly numeric,
  other_monthly numeric,
  security_deposit numeric,
  next_escalation_date date,
  next_escalation_rent numeric,
  -- The original row(s) from the file.
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index system_leases_user_id_idx on public.system_leases (user_id);
create index system_leases_import_id_idx on public.system_leases (import_id);
create index system_leases_matched_lease_id_idx on public.system_leases (matched_lease_id);

alter table public.data_imports enable row level security;
alter table public.system_leases enable row level security;

create policy "Users manage their own data imports" on public.data_imports
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage their own system leases" on public.system_leases
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
