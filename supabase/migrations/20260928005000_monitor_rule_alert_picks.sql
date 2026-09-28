-- Refresh's Monitor to-do rule also covers Scout picks that came from Alerts (2026-09-27).
-- Case: the quick win "Add https://api.bigdatacloud.net to CSP connect-src" (from Alerts) stayed open and sat on
-- the wall as "the one thing" after the CSP was fixed and monitor partner.csp.connect-src resolved (12:30 PM).
-- Same matching as before: a resolved monitor issue whose last key segment (8+ chars, with a hyphen) is in the title.
create or replace function public.todo_monitor_rules(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t record; m record; closed jsonb := '[]'::jsonb; v_why text;
begin
  if not coalesce((select auto_close from todo_check_settings where id = 1), false) then
    return closed;
  end if;
  for t in
    select d.id, d.title, d.action,
           lower(translate(d.title, E'‐‑‒–—', '-----')) as norm
      from scout_daily d
     where d.status = 'open' and d.kind = 'pick' and d.action->>'from' in ('Monitor', 'Alerts')
       and not coalesce((d.action->>'reopened_by_jared')::boolean, false)
  loop
    select mi.key, mi.resolved_at into m
      from monitor_issues mi
     where mi.status = 'resolved'
       and length(regexp_replace(mi.key, '^.*[.:]', '')) >= 8
       and regexp_replace(mi.key, '^.*[.:]', '') like '%-%'
       and position(lower(regexp_replace(mi.key, '^.*[.:]', '')) in t.norm) > 0
     order by mi.resolved_at desc limit 1;
    continue when m.key is null;
    v_why := 'Its monitor (' || m.key || ') marked it fixed at ' || la_time12(m.resolved_at) || '.';
    update scout_daily
       set status = 'done', done_at = now(),
           action = coalesce(action, '{}'::jsonb)
             || jsonb_build_object('check', jsonb_build_object('verdict', 'done', 'confidence', 1, 'summary', v_why,
                                     'at', now(), 'model', 'rule', 'auto_closed', true, 'evidence', '[]'::jsonb))
             || jsonb_build_object('auto_closed', jsonb_build_object('rule', 'monitor', 'at', now()))
     where id = t.id and status = 'open';
    insert into admin_needs_checks (run_id, key, title, status, rule, verdict, confidence, summary, closed, finished_at)
    values (p_run, 'todo:' || t.id, t.title, 'done', 'monitor', 'done', 1, v_why, true, now());
    closed := closed || jsonb_build_object('key', 'todo:' || t.id, 'title', t.title, 'why', v_why);
  end loop;
  return closed;
end $$;
revoke all on function public.todo_monitor_rules(uuid) from public, anon, authenticated;
grant execute on function public.todo_monitor_rules(uuid) to service_role;
