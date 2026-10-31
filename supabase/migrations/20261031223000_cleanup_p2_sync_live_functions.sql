-- 2026-10-31 admin cleanup part 2: sync repo copies of six functions Jared changed live on 2026-10-31.
-- Source of truth was the database (pg_get_functiondef); see bestly_memory key house/admin/cleanup-2026-10-31.
-- studio_calendar_watch: skip posting_paused brands, one studio.house-runway card.
-- bestly_raise: p_healed=true at severity info is an FYI (one monitor_event per 6 h, closes open card, never opens one).
-- car_telemetry_watchdog: car.telemetry.config once per daily telemetry_check result.
-- claims_res_from_claim_no: understands 'Claim ID: 1096164'.
-- client_ideas_watch: retired no-op (studio_inbox2_watch owns client ideas).
-- car_sentry_home_watchdog: resolves car.sentry_home when Sentry matches want.

CREATE OR REPLACE FUNCTION public.bestly_raise(p_key text, p_kind text, p_severity text DEFAULT 'warning'::text, p_title text DEFAULT NULL::text, p_body text DEFAULT NULL::text, p_area text DEFAULT NULL::text, p_needs_jared text DEFAULT NULL::text, p_healed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s   public.home_hub_settings;
  iss public.monitor_issues;
  v_sev  text := lower(coalesce(p_severity,'warning'));
  v_push boolean := false;
  v_prio int;
  v_bell text;
  o record;
begin
  if p_kind not in ('problem','resolved') then
    raise exception 'bestly_raise: unknown kind %', p_kind;
  end if;
  if v_sev not in ('info','warning','error') then v_sev := 'warning'; end if;

  select * into o from notification_owner(p_key);
  select * into s from home_hub_settings where id;
  select * into iss from monitor_issues where key = p_key for update;

  -- An info-level problem the watcher already healed is an FYI, not a card: log it (at most every 6 hours), close any old card, no push, no bell.
  if p_kind = 'problem' and p_healed and v_sev = 'info' then
    if iss.key is not null and iss.status = 'open' then
      update monitor_issues set status='resolved', resolved_at=now(), updated_at=now(), needs_jared=null where key = p_key;
      update admin_notifications set read_at = now() where entity_key = 'monitor:' || p_key and read_at is null and severity <> 'success';
    end if;
    if not exists (select 1 from monitor_events e where e.key = p_key and e.created_at > now() - interval '6 hours') then
      insert into monitor_events (key, kind, severity, title, body, pushed) values (p_key, 'problem', 'info', p_title, p_body, false);
    end if;
    return jsonb_build_object('ok', true, 'fyi', true, 'owner', o.slug);
  end if;

  if p_kind = 'problem' then
    if iss.key is null or iss.status = 'resolved' then
      insert into monitor_issues (key, status, severity, title, body, area, needs_jared, self_healed)
      values (p_key, 'open', v_sev, p_title, p_body, p_area, p_needs_jared, p_healed)
      on conflict (key) do update set
        status='open', severity=excluded.severity, title=excluded.title, body=excluded.body,
        area=excluded.area, needs_jared=excluded.needs_jared, self_healed=excluded.self_healed,
        opened_at=now(), updated_at=now(), resolved_at=null, last_pushed_at=null,
        occurrences = monitor_issues.occurrences + 1;
      v_push := not p_healed;
    else
      update monitor_issues set
        title=p_title, body=p_body, needs_jared=p_needs_jared, updated_at=now(),
        occurrences = occurrences + 1,
        severity = case when v_sev='error' then 'error' else severity end
      where key = p_key;
      v_push := not p_healed and (
        iss.last_pushed_at is null
        or iss.last_pushed_at < now() - make_interval(hours => coalesce(s.repush_hours, 6))
        or (v_sev='error' and iss.severity <> 'error'));
    end if;

    if v_push then
      v_prio := case v_sev when 'error' then 5 when 'warning' then 4 else 3 end;
      perform set_config('bestly.from', o.slug, true);
      perform bestly_ntfy(
        p_title,
        coalesce(p_body,'') || case when p_needs_jared is not null
                                    then E'\n\nNeeds you: ' || p_needs_jared else '' end,
        v_prio,
        array[case v_sev when 'error' then 'rotating_light' else 'warning' end, 'satellite']);
      perform set_config('bestly.from', '', true);
      update monitor_issues set last_pushed_at = now(), push_count = push_count + 1 where key = p_key;
    end if;

  else
    if iss.key is null or iss.status <> 'open' then
      return jsonb_build_object('ok', true, 'noop', true);
    end if;
    update monitor_issues set status='resolved', resolved_at=now(), updated_at=now(), needs_jared=null
     where key = p_key;
    if iss.last_pushed_at is not null then
      v_push := true;
      perform set_config('bestly.from', o.slug, true);
      perform bestly_ntfy(coalesce(nullif(p_title,''), 'Fixed: ' || iss.title), p_body, 3,
                          array['white_check_mark','satellite'], iss.severity = 'error');
      perform set_config('bestly.from', '', true);
    end if;
  end if;

  insert into monitor_events (key, kind, severity, title, body, pushed)
  values (p_key, p_kind, v_sev, p_title, p_body, v_push);

  v_bell := case when p_kind = 'resolved' then 'success'
                 when v_sev = 'error' then 'warning'
                 else v_sev end;

  if p_kind = 'problem' and exists (select 1 from admin_notifications
       where entity_key = 'monitor:' || p_key and read_at is null and severity <> 'success') then
    update admin_notifications set
      title = left(public.bell_title(o.name, p_title),200),
      body  = left(coalesce(p_body,'') || case when p_needs_jared is not null then ' — Needs you: ' || p_needs_jared else '' end, 600),
      severity = v_bell, agent_slug = o.slug
     where entity_key = 'monitor:' || p_key and read_at is null and severity <> 'success';
    return jsonb_build_object('ok', true, 'pushed', v_push, 'bell', 'refreshed', 'owner', o.slug);
  end if;
  if p_kind = 'resolved' then
    update admin_notifications set read_at = now()
     where entity_key = 'monitor:' || p_key and read_at is null and severity <> 'success';
  end if;

  insert into admin_notifications (kind, title, body, url, entity_key, severity, dedupe_key, agent_slug)
  values ('monitor', left(public.bell_title(o.name, p_title),200),
          left(coalesce(p_body,'') || case when p_needs_jared is not null
                                           then ' — Needs you: ' || p_needs_jared else '' end, 600),
          '/admin', 'monitor:' || p_key, v_bell,
          'monitor:' || p_key || ':' || p_kind || ':' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS'),
          o.slug)
  on conflict (dedupe_key) do nothing;

  return jsonb_build_object('ok', true, 'pushed', v_push, 'owner', o.slug);
end;
$function$;

CREATE OR REPLACE FUNCTION public.car_sentry_home_watchdog()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 c car_sentry_home; healed text[] := '{}'; bad text[] := '{}'; tz_out boolean; want text; unmet boolean; nb int;
begin
 select * into c from car_sentry_home where id = 1;
 if not c.enabled then return jsonb_build_object('skip', 'disabled'); end if;
 if c.last_tick_at is null or c.last_tick_at < now() - interval '15 minutes' then
  perform car_sentry_home_tick();
  healed := array_append(healed, 'the Sentry check had stalled (restarted)');
 end if;
 if not exists (select 1 from cron.job where jobname = 'car-sentry-home' and active) then
  perform cron.schedule('car-sentry-home', '3-59/5 * * * *', 'select public.car_sentry_home_tick()');
  healed := array_append(healed, 'its 5-minute schedule was missing (restored)');
 end if;
 select * into c from car_sentry_home where id = 1;
 select outage_since is not null into tz_out from tezlab_settings where id = 1;
 -- a stale Sentry reading only matters when we want it ON (or last saw it on); a sleeping car at home with Sentry off is fine
 if tezlab_ready() and not coalesce(tz_out, false) and (c.sentry_at is null or c.sentry_at < now() - interval '3 hours')
    and (coalesce(c.last_decision->>'want', '') = 'on' or coalesce(c.sentry_on, false)) then
  bad := array_append(bad, 'can''t see Sentry state from TezLab for over 3 hours');
 end if;
 want := c.last_decision->>'want';
 unmet := want is not null and coalesce((c.last_decision->>'s_fresh')::boolean, false) and c.sentry_on is distinct from (want = 'on');
 if unmet and c.attempts >= 3 and c.last_error is not null and coalesce(c.last_action_at, 'epoch') < now() - interval '60 minutes' then
  bad := array_append(bad, 'Sentry has not turned ' || want || ' in over an hour');
  if not exists (select 1 from monitor_issues where key = 'car.sentry_home' and status = 'open') then
   perform bestly_raise('car.sentry_home', 'problem', 'warning', 'Sentry won''t turn ' || want,
    'Last answer: ' || coalesce(c.last_error, 'none'), 'turo', 'Check Sentry in the Tesla app');
  end if;
 end if;
 if not unmet then perform bestly_raise('car.sentry_home', 'resolved', 'info', 'Sentry is ' || coalesce(want, 'as wanted') || ' now'); end if;
 nb := coalesce(array_length(bad, 1), 0);
 if nb > 0 or coalesce(array_length(healed, 1), 0) > 0 then
  perform bestly_raise('car.sentry_home.watch', 'problem', 'warning',
   case when nb > 0 then 'Sentry at home needs a look' else 'Sentry at home fixed itself' end,
   array_to_string(bad || healed, '; ') || '.', 'turo', case when nb > 0 then 'Check Sentry in the Tesla app' end, nb = 0);
 else
  perform bestly_raise('car.sentry_home.watch', 'resolved', 'warning', 'Sentry at home is healthy', 'Checks are passing.');
 end if;
 update car_sentry_home set last_watchdog_at = now() where id = 1;
 return jsonb_build_object('problems', bad, 'healed', healed);
end $function$;

CREATE OR REPLACE FUNCTION public.car_telemetry_watchdog()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s car_telemetry_settings; fs tesla_fleet_settings; v turo_vehicle_state; out jsonb := '{}'::jsonb;
  month_key text := to_char(now() at time zone 'UTC', 'YYYY-MM'); m_total numeric; stopped boolean;
  worker_ok boolean; beat_at timestamptz; cert_days numeric; fresh boolean; silent boolean := false; driving boolean := false;
  open_drive boolean; shift_d boolean; moved boolean := false; d_new car_trail; d_old car_trail; premium boolean; tr record; chk jsonb; prob text;
  quiet_min int;
begin
  select * into s from car_telemetry_settings where id = 1 for update;
  if not found or not s.enabled then return jsonb_build_object('skip', 'disabled'); end if;
  select * into fs from tesla_fleet_settings where id = 1;
  select * into v from turo_vehicle_state where vin = fs.vin;
  worker_ok := fs.worker_version is not null and semver_key(fs.worker_version) >= semver_key('1.9.0');

  -- (d) Tesla spend for the month reached the cap ($8): take the config off the car and say so. Fallback to TezLab stays on.
  select coalesce(sum(cost_usd), 0) into m_total from tesla_fleet_usage where at >= date_trunc('month', now() at time zone 'UTC');
  if coalesce(s.state->>'stopped_month', '') not in ('', month_key) then
    s.state := s.state - 'stopped_month';
    update car_telemetry_settings set state = s.state, updated_at = now() where id = 1;
    perform bestly_raise('car.telemetry.spend', 'resolved', 'info', null);
  end if;
  stopped := m_total >= fs.monthly_cap_usd or coalesce(s.state->>'stopped_month', '') = month_key;
  if stopped then
    if coalesce(s.state->>'stopped_month', '') <> month_key then
      if worker_ok and not exists (select 1 from tesla_fleet_commands where action = 'telemetry_delete' and status in ('queued','running')) then
        insert into tesla_fleet_commands (action, auto, args) values ('telemetry_delete', true, jsonb_build_object('why', 'monthly Tesla spend reached the cap'));
      end if;
      update car_telemetry_settings set state = state || jsonb_build_object('stopped_month', month_key), updated_at = now() where id = 1;
    end if;
    update car_telemetry_settings set fallback_until = now() + interval '30 minutes' where id = 1;
    perform bestly_raise('car.telemetry.spend', 'problem', 'warning', 'Live car location turned off: Tesla spend hit the cap',
      format('Tesla charges for this month reached $%s (cap $%s), so I took the streaming settings off the car. Blue Steel''s position is back to the TezLab updates (about every 15 min). Streaming can be turned back on next month.',
             to_char(m_total, 'FM990.00'), to_char(fs.monthly_cap_usd, 'FM990.00')), 'turo', null, false);
    return jsonb_build_object('stopped', 'spend', 'month_total', m_total);
  end if;

  -- (b) the receiver / forwarder on the Pi stopped checking in
  beat_at := (s.last_beat->>'at')::timestamptz;
  if beat_at is null or beat_at < now() - interval '3 minutes' then
    perform bestly_raise('car.telemetry.server', 'problem', 'warning', 'Live car location receiver on the Pi isn''t checking in',
      format('The program on the Pi that receives Blue Steel''s live location stopped reporting (last heard %s). Until it is back, the maps use TezLab updates (about every 15 min). Docker restarts it by itself; if this stays open, tell Claude "telemetry receiver down".',
             coalesce(to_char(beat_at at time zone 'America/Los_Angeles', 'Mon DD, FMHH12:MI AM'), 'never')), 'turo', null, false);
    out := out || '{"server":"down"}';
  else
    perform bestly_raise('car.telemetry.server', 'resolved', 'info', null);
  end if;

  -- (c) certificates: the server certificate is re-signed automatically at 45 days left, so under 21 means that failed;
  --     the config on the car is re-pushed by the daily check at 30 days left, so under 7 means that failed.
  cert_days := nullif(s.last_beat->>'cert_days_left', '')::numeric;
  if (cert_days is not null and cert_days < 21) or (s.exp_at is not null and s.exp_at < now() + interval '7 days') then
    perform bestly_raise('car.telemetry.cert', 'problem', 'warning', 'Live car location certificate is about to expire',
      format('%s%s Renewal runs by itself and it didn''t. Tell Claude "telemetry certificate".',
        case when cert_days is not null and cert_days < 21 then format('The Pi''s telemetry certificate has %s days left. ', round(cert_days)) else '' end,
        case when s.exp_at is not null and s.exp_at < now() + interval '7 days' then format('The streaming settings on the car expire %s. ', to_char(s.exp_at at time zone 'America/Los_Angeles', 'Mon DD')) else '' end),
      'turo', 'Tell Claude "telemetry certificate"', false);
  else
    perform bestly_raise('car.telemetry.cert', 'resolved', 'info', null);
  end if;

  -- latest telemetry_check outcome (the worker writes state.check)
  chk := s.state->'check';
  prob := nullif(chk->>'problem', '');
  if chk is not null and (chk->>'at')::timestamptz > now() - interval '26 hours' and prob is not null then
    -- raise once per daily check result, not every 2 minutes
    if not exists (select 1 from monitor_events e where e.key = 'car.telemetry.config' and e.kind = 'problem' and e.created_at >= (chk->>'at')::timestamptz) then
    perform bestly_raise('car.telemetry.config', 'problem', 'warning', 'Blue Steel isn''t set up for live location',
      case when prob = 'key_missing'
           then 'Tesla says the Bestly virtual key isn''t on the car, so I can''t send the streaming settings. This is the same thing as the Tesla re-pair alert; fixing that fixes this.'
           else 'The daily check found a problem: ' || left(prob, 240) || case when prob ilike '%stream%' and now() >= (timestamp '2026-10-26 00:00:00' at time zone 'America/Los_Angeles') then ' (Premium Connectivity ended Oct 25; streaming may not work on Standard Connectivity, maps keep using TezLab.)' else '' end end, 'turo', null, true);
    end if;
  else
    perform bestly_raise('car.telemetry.config', 'resolved', 'info', null);
  end if;

  -- (a)/(e) TezLab says the car is driving but no telemetry has arrived for 3 min
  fresh := s.last_record_at is not null and s.last_record_at > now() - interval '3 minutes';
  open_drive := exists (select 1 from car_drives where ended_at is null and started_at > now() - interval '12 hours');
  shift_d := v.vin is not null and v.observed_at > now() - interval '20 minutes' and coalesce(v.raw #>> '{fleet_api,shift}', '') = 'D';
  select * into d_new from car_trail where at > now() - interval '10 minutes' order by at desc limit 1;
  select * into d_old from car_trail where at > now() - interval '10 minutes' order by at asc limit 1;
  moved := d_new.id is not null and d_old.id is not null and d_new.id <> d_old.id and trip_dist_m(d_new.lat, d_new.lon, d_old.lat, d_old.lon) > 91.44;   -- 300 ft
  driving := open_drive or shift_d or moved;
  silent := driving and not fresh and s.last_push_at is not null;
  premium := now() >= (timestamp '2026-10-26 00:00:00' at time zone 'America/Los_Angeles');   -- after Oct 25, 2026 (Premium Connectivity ended)

  if silent then
    quiet_min := case when s.last_record_at is null then null else floor(extract(epoch from now() - s.last_record_at) / 60)::int end;
    update car_telemetry_settings set fallback_until = now() + case when premium then interval '12 hours' else interval '30 minutes' end,
      state = state || jsonb_build_object('silent_since', coalesce(s.state->>'silent_since', now()::text)), updated_at = now() where id = 1;
    if worker_ok and not exists (select 1 from tesla_fleet_commands where action = 'telemetry_check' and created_at > now() - interval '20 minutes') then
      insert into tesla_fleet_commands (action, auto, args) values ('telemetry_check', true, jsonb_build_object('why', 'silent while driving'));
    end if;
    perform bestly_raise('car.telemetry.silent', 'problem', 'warning', 'Live location went quiet while driving',
      format('TezLab shows Blue Steel driving but no live location has arrived%s. Using TezLab updates every 5 min until it resumes, and checking the car''s streaming settings.',
             case when quiet_min is null then '' else format(' for %s min', quiet_min) end), 'turo', null, true);
    if premium then
      perform bestly_raise('car.telemetry.premium', 'problem', 'warning', 'Streaming stopped after Premium ended',
        'Blue Steel drove after Tesla Premium Connectivity ended (Oct 25, 2026) and live location did not arrive. It may not stream on Standard Connectivity. The maps keep using TezLab updates (about every 15 min), which is the fallback that stays on.',
        'turo', null, false);
    end if;
    out := out || '{"silent":true}';
  else
    if fresh or not driving then
      perform bestly_raise('car.telemetry.silent', 'resolved', 'info', null);
      if fresh then
        perform bestly_raise('car.telemetry.premium', 'resolved', 'info', null);
        update car_telemetry_settings set fallback_until = null, state = state - 'silent_since', updated_at = now() where id = 1 and (fallback_until is not null or state ? 'silent_since');
      end if;
    end if;
  end if;

  -- 30 min after each trip ends: one telemetry_check
  if worker_ok and s.last_push_at is not null then
    for tr in select reservation_id from turo_trips where ends_at between now() - interval '60 minutes' and now() - interval '30 minutes'
                and coalesce(status, '') not in ('test','CANCELLED','CANCELED') loop
      if not exists (select 1 from tesla_fleet_commands where action = 'telemetry_check' and args->>'trip' = tr.reservation_id::text) then
        insert into tesla_fleet_commands (action, auto, args) values ('telemetry_check', true, jsonb_build_object('trip', tr.reservation_id, 'why', 'trip ended'));
        out := out || '{"trip_check":true}';
      end if;
    end loop;
  end if;
  return out || jsonb_build_object('driving', driving, 'fresh', fresh, 'silent', silent);
end $function$;

CREATE OR REPLACE FUNCTION public.claims_res_from_claim_no(p_subject text, p_body text)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.reservation_id from claim_cases c
   where c.turo_claim_no is not null
     and c.turo_claim_no = coalesce(substring(p_subject from '(?i)claim\s*(?:id|no\.?|number|#)?\s*:?\s*(\d{6,8})'),
                                    substring(p_body from '(?i)claim\s*(?:id|no\.?|number|#)?\s*:?\s*(\d{6,8})'))
   limit 1
$function$;

CREATE OR REPLACE FUNCTION public.client_ideas_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Superseded 2026-10-31: Inbox 2 (studio_inbox2_watch, card studio:inbox2:stale-ideas) watches the same client ideas. One card, not two.
  perform public.bestly_raise('studio:ideas-waiting', 'resolved', 'info', 'Folded into the Inbox card (studio:inbox2:stale-ideas)', null, 'ops');
  return jsonb_build_object('ok', true, 'superseded_by', 'studio_inbox2_watch');
end $function$;

CREATE OR REPLACE FUNCTION public.studio_calendar_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_qbeat timestamptz; v_last timestamptz; n int; v_bad text[] := '{}'; v_fixed text[] := '{}'; c record; v_run int;
  a record; v_today date; v_days int; v_cnt int; v_lastday date; v_label text; v_key text; k int; v_why text;
  v_empty text[] := '{}'; v_brand text;
begin
  select max(d.end_time) into v_last from cron.job j join cron.job_run_details d on d.jobid = j.jobid
   where j.jobname = 'studio-autopost-tick' and d.status = 'succeeded';
  if v_last is null or v_last < now() - interval '15 minutes' then
    perform public.studio_autopost_tick();
    v_fixed := v_fixed || 'autopost tick had not run in 15 minutes, ran it by hand'::text;
  end if;
  select count(*) into n from approval_items i join approval_clients ac on ac.id = i.client_id
   where ac.calendar_autopost and not coalesce(ac.sandbox, false) and i.posted_at is null and i.scheduled_at is null and not i.cal_hold
     and i.posting_ready_at < now() - interval '30 minutes' and public.studio_cal_ready(i.id)
     and not coalesce((public.posting_paused(case when ac.kind = 'house' then public.studio_brand_of(ac.id) else ac.social_brand end)->>'paused')::boolean, false);
  if n > 0 then v_bad := v_bad || (n || ' Ready post(s) have had no slot for 30+ minutes (calendar full or blocked)'); end if;
  select count(*) into n from approval_items i join approval_clients ac on ac.id = i.client_id
   where ac.calendar_autopost and not coalesce(ac.sandbox, false) and i.posted_at is null and not i.cal_hold and i.scheduled_at < now() - interval '30 minutes'
     and not exists (select 1 from social_posts sp where sp.approval_item_id = i.id and sp.status in ('posted','posting','in_drafts'))
     and not coalesce((public.posting_paused(case when ac.kind = 'house' then public.studio_brand_of(ac.id) else ac.social_brand end)->>'paused')::boolean, false);
  if n > 0 then v_bad := v_bad || (n || ' scheduled post(s) are 30+ minutes past their time and not out'); end if;
  select b.last_at into v_qbeat from studio_queue_watch_beat b where b.check_name = 'run';
  if v_qbeat is null or v_qbeat < now() - interval '15 minutes' then
    begin
      perform public.studio_queue_watch();
      v_fixed := v_fixed || 'queue watch had not run in 15 minutes, ran it by hand'::text;
    exception when others then
      v_bad := v_bad || ('queue watch is failing: ' || sqlerrm);
    end;
  end if;
  if coalesce(array_length(v_bad, 1), 0) > 0 then
    perform public.bestly_raise('studio:content-calendar', 'problem', 'warn', array_length(v_bad, 1) || ' content calendar problem(s)',
      array_to_string(v_bad || v_fixed, E'\n'), 'ops');
  else
    perform public.bestly_raise('studio:content-calendar', 'resolved', 'info',
      'Content calendar healthy' || case when array_length(v_fixed, 1) > 0 then ' (healed: ' || array_to_string(v_fixed, '; ') || ')' else '' end, null, 'ops');
  end if;
  for c in select ac.id, ac.name, ac.social_brand, coalesce(ac.sandbox, false) as sandbox from approval_clients ac where ac.calendar_autopost and ac.kind is distinct from 'house' loop
    if c.sandbox then
      perform public.bestly_raise('studio:content-runway:' || c.id, 'resolved', 'info', c.name || ': test client, ignored', null, 'ops');
      continue;
    end if;
    select count(*) into v_run from approval_items i where i.client_id = c.id and i.posted_at is null and i.scheduled_at > now();
    if v_run < 3 then
      perform public.bestly_raise('studio:content-runway:' || c.id, 'problem', 'info',
        c.name || ': only ' || v_run || ' post(s) scheduled ahead', 'Spark needs to make more posts to keep the 5-a-week plan.', 'ops');
    else
      perform public.bestly_raise('studio:content-runway:' || c.id, 'resolved', 'info', c.name || ': ' || v_run || ' posts scheduled ahead', null, 'ops');
    end if;
  end loop;
  for a in
    select public.studio_acct(ac.id)->>'id' as acct, (array_agg(ac.id order by ac.id::text))[1] as lead,
           count(*) as nclients, min(ac.name) as cname, min(public.studio_acct(ac.id)->>'handle') as handle
      from approval_clients ac
     where ac.calendar_autopost and not coalesce(ac.sandbox, false) and ac.kind = 'house' and public.studio_acct(ac.id)->>'id' is not null
     group by 1
  loop
    v_key := 'studio.house-runway.' || a.acct;
    v_label := case when a.nclients > 1 then a.handle else a.cname end;
    v_brand := public.studio_brand_of(a.lead);
    perform public.bestly_raise(v_key, 'resolved', 'info', v_label || ': folded into the Studio runway card', null, 'studio', null, true);
    if coalesce((public.posting_paused(v_brand)->>'paused')::boolean, false) then continue; end if;
    v_today := (now() at time zone coalesce((select tz from social_brand_settings where brand = v_brand), 'America/Los_Angeles'))::date;
    v_days := 0;
    for k in 0..2 loop
      v_why := public.studio_cal_day_check(a.lead, v_today + k, null, true);
      if v_why is null or v_why in ('day_taken', 'too_close', 'similar_nearby') then v_days := v_days + 1; end if;
    end loop;
    select count(*) into v_cnt from approval_items i
     where i.client_id = any(public.studio_group(a.lead)) and i.posted_at is null
       and public.studio_item_day(i.client_id, null, i.scheduled_at, i.scheduled_for) between v_today and v_today + 2;
    if v_cnt = 0 and v_days > 0 then
      v_empty := v_empty || coalesce(a.handle, v_label);
    end if;
  end loop;
  if coalesce(array_length(v_empty, 1), 0) > 0 then
    perform public.bestly_raise('studio.house-runway', 'problem', 'info',
      array_length(v_empty, 1) || ' brand(s) have nothing approved for the next 3 days',
      'Nothing approved is dated for the next 3 days on: ' || array_to_string(v_empty, ', ') || '. Approve more in Studio (Drafts, To review) and Spark dates them. Paused brands are not counted. Spark.',
      'studio', 'Approve posts in Studio for: ' || array_to_string(v_empty, ', '), false);
  else
    perform public.bestly_raise('studio.house-runway', 'resolved', 'info', 'Every active brand has approved posts dated ahead', null, 'studio', null, false);
  end if;
  return jsonb_build_object('ok', true, 'problems', to_jsonb(v_bad), 'fixed', to_jsonb(v_fixed), 'empty_brands', to_jsonb(v_empty));
end $function$;
