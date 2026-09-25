CREATE OR REPLACE FUNCTION public.ops_watchdog_report(p_source text, p_state text, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare inc public.ops_incidents; pb public.ops_playbook; t0 timestamptz; res jsonb; v_ok boolean; mins int;
begin
  perform set_config('statement_timeout', '30s', true);
  p_source := left(coalesce(p_source,'?'), 40);
  select * into inc from ops_incidents where component = 'db' and ended_at is null order by id desc limit 1;

  if p_state = 'up' then
    if inc.id is null then return jsonb_build_object('ok', true, 'noop', true); end if;
    mins := greatest(1, extract(epoch from now() - inc.started_at)::int / 60);
    update ops_playbook p set wins = wins + 1
     where p.action in (select a->>'action' from jsonb_array_elements(inc.actions) a
                         where (a->>'at')::timestamptz > now() - interval '3 minutes');
    update ops_incidents set ended_at = now(),
      resolved_by = coalesce((select string_agg(distinct a->>'action', ',') from jsonb_array_elements(inc.actions) a
                               where (a->>'at')::timestamptz > now() - interval '3 minutes'), 'recovered on its own'),
      detail = detail || jsonb_build_object('recovered_seen_by', p_source)
     where id = inc.id returning * into inc;
    if coalesce((inc.detail->>'alerted')::boolean, false) then
      begin
        perform bestly_raise('ops:db-down', 'resolved', 'error',
          'Studio is back (' || mins || ' min outage)',
          'Recovered via: ' || inc.resolved_by || '. Logged as incident #' || inc.id || '.', 'ops');
      exception when others then null; end;
    end if;
    return jsonb_build_object('ok', true, 'closed', inc.id, 'minutes', mins, 'resolved_by', inc.resolved_by);
  end if;

  if p_state not in ('down','slow') then return jsonb_build_object('ok', false, 'error', 'bad state'); end if;
  if inc.id is null then
    insert into ops_incidents (symptom, detail, source)
    values (p_state, coalesce(p_detail,'{}') - 'secret', p_source) returning * into inc;
  elsif p_state = 'down' and inc.symptom = 'slow' then
    update ops_incidents set symptom = 'down' where id = inc.id returning * into inc;
  end if;

  if not coalesce((inc.detail->>'alerted')::boolean, false)
     and (p_state = 'down' or now() - inc.started_at >= interval '3 minutes') then
    begin
      perform bestly_raise('ops:db-down', 'problem', 'error', 'Studio database is ' || p_state,
        'Watchdog (' || p_source || ') saw it. Self-heal is running; you will get a note when it recovers.', 'ops',
        null, false);
      update ops_incidents set detail = detail || '{"alerted":true}'::jsonb where id = inc.id returning * into inc;
    exception when others then null; end;
  end if;

  select p.* into pb from ops_playbook p
   where p.tier = 1 and p.enabled
     and not exists (select 1 from ops_heal_throttle h where h.action = p.action and h.last_at > now() - interval '60 seconds')
   order by (p.wins + 1)::float / (p.tries + 2) desc, p.action
   limit 1;
  if pb.action is null then return jsonb_build_object('ok', true, 'incident', inc.id, 'action', null, 'why', 'cooldown'); end if;

  insert into ops_heal_throttle values (pb.action, now()) on conflict (action) do update set last_at = now();
  t0 := clock_timestamp();
  begin
    res := case pb.action
      when 'hygiene' then ops_db_hygiene()
      when 'cancel_long' then ops_cancel_long(90, false)
      when 'terminate_long' then ops_cancel_long(180, true)
    end;
    v_ok := true;
  exception when others then res := jsonb_build_object('error', sqlerrm); v_ok := false;
  end;
  update ops_playbook set tries = tries + 1, last_at = now() where action = pb.action;
  update ops_incidents set actions = actions || jsonb_build_array(jsonb_build_object(
      'action', pb.action, 'at', now(), 'ok', v_ok, 'ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int, 'result', res))
   where id = inc.id;
  return jsonb_build_object('ok', true, 'incident', inc.id, 'action', pb.action, 'result', res);
end $function$;

CREATE OR REPLACE FUNCTION public.demo_key_tick()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare d demo_key; fs tesla_fleet_settings; ids jsonb; out jsonb := '{}'::jsonb;
begin
  select * into d from demo_key where id = 1;
  select * into fs from tesla_fleet_settings where id = 1;
  if fs.connected_at is null then return jsonb_build_object('off','tesla not connected'); end if;
  if d.status = 'creating' and d.updated_at < now() - interval '20 minutes' and not demo_key_busy() then
    update demo_key set status = 'failed', fails = fails + 1, last_error = coalesce(last_error, 'Worker never answered'), updated_at = now() where id = 1;
    d.status := 'failed';
  end if;
  select jsonb_agg(share_user_id) into ids from demo_key_drivers where removed_at is null and remove_at <= now();
  if ids is not null and demo_key_enqueue('key_remove', jsonb_build_object('only', ids, 'baseline', '[]'::jsonb)) then
    out := out || jsonb_build_object('remove', ids);
  end if;
  if not d.enabled then
    if d.invite_id is not null and demo_key_enqueue('key_remove', jsonb_build_object('invite_id', d.invite_id, 'only', '["none"]'::jsonb, 'baseline','[]'::jsonb, 'revoke_only', true)) then
      out := out || '{"revoke":true}';
    end if;
    return out;
  end if;
  if d.status = 'ready' and d.invite_expires_at < now() + interval '10 minutes' then
    update demo_key set status = 'none', updated_at = now() where id = 1; d.status := 'none';
  end if;
  if (d.status = 'none' or (d.status = 'failed' and d.fails < 5 and d.updated_at < now() - interval '10 minutes'))
     and coalesce(d.last_view_at, 'epoch') > now() - interval '7 days' and demo_key_enqueue('key_create') then
    update demo_key set status = 'creating', updated_at = now() where id = 1;
    out := out || '{"create":true}';
  end if;
  if d.status = 'ready' and d.last_view_at > now() - interval '30 minutes' and coalesce(d.last_check_at,'epoch') < now() - interval '5 minutes'
     and demo_key_enqueue('key_check', jsonb_build_object('baseline', demo_key_baseline())) then
    update demo_key set last_check_at = now() where id = 1;
  end if;
  if d.status = 'ready' and d.last_view_at > now() - interval '15 minutes'
     and (
       exists (select 1 from tesla_fleet_commands where args->>'demo'='true' and action='key_check'
               and status <> 'done' and created_at between now() - interval '30 minutes' and now() - interval '3 minutes')
       or not exists (select 1 from tesla_fleet_commands where args->>'demo'='true' and action='key_check'
               and status='done' and created_at > now() - interval '20 minutes')
     ) then
    perform scout_notify('Demo key checks are stuck', 'The demo page is open but Tesla driver checks haven''t finished, so the page will sit on "Checking with Tesla". Check the Tesla worker on the Mac.',
      'warning', true, '/admin/turo/settings#demo-key', 'demo-key-check-stuck-' || to_char(now(),'YYYYMMDDHH24'));
  end if;
  if exists (select 1 from demo_key_drivers where removed_at is null and remove_at < now() - interval '30 minutes') then
    perform scout_notify('Demo driver still on Blue Steel', 'A driver added from the demo page wasn''t removed on time. Retrying every 5 min. Check Tesla app > Add Driver, or Turo settings > Demo key.',
      'critical', true, '/admin/turo/settings#demo-key', 'demo-key-stuck-' || to_char(now(),'YYYYMMDDHH24'));
  end if;
  if d.status = 'failed' and d.fails >= 3 then
    perform scout_notify('Demo key can''t be made', coalesce(d.last_error,'unknown error') || '. The demo falls back to the pretend key.', 'warning', false,
      '/admin/turo/settings#demo-key', 'demo-key-fail-' || to_char(now(),'YYYYMMDD'));
  end if;
  return out;
end $function$;
