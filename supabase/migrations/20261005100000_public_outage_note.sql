-- 2026-10-05: the "We'll be right back" page on /admin shows Scout's last known reason.
--
-- Source: ops_incidents, the log the watchdog writes (component, symptom, started/ended, who fixed it).
-- The page runs when the app itself has crashed, so it can't rely on a login: this RPC is readable by
-- anon. It returns a fixed plain-English vocabulary only - never the raw symptom text, the detail
-- jsonb, the action log or source host names.

create or replace function public.get_outage_note()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object(
        'ongoing',    i.ended_at is null,
        'started_at', i.started_at,
        'ended_at',   i.ended_at,
        'what', case
                  when i.component in ('db', 'database') then 'the database'
                  else 'one of our systems'
                end,
        'how', case
                 when i.symptom = 'slow' then 'was running slowly'
                 when i.symptom = 'down' or i.symptom ilike '%froze%' then 'stopped responding'
                 else 'had a problem'
               end,
        'fixed_by', case
                      when i.ended_at is null or i.resolved_by is null then null
                      when i.resolved_by = 'hygiene' then 'an automatic cleanup'
                      else 'Scout'
                    end
      )
      from public.ops_incidents i
      order by i.started_at desc
      limit 1),
    '{}'::jsonb
  );
$$;

revoke all on function public.get_outage_note() from public;
grant execute on function public.get_outage_note() to anon, authenticated;
