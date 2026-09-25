-- Saved conversations from the Ask (lease chat) page. One row per chat; the
-- messages are stored in order as [{ role, content, sources? }].

create table public.lease_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Document the chat was scoped to, if any.
  lease_id uuid references public.leases (id) on delete set null,
  title text not null,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lease_chats_user_id_idx on public.lease_chats (user_id, updated_at desc);

alter table public.lease_chats enable row level security;

create policy "Users manage their own lease chats" on public.lease_chats
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
