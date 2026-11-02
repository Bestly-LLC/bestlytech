-- Scout chat memory fix (2026-11-02), item A: per-thread working-memory brief.
-- Fixes thread d42608b1-adce-4158-9b35-5b503f21b925 (Nov 1, 4:00-4:09 PM): "continue"/"try now" lost an
-- 8-step run because nothing carried the goal/open-items forward between hops and messages.
-- UNDO: alter table public.admin_chat_threads drop column if exists brief, drop column if exists brief_at;

alter table public.admin_chat_threads
  add column if not exists brief jsonb,
  add column if not exists brief_at timestamptz;

comment on column public.admin_chat_threads.brief is
  'Scout''s working memory for this thread: {goal, facts[], done[], open[], decisions[], avoid[]}. Updated at the end of every run (admin-chat v91); never grows past ~1800 chars in the prompt.';

-- No new GRANT needed: authenticated already has table-level SELECT on admin_chat_threads
-- (confirmed via information_schema.role_table_grants before writing this migration).
