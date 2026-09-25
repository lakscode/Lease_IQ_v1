-- Revenue and risk opportunities for a lease family (a main lease with its
-- amendments and addenda), generated on demand by the lease-insights Edge
-- Function. One row per family, keyed by the main lease (or by the document
-- itself when it has no main lease).

create table public.lease_insights (
  lease_id uuid primary key references public.leases (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- generating -> ready | failed
  status text not null default 'generating' check (status in ('generating', 'ready', 'failed')),
  error text,
  model text,
  -- [{ category, status, priority, summary, detail, due_date, amount, citations: [{ leaseId, title, page }] }]
  items jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  generated_at timestamptz
);

create index lease_insights_user_id_idx on public.lease_insights (user_id);

alter table public.lease_insights enable row level security;

create policy "Users manage their own lease insights" on public.lease_insights
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Token usage of insight generation.
alter table public.ai_usage
  add column lease_id uuid references public.leases (id) on delete set null;

alter table public.ai_usage drop constraint ai_usage_process_check;
alter table public.ai_usage
  add constraint ai_usage_process_check check (process in ('analysis', 'reanalysis', 'chat', 'insights'));

notify pgrst, 'reload schema';
