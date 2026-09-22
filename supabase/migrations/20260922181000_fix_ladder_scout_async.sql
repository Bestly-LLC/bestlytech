-- Scout's rung runs in the background: the ladder opens a Scout thread, sends the ask, and reads
-- the answer from that thread on a later tick (a Scout turn can outlast one function call).
alter table public.monitor_issues add column if not exists scout_thread uuid, add column if not exists scout_started_at timestamptz;

create or replace function public.monitor_issue_ladder()
returns trigger language plpgsql set search_path = public as $$
declare last_ok text; last_by text;
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    new.fix_stage := 'auto'; new.fix_log := '[]'::jsonb; new.fix_note := null; new.ai_diagnosis := null;
    new.scout_ask := null; new.claude_prompt := null; new.fix_next_at := now();
    new.scout_thread := null; new.scout_started_at := null;
  elsif tg_op = 'UPDATE' and new.status = 'resolved' and old.status = 'open' then
    select e->>'text', e->>'by' into last_ok, last_by
      from jsonb_array_elements(new.fix_log) with ordinality x(e, i)
     where (e->>'ok')::boolean is true order by i desc limit 1;
    new.fix_stage := 'fixed';
    new.fix_note := coalesce(
      case when last_ok is not null then initcap(replace(coalesce(last_by,'auto'),'_',' ')) || ': ' || last_ok end,
      case when coalesce(new.heal_attempts,0) > 0
           then 'Auto-fix retried it ' || new.heal_attempts || ' time' || case when new.heal_attempts = 1 then '' else 's' end || ' until it cleared.' end,
      'It cleared on its own (the check passes again). Nothing needed from you.');
  end if;
  return new;
end $$;
