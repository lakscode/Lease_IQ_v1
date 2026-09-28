-- The main lease an upload was added to ("Upload amendment" on a lease).
-- analyze-lease links the amendments, addenda and letters it finds in the file
-- to this lease instead of guessing the parent from landlord, tenant and premises.
alter table public.lease_files
  add column parent_lease_id uuid references public.leases (id) on delete set null;
