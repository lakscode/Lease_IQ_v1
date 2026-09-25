-- Record Ask LeaseIQ token usage in ai_usage: one row per question, linked to
-- the saved chat (kept with the chat title if the chat is deleted).

alter table public.ai_usage
  add column chat_id uuid references public.lease_chats (id) on delete set null,
  add column chat_title text;

alter table public.ai_usage drop constraint ai_usage_process_check;
alter table public.ai_usage
  add constraint ai_usage_process_check check (process in ('analysis', 'reanalysis', 'chat'));

create index ai_usage_chat_id_idx on public.ai_usage (chat_id);

notify pgrst, 'reload schema';
