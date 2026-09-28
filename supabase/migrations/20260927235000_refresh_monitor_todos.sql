-- Refresh also clears Monitor to-dos whose monitor says fixed (2026-09-27).
-- Case: Scout's pick "Fix the failing trip-guest-push scheduled job" stayed open after the job was fixed
-- (monitor cron.trip-guest-push resolved 10:00 AM) because the to-do checker never looks at monitor_issues and
-- the free AI was out. Now admin_needs_rules() (the Refresh button) also closes an open Scout pick from
-- Monitor when a monitor issue named in its title (e.g. "trip-guest-push") is resolved. No AI, obeys the
-- to-do auto-close switch, one tap to undo ("todo:<id>" keys reopen through admin_today_undo).

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
           -- unicode hyphens (Scout writes U+2011) become plain ones so names like trip-guest-push match
           lower(translate(d.title, E'\u2010\u2011\u2012\u2013\u2014', '-----')) as norm
      from scout_daily d
     where d.status = 'open' and d.kind = 'pick' and d.action->>'from' = 'Monitor'
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

-- Refresh entry point stays admin_needs_rules (what todo-check calls): the Needs-you rules move to
-- admin_needs_rules_core, and the wrapper adds the Monitor to-do rule to the same "closed" list.
alter function public.admin_needs_rules(uuid) rename to admin_needs_rules_core;
revoke all on function public.admin_needs_rules_core(uuid) from public, anon;
grant execute on function public.admin_needs_rules_core(uuid) to authenticated, service_role;

create or replace function public.admin_needs_rules(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare r jsonb;
begin
  if auth.uid() is not null then
    perform public.admin_require_admin();
  end if;
  r := public.admin_needs_rules_core(p_run);
  return jsonb_set(r, '{closed}', coalesce(r->'closed', '[]'::jsonb) || public.todo_monitor_rules(p_run));
end $$;
revoke all on function public.admin_needs_rules(uuid) from public, anon;
grant execute on function public.admin_needs_rules(uuid) to authenticated, service_role;

-- Undo reopens a to-do the rule closed, and marks it so the rule leaves it alone from then on.
create or replace function public.admin_today_undo(p_key text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare did boolean := false;
begin
  perform public.admin_require_admin();
  delete from public.admin_today_dismissed where key = p_key;
  did := found;
  if split_part(p_key, ':', 1) = 'bell' then
    update public.admin_notifications set read_at = null
     where id::text = substr(p_key, 6) and read_at is not null;
    did := did or found;
  elsif split_part(p_key, ':', 1) = 'todo' then
    update public.scout_daily
       set status = 'open', done_at = null,
           action = (coalesce(action, '{}'::jsonb) - 'auto_closed') || '{"reopened_by_jared": true}'::jsonb
     where id::text = substr(p_key, 6) and status = 'done';
    did := did or found;
  end if;
  update public.admin_needs_checks set undone_at = now()
   where id = (select id from public.admin_needs_checks where key = p_key and closed and undone_at is null
                order by created_at desc limit 1);
  return did;
end $$;
