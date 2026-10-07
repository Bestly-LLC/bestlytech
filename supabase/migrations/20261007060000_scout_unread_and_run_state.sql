-- Scout: unread dots (purple = waiting, orange = needs you) + working memory for long free-AI runs.
-- Jared, 2026-10-06: "if I have unread messages from Scout in chat have a purple dot ... and orange for urgent or
-- needs follow-up from me. Can we also have Scout go on longer runs to get the task done on free AI?"
-- See docs/scout-unread-and-long-runs-opusplan.md.

-- 1. When Jared last looked at a thread, and what a free run has done so far (carried hop to hop).
alter table public.admin_chat_threads add column if not exists read_at timestamptz;
alter table public.admin_chat_threads add column if not exists run_state jsonb;

-- 2. Backfill so he doesn't open to 400+ unread threads.
update public.admin_chat_threads set read_at = now() where read_at is null;

-- 3. The thread list gains unread + needs_you. Existing columns keep their order; new ones are appended.
--    needs_you: the latest unread assistant reply asks him something (a QUESTIONS card, a paid-AI yes, a stop
--    with "Keep going | Yes, use paid AI") or the thread has a Mac job waiting for his Run tap.
--    A plain OPTIONS: line does not count: Scout ends nearly every reply with one.
create or replace view public.admin_chat_thread_list with (security_invoker = on) as
select
  t.id,
  t.title,
  t.created_at,
  t.updated_at,
  (select count(*) from public.admin_chat_messages m where m.thread_id = t.id) as message_count,
  (select m.body from public.admin_chat_messages m where m.thread_id = t.id order by m.created_at desc limit 1) as last_body,
  (select count(*)::int from public.admin_chat_messages m
     where m.thread_id = t.id and m.role = 'assistant'
       and m.created_at > coalesce(t.read_at, '-infinity'::timestamptz)) as unread,
  (
    exists (select 1 from public.mac_jobs j where j.thread_id = t.id and j.status = 'proposed')
    or coalesce((
      select m.body ~ '(QUESTIONS:|NEEDS_YES|Yes, use paid AI|I.d need paid AI)'
      from public.admin_chat_messages m
      where m.thread_id = t.id and m.role = 'assistant'
        and m.created_at > coalesce(t.read_at, '-infinity'::timestamptz)
      order by m.created_at desc limit 1
    ), false)
  ) as needs_you
from public.admin_chat_threads t;

grant select on public.admin_chat_thread_list to authenticated;

-- 4. Mark a thread read (the window calls this while he is looking at it).
create or replace function public.admin_chat_mark_read(p_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_require_admin();
  update public.admin_chat_threads set read_at = now() where id = p_thread;
end;
$$;

revoke all on function public.admin_chat_mark_read(uuid) from public, anon;
grant execute on function public.admin_chat_mark_read(uuid) to authenticated;
