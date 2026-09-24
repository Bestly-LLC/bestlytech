-- 2026-09-24 outage audit.
-- talk_outbox_take(): "column reference room is ambiguous" (525 errors/day): the OUT column `room` clashed with
-- talk_outbox.room in the unqualified UPDATE, so the Talk outbox never delivered. Qualify every column.
create or replace function public.talk_outbox_take()
returns table(kind text, line text, ids uuid[], room text)
language plpgsql security definer set search_path to 'public' as $function$
#variable_conflict use_column
begin
  update public.talk_outbox o set sent_at = now(), error = coalesce(o.error,'') || ' (gave up)'
   where o.sent_at is null and o.created_at < now() - interval '1 day';
  update public.talk_outbox o set sent_at = now(), error = 'no client room'
   where o.sent_at is null and o.room is null;
  return query
    with g as (
      select t.room as g_room, t.kind as g_kind, coalesce(t.dedupe, t.id::text) as k, count(*) as n,
             min(t.line) as one, min(t.many) as many, array_agg(t.id) as g_ids,
             min(t.created_at) as first, max(t.created_at) as last, bool_or(t.dedupe is not null) as folds
        from public.talk_outbox t where t.sent_at is null group by 1, 2, 3)
    select g.g_kind,
           case when g.n > 1 and g.many is not null then replace(g.many, '{n}', g.n::text) else g.one end,
           g.g_ids, g.g_room
      from g
     where not g.folds or g.last < now() - interval '2 minutes'
     order by g.first;
end $function$;

-- monitor_events has occurred_at; an admin view asks for created_at (29 errors/day). Mirror it.
alter table public.monitor_events add column if not exists created_at timestamptz generated always as (occurred_at) stored;
