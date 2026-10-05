-- Edge Guard alerts are signed by Edge Guard (admin_notifications.agent_slug), like every other employee's alerts.
create or replace function public.edge_guard_note_t(
  p_token text, p_site text, p_state text, p_action text, p_detail text default null, p_alert jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_title text; v_res jsonb := '{}'::jsonb;
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  insert into edge_guard_log (site, state, action, detail)
  values (left(coalesce(p_site, 'guard'), 80), left(coalesce(p_state, 'ok'), 40), left(coalesce(p_action, 'none'), 80), left(p_detail, 1500));
  if p_alert is not null and p_alert ? 'title' then
    v_title := p_alert->>'title';
    if v_title not like 'Edge Guard%' then v_title := 'Edge Guard: ' || v_title; end if;
    v_res := scout_notify(v_title, p_alert->>'body', coalesce(p_alert->>'severity', 'info'),
                          coalesce((p_alert->>'push')::boolean, false), coalesce(p_alert->>'url', '/admin/team'),
                          p_alert->>'dedupe');
    if p_alert->>'dedupe' is not null then
      update admin_notifications set agent_slug = 'edge-guard'
       where dedupe_key = p_alert->>'dedupe' and agent_slug is null;
    end if;
  end if;
  if random() < 0.02 then delete from edge_guard_log where at < now() - interval '60 days'; end if;
  return v_res;
end $$;
revoke all on function public.edge_guard_note_t(text, text, text, text, text, jsonb) from public;
grant execute on function public.edge_guard_note_t(text, text, text, text, text, jsonb) to anon, authenticated, service_role;

update public.admin_notifications set agent_slug = 'edge-guard'
 where title like 'Edge Guard%' and agent_slug is null;
