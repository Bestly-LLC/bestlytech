-- B2 (wall feedback 2026-09-27): Jared's Bestly to-dos <-> Home Assistant to-do list "Bestly".
-- The Pi service /opt/bestly/ha-todo-sync (systemd timer, every minute) calls ha_todo_sync()
-- with the Home Hub agent key (same gate as wall_pi_trips). Watchdog: ha_todo_sync_watch()
-- raises Scout incident ha.todo_sync when there has been no good sync for 10 minutes.

create table if not exists public.ha_todo_sync_status (
  id            int primary key default 1 check (id = 1),
  last_ok       timestamptz,
  last_error    text,
  last_error_at timestamptz,
  stats         jsonb not null default '{}'::jsonb
);
alter table public.ha_todo_sync_status enable row level security;
insert into public.ha_todo_sync_status (id, last_ok) values (1, now()) on conflict do nothing;  -- grace period while the Pi service starts

-- The list Jared sees under "You" on admin Today: his open call to-dos from the last 7 days + today's open picks.
create or replace function public.ha_todo_sync(p_token text, p_known uuid[] default '{}', p_ops jsonb default '[]'::jsonb,
                                               p_error text default null, p_stats jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  op jsonb;
  v_id uuid;
  v_added jsonb := '{}'::jsonb;
  v_applied int := 0;
  v_title text;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;

  if p_error is not null then
    update ha_todo_sync_status set last_error = left(p_error, 500), last_error_at = now() where id = 1;
    return jsonb_build_object('ok', false);
  end if;

  for op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    if op->>'op' in ('done', 'open', 'dismiss') then
      -- same write as scout_daily_set() (the admin "Done" / "Put back" tap), limited to Jared's to-dos
      update scout_daily
         set status = case op->>'op' when 'done' then 'done' when 'open' then 'open' else 'dismissed' end,
             done_at = case when op->>'op' = 'open' then null else now() end
       where id = (op->>'id')::uuid
         and kind in ('call', 'pick')
         and (kind = 'pick' or lower(coalesce(action->>'owner', 'jared')) = 'jared')
         and status is distinct from case op->>'op' when 'done' then 'done' when 'open' then 'open' else 'dismissed' end;
      if found then v_applied := v_applied + 1; end if;
    elsif op->>'op' = 'add' then
      v_title := left(btrim(regexp_replace(coalesce(op->>'title', ''), '\s+', ' ', 'g')), 200);
      if v_title = '' or coalesce(op->>'uid', '') = '' then continue; end if;
      insert into scout_daily (day, kind, title, why, body, action, source_key)
      values (v_today, 'call', v_title, 'Jared · Added in Home Assistant', nullif(left(op->>'note', 1000), ''),
              jsonb_build_object('owner', 'Jared', 'source', 'home_assistant', 'ha_uid', op->>'uid'),
              'ha:' || left(op->>'uid', 80))
      on conflict (day, kind, source_key) do nothing
      returning id into v_id;
      if v_id is null then
        select id into v_id from scout_daily where kind = 'call' and source_key = 'ha:' || left(op->>'uid', 80)
         order by created_at desc limit 1;
      end if;
      v_added := v_added || jsonb_build_object(op->>'uid', v_id);
      v_applied := v_applied + 1;
      v_id := null;
    end if;
  end loop;

  update ha_todo_sync_status set last_ok = now(), stats = coalesce(p_stats, stats) where id = 1;

  return jsonb_build_object(
    'ok', true,
    'applied', v_applied,
    'added', v_added,
    'open', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'title', s.title,
                                                          'note', nullif(regexp_replace(coalesce(s.why, ''), '^[^·]*·\s*', ''), ''))
                                       order by s.kind desc, s.created_at)
                        from scout_daily s
                       where s.status = 'open'
                         and ((s.kind = 'call' and s.day >= v_today - 7 and lower(coalesce(s.action->>'owner', 'jared')) = 'jared')
                              or (s.kind = 'pick' and s.day = v_today))), '[]'::jsonb),
    'known', coalesce((select jsonb_object_agg(s.id, s.status) from scout_daily s where s.id = any (coalesce(p_known, '{}'))), '{}'::jsonb));
end $function$;

revoke all on function public.ha_todo_sync(text, uuid[], jsonb, text, jsonb) from public;
grant execute on function public.ha_todo_sync(text, uuid[], jsonb, text, jsonb) to anon, authenticated, service_role;

-- Watchdog: no good sync for 10 minutes -> Scout incident; resolves itself when syncs resume.
create or replace function public.ha_todo_sync_watch()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare s ha_todo_sync_status;
begin
  select * into s from ha_todo_sync_status where id = 1;
  if s.last_ok is null or s.last_ok < now() - interval '10 minutes' then
    perform bestly_raise('ha.todo_sync', 'problem', 'warning',
      'Home Assistant to-do sync stopped',
      'Your Bestly to-dos have not synced with the Home Assistant "Bestly" list since '
        || coalesce(to_char(s.last_ok at time zone 'America/Los_Angeles', 'FMHH12:MI AM Mon DD'), 'it was set up') || '.'
        || coalesce(' Last error: ' || s.last_error, ''),
      'home', null, false);
    return jsonb_build_object('ok', false);
  end if;
  if exists (select 1 from monitor_issues where key = 'ha.todo_sync' and status <> 'resolved') then
    perform bestly_raise('ha.todo_sync', 'resolved', 'info', 'Home Assistant to-do sync is back', null, 'home', null, true);
  end if;
  return jsonb_build_object('ok', true);
end $function$;

revoke all on function public.ha_todo_sync_watch() from public, anon, authenticated;

select cron.schedule('ha-todo-sync-watch', '*/5 * * * *', $$select public.ha_todo_sync_watch()$$);
