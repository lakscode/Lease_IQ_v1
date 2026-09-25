-- Token usage of every Claude request, recorded by the Edge Functions.
-- Rows outlive the file they were for (file_id is cleared, file_name kept),
-- so usage history stays complete after files are deleted.

create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  file_id uuid references public.lease_files (id) on delete set null,
  file_name text,
  -- analysis: first analysis of an upload; reanalysis: retry or re-analyze
  process text not null check (process in ('analysis', 'reanalysis')),
  model text not null,
  served_by text,
  stop_reason text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0,
  -- Full usage object from the API (includes per-model iterations on fallback).
  usage jsonb not null default '{}'::jsonb,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index ai_usage_file_id_idx on public.ai_usage (file_id);
create index ai_usage_user_id_idx on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;

create policy "Users read their own AI usage" on public.ai_usage
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users record their own AI usage" on public.ai_usage
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Super admins read all AI usage" on public.ai_usage
  for select to authenticated
  using ((select public.is_super_admin()));

notify pgrst, 'reload schema';
