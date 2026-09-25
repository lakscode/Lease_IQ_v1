-- Manual edits of lease details, one row per changed field. Rows are written by
-- a trigger on public.leases, so every update of a tracked field is recorded
-- whichever client makes it.

create table public.lease_edits (
  id bigint generated always as identity primary key,
  lease_id uuid not null references public.leases (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Who made the change (the lease owner, or null for server-side updates).
  edited_by uuid references auth.users (id) on delete set null,
  edited_by_email text,
  -- Column name (title, landlord, ...) or "abstract.<key>" for abstract fields.
  field text not null,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);

create index lease_edits_lease_id_idx on public.lease_edits (lease_id, created_at desc);

alter table public.lease_edits enable row level security;

-- History is read-only for users; only the trigger writes it.
create policy "Users read edits of their own leases" on public.lease_edits
  for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.record_lease_edits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  editor uuid := auth.uid();
  editor_email text;
  col text;
  old_v text;
  new_v text;
  k text;
begin
  select email into editor_email from auth.users where id = editor;

  foreach col in array array['title', 'doc_type', 'effective_date', 'landlord', 'tenant', 'premises', 'summary'] loop
    old_v := to_jsonb(old) ->> col;
    new_v := to_jsonb(new) ->> col;
    if old_v is distinct from new_v then
      insert into public.lease_edits (lease_id, user_id, edited_by, edited_by_email, field, old_value, new_value)
      values (new.id, new.user_id, editor, editor_email, col, old_v, new_v);
    end if;
  end loop;

  if old.abstract is distinct from new.abstract then
    for k in
      select key from jsonb_object_keys(coalesce(old.abstract, '{}'::jsonb)) as key
      union
      select key from jsonb_object_keys(coalesce(new.abstract, '{}'::jsonb)) as key
    loop
      old_v := nullif(old.abstract ->> k, '');
      new_v := nullif(new.abstract ->> k, '');
      if old_v is distinct from new_v then
        insert into public.lease_edits (lease_id, user_id, edited_by, edited_by_email, field, old_value, new_value)
        values (new.id, new.user_id, editor, editor_email, 'abstract.' || k, old_v, new_v);
      end if;
    end loop;
  end if;

  return new;
end;
$$;

create trigger leases_record_edits
  after update on public.leases
  for each row
  execute function public.record_lease_edits();

-- When the lease was last edited by hand, shown next to the details.
alter table public.leases add column edited_at timestamptz;

notify pgrst, 'reload schema';
