-- Sentry off at home / on when away (Car Guard). Ships enabled in dry run.
-- 0) Undo copy of the functions we replace (saved before any change)
insert into bestly_memory(area,key,title,body,kind,source,written_by)
select 'home','house/turo/sentry-home-undo-2026-10-13','UNDO: car_protect_tick, car_protect_watchdog, car_raw_store(jsonb) before Sentry-at-home (Oct 13)',
  pg_get_functiondef('public.car_protect_tick'::regproc)||E'\n\n'||pg_get_functiondef('public.car_protect_watchdog'::regproc)||E'\n\n'||pg_get_functiondef('public.car_raw_store(jsonb)'::regprocedure)||E'\n\nRollback: see the decision row house/turo/sentry-home.','note','claude-code','claude'
where not exists (select 1 from bestly_memory where key='house/turo/sentry-home-undo-2026-10-13');

-- 1) Fix the frozen TezLab feed: two car_raw_store overloads made PostgREST answer HTTP 300 (ambiguous), so row 1 stopped updating on 2026-09-25.
drop function if exists public.car_raw_store(jsonb);
-- 2) State table
create table if not exists public.car_sentry_home(
  id int primary key default 1 check (id = 1),
  enabled bool not null default false,
  dry_run bool not null default true,
  in_m int not null default 250,
  out_m int not null default 300,
  settle_min int not null default 10,
  zone text, zone_since timestamptz,
  override text, override_at timestamptz,
  job_id bigint, job_kind text,
  attempts int not null default 0,
  next_try_at timestamptz,
  last_action text, last_action_at timestamptz,
  confirmed_at timestamptz,
  last_error text,
  sentry_on bool, sentry_at timestamptz,
  nudge_at timestamptz,
  last_decision jsonb,
  last_tick_at timestamptz,
  last_watchdog_at timestamptz,
  updated_at timestamptz default now()
);
alter table public.car_sentry_home enable row level security;
insert into public.car_sentry_home(id) values (1) on conflict do nothing;
insert into public.notification_owners(prefix, agent_slug, note) values ('car.sentry_home','car-guard','Sentry off at home / on when away') on conflict do nothing;

-- 3) Helpers
create or replace function public.car_sentry_now()
returns table(sentry_on boolean, seen_at timestamptz, src text)
language sql stable security definer set search_path = public as $$
  with a as (
    select (raw->'security'->>'monitoring_active')::boolean as v,
           least(coalesce(nullif(raw->>'last_updated','')::timestamptz, at), at) as t, 'tezlab'::text as s
      from car_status_raw where id = 1 and jsonb_typeof(raw->'security'->'monitoring_active') = 'boolean'
    union all
    select (raw->>'sentry')::boolean, at, 'fleet'::text
      from car_status_raw where id = 2 and jsonb_typeof(raw->'sentry') = 'boolean'
  )
  select v, t, s from a order by t desc limit 1
$$;

create or replace function public.sentry_home_live()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select enabled and not dry_run from car_sentry_home where id = 1), false)
$$;
-- 4) Pure decision function: everything it needs is passed in p
create or replace function public.car_sentry_home_decide(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  now_ timestamptz := (p->>'now')::timestamptz;
  obs timestamptz := nullif(p->>'observed_at','')::timestamptz;
  dist float8 := nullif(p->>'dist_m','')::float8;
  in_m float8 := coalesce((p->>'in_m')::float8, 250);
  out_m float8 := coalesce((p->>'out_m')::float8, 300);
  settle int := coalesce((p->>'settle_min')::int, 10);
  fresh boolean := obs is not null and obs > now_ - interval '25 minutes';
  spot text := p->>'spot';
  low_battery boolean := coalesce((p->>'battery_pct')::int, 0) < coalesce((p->>'floor')::int, 40);
  in_trip boolean := coalesce((p->>'in_trip')::boolean, false);
  tz_up boolean := coalesce((p->>'tezlab_up')::boolean, false);
  job_open boolean := coalesce((p->>'job_open')::boolean, false);
  admin_on boolean := coalesce((p->>'admin_on_since_zone')::boolean, false);
  zone text := p->>'zone';
  zone_since timestamptz := nullif(p->>'zone_since','')::timestamptz;
  ovr text := p->>'override';
  la text := p->>'la';
  la_at timestamptz := nullif(p->>'la_at','')::timestamptz;
  conf_at timestamptz := nullif(p->>'conf_at','')::timestamptz;
  s_on boolean := (p->>'sentry_on')::boolean;
  s_at timestamptz := nullif(p->>'sentry_at','')::timestamptz;
  attempts int := coalesce((p->>'attempts')::int, 0);
  nxt timestamptz := nullif(p->>'next_try_at','')::timestamptz;
  nudge_at timestamptz := nullif(p->>'nudge_at','')::timestamptz;
  nz text; changed boolean := false; s_fresh boolean; want text; nudge boolean; send boolean; stuck boolean;
begin
  nz := case when not fresh or dist is null then zone
             when dist <= in_m then 'home'
             when dist > out_m then 'away'
             else coalesce(zone, 'away') end;
  if nz is distinct from zone then
    changed := true; zone_since := obs; ovr := null; attempts := 0; nxt := null; conf_at := null;
  end if;
  s_fresh := s_at is not null and s_on is not null and s_at > now_ - interval '45 minutes';
  if la is not null and s_fresh and s_at > la_at and s_on = (la = 'on') and conf_at is null then
    conf_at := s_at;
  end if;
  if not changed and ovr is null and nz = 'home'
     and ((la = 'off' and conf_at is not null and s_fresh and s_at > conf_at and s_on) or admin_on) then
    ovr := 'manual_on';
  end if;
  if not changed and ovr is null and nz = 'away'
     and la = 'on' and conf_at is not null and s_fresh and s_at > conf_at and not s_on and not low_battery then
    ovr := 'manual_off';
  end if;
  want := case when in_trip or ovr is not null then null
               when nz = 'home' and fresh and zone_since is not null and obs - zone_since >= make_interval(mins => settle) then 'off'
               when nz = 'away' and fresh and coalesce(spot, '') <> 'lax' and not low_battery then 'on'
          end;
  nudge := nz = 'home' and want is null and ovr is null and not in_trip and fresh
           and obs < now_ - interval '5 minutes' and coalesce(nudge_at, 'epoch') < now_ - interval '8 minutes';
  send := want is not null and not job_open and (nxt is null or nxt <= now_) and attempts < 4 and tz_up
          and ((s_fresh and s_on is distinct from (want = 'on')) or (not s_fresh and la is distinct from want))
          and (la is distinct from want or la_at is null or la_at < now_ - interval '20 minutes');
  stuck := want is not null and not job_open and attempts >= 4 and (not s_fresh or s_on is distinct from (want = 'on'));
  return jsonb_build_object('zone', nz, 'zone_changed', changed, 'zone_since', zone_since, 'override', ovr,
    'confirmed_at', conf_at, 'want', want, 'send', send, 'nudge', nudge, 'attempts', attempts,
    'next_try_at', nxt, 'stuck', stuck, 's_fresh', s_fresh);
end $$;
-- 5) The 5-minute tick
create or replace function public.car_sentry_home_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
 c car_sentry_home; fs tesla_fleet_settings; v turo_vehicle_state; hs home_pickup_settings; s car_protect_settings; j tesla_fleet_commands;
 sn_on boolean; sn_at timestamptz; in_trip boolean := false; admin_on boolean := false; tz_up boolean := tezlab_up();
 dist float8; spot text; p jsonb; dec jsonb; want text; jid bigint; out jsonb := '{}'; matched boolean;
 jobid bigint; jkind text; att int; nxt timestamptz; conf timestamptz; lact text; lact_at timestamptz; lerr text; nudge_ts timestamptz;
 ovr text; ovr_at timestamptz;
begin
 select * into c from car_sentry_home where id = 1 for update;
 if not exists (select 1 from cron.job where jobname = 'car-sentry-home-watchdog' and active) then
  perform cron.schedule('car-sentry-home-watchdog', '11-59/15 * * * *', 'select public.car_sentry_home_watchdog()');
 end if;
 if not c.enabled then
  update car_sentry_home set last_tick_at = now() where id = 1;
  return jsonb_build_object('skip', 'disabled');
 end if;
 select * into fs from tesla_fleet_settings where id = 1;
 select * into v from turo_vehicle_state where vin = fs.vin;
 select * into hs from home_pickup_settings where id = 1;
 select * into s from car_protect_settings where id = 1;
 select cn.sentry_on, cn.seen_at into sn_on, sn_at from car_sentry_now() cn;
 if v.vin is null or hs.lat is null then
  update car_sentry_home set last_tick_at = now() where id = 1;
  return jsonb_build_object('skip', 'no car or home pin');
 end if;
 dist := case when v.latitude is not null then trip_dist_m(v.latitude, v.longitude, hs.lat::float8, hs.lon::float8) end;
 spot := car_spot(v.latitude, v.longitude);
 select exists (select 1 from turo_trips tr where now() between tr.starts_at - interval '2 hours' and tr.ends_at + interval '1 hour'
  and coalesce(tr.status, '') not in ('test', 'CANCELLED', 'CANCELED')) into in_trip;
 select exists (select 1 from tesla_fleet_commands t where t.action = 'cmd' and t.args->>'kind' = 'sentry_on'
  and t.args->>'reason' = 'from the admin widget' and t.status <> 'failed' and c.zone_since is not null and t.created_at > c.zone_since) into admin_on;

 -- job bookkeeping
 jobid := c.job_id; jkind := c.job_kind; att := c.attempts; nxt := c.next_try_at; lact := c.last_action;
 lact_at := c.last_action_at; lerr := c.last_error; conf := c.confirmed_at; nudge_ts := c.nudge_at;
 if jobid is not null then
  select * into j from tesla_fleet_commands where id = jobid;
  if not found then
   jobid := null; jkind := null;
  elsif j.status = 'done' then
   lact := jkind; lact_at := coalesce(j.done_at, now()); lerr := null; conf := null; jobid := null; jkind := null;
  elsif j.status = 'failed' then
   if coalesce((j.result->>'deferred')::boolean, false) then
    att := greatest(att - 1, 0); nxt := now() + interval '5 minutes';
   else
    lerr := coalesce(j.result->>'error', 'failed'); nxt := now() + make_interval(mins => 5 * (2 ^ greatest(att - 1, 0))::int);
   end if;
   jobid := null; jkind := null;
  elsif j.created_at < now() - interval '10 minutes' then
   lerr := 'No answer in 10 minutes'; nxt := now() + make_interval(mins => 5 * (2 ^ greatest(att - 1, 0))::int);
   jobid := null; jkind := null;
  end if;
 end if;

 p := jsonb_build_object('now', now(), 'observed_at', v.observed_at, 'dist_m', dist, 'spot', spot, 'battery_pct', v.battery_pct,
  'floor', s.sentry_battery_floor, 'in_trip', in_trip, 'tezlab_up', tz_up, 'job_open', jobid is not null,
  'admin_on_since_zone', admin_on, 'zone', c.zone, 'zone_since', c.zone_since, 'override', c.override,
  'la', replace(lact, 'sentry_', ''), 'la_at', lact_at, 'conf_at', conf, 'sentry_on', sn_on, 'sentry_at', sn_at,
  'attempts', att, 'next_try_at', nxt, 'nudge_at', nudge_ts, 'in_m', c.in_m, 'out_m', c.out_m, 'settle_min', c.settle_min);
 dec := car_sentry_home_decide(p);
 want := dec->>'want';
 att := (dec->>'attempts')::int; nxt := nullif(dec->>'next_try_at', '')::timestamptz; conf := nullif(dec->>'confirmed_at', '')::timestamptz;
 ovr := dec->>'override';
 ovr_at := case when ovr is null then null when ovr is distinct from c.override then now() else c.override_at end;
 if (dec->>'zone_changed')::boolean then lerr := null; end if;

 -- read-only refresh so the next reading arrives sooner (allowed in test mode)
 if (dec->>'nudge')::boolean then
  if tz_up and not exists (select 1 from tesla_fleet_commands where action = 'refresh' and status in ('queued', 'running') and created_at > now() - interval '5 minutes') then
   insert into tesla_fleet_commands (action, auto, args) values ('refresh', true, '{"tezlab_only":true,"by":"sentry-home"}');
   out := out || '{"nudge":true}';
  end if;
  nudge_ts := now();
 end if;

 if ovr is distinct from c.override and ovr = 'manual_on' then
  perform car_event('sentry_on', 'info', 'Sentry on at home (you turned it on)', 'Leaving it on until the car leaves and comes back.',
   'sentryhome-manual-on-' || to_char(now(), 'YYYYMMDDHH24MI'), v.latitude, v.longitude, null, null, false);
 elsif ovr is distinct from c.override and ovr = 'manual_off' then
  perform car_event('sentry_off', 'info', 'Sentry off while away (you turned it off)', 'Leaving it off until the car comes home and leaves again.',
   'sentryhome-manual-off-' || to_char(now(), 'YYYYMMDDHH24MI'), v.latitude, v.longitude, null, null, false);
 end if;

 if (dec->>'send')::boolean then
  if c.dry_run then
   out := out || jsonb_build_object('dry_run_would_send', want);
  else
   jid := car_cmd('sentry_' || want, 'sentry-home: ' || case want when 'off' then 'parked at home' else 'left home' end);
   if jid is null then
    perform bestly_raise('car.sentry_home', 'problem', 'warning', 'Can''t send Sentry commands',
     'TezLab didn''t list a Sentry command, so Sentry at home is paused.', 'turo', 'Refresh the car''s TezLab commands');
   else
    jobid := jid; jkind := 'sentry_' || want; att := att + 1;
    update car_protect_settings set flags = coalesce(flags, '{}'::jsonb) || jsonb_build_object('sentry', want) where id = 1;
    if want = 'off' then
     perform car_event('sentry_off', 'info', 'Sentry off at home', 'Parked at N Kings Rd. Off to save battery; it comes back on when the car leaves.',
      'sentryhome-off-' || to_char(now(), 'YYYYMMDDHH24MI'), v.latitude, v.longitude, null, jsonb_build_object('job', jid, 'try', att), false);
    else
     perform car_event('sentry_on', 'info', 'Sentry back on', 'The car left home, so Sentry is back on.',
      'sentryhome-on-' || to_char(now(), 'YYYYMMDDHH24MI'), v.latitude, v.longitude, null, jsonb_build_object('job', jid, 'try', att), false);
    end if;
    out := out || jsonb_build_object('sent', want, 'job', jid);
   end if;
  end if;
 end if;

 matched := want is not null and coalesce((dec->>'s_fresh')::boolean, false) and sn_on = (want = 'on');
 if (dec->>'stuck')::boolean then
  perform bestly_raise('car.sentry_home', 'problem', 'warning', 'Sentry won''t turn ' || want,
   'Tried 4 times. Last answer: ' || coalesce(lerr, 'none'), 'turo', 'Check Sentry in the Tesla app');
  att := 3; nxt := now() + interval '6 hours';
 elsif (matched or want is null or (dec->>'zone_changed')::boolean)
    and exists (select 1 from monitor_issues where key = 'car.sentry_home' and status = 'open') then
  perform bestly_raise('car.sentry_home', 'resolved', 'warning', 'Sentry is how it should be', 'Sentry matches what Car Guard wants.');
 end if;

 update car_sentry_home set zone = dec->>'zone', zone_since = nullif(dec->>'zone_since', '')::timestamptz, override = ovr, override_at = ovr_at,
  job_id = jobid, job_kind = jkind, attempts = att, next_try_at = nxt, last_action = lact, last_action_at = lact_at, confirmed_at = conf,
  last_error = lerr, sentry_on = sn_on, sentry_at = sn_at, nudge_at = nudge_ts, last_decision = p || dec || jsonb_build_object('dry_run', c.dry_run),
  last_tick_at = now(), updated_at = now()
 where id = 1;
 return out || jsonb_build_object('want', want, 'zone', dec->>'zone');
end $$;
-- 6) Watchdog (every 15 min): restarts a stalled tick, restores the schedule, flags a Sentry feed that went blind
create or replace function public.car_sentry_home_watchdog()
returns jsonb language plpgsql security definer set search_path = public as $$
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
 if tezlab_ready() and not coalesce(tz_out, false) and (c.sentry_at is null or c.sentry_at < now() - interval '3 hours') then
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
end $$;
-- 7) Two one-line changes in existing functions (asserted to match exactly once)
do $do$
declare d text; o text; n text; cnt int;
begin
 -- car_protect_tick: do not turn Sentry back on at home while Sentry-at-home is live
 d := pg_get_functiondef('public.car_protect_tick'::regproc);
 o := 'and spot is not null and coalesce(v.battery_pct, 0) >= s.sentry_battery_floor';
 n := 'and spot is not null and not (spot = ''home'' and sentry_home_live()) and coalesce(v.battery_pct, 0) >= s.sentry_battery_floor';
 cnt := (length(d) - length(replace(d, o, ''))) / length(o);
 if cnt <> 1 then raise exception 'car_protect_tick pattern found % times', cnt; end if;
 execute replace(d, o, n);
 -- car_protect_watchdog: our own Sentry retries do not count as failed auto-fix commands
 d := pg_get_functiondef('public.car_protect_watchdog'::regproc);
 o := 'and args ? ''reason'' and status = ''failed''';
 n := 'and args ? ''reason'' and coalesce(args->>''reason'', '''') not like ''sentry-home:%'' and status = ''failed''';
 cnt := (length(d) - length(replace(d, o, ''))) / length(o);
 if cnt <> 1 then raise exception 'car_protect_watchdog pattern found % times', cnt; end if;
 execute replace(d, o, n);
end $do$;
-- 8, 9) Admin RPCs for the Ready widget, grants, cron
create or replace function public.admin_sentry_home()
returns jsonb language plpgsql security definer set search_path = public as $$
declare c car_sentry_home; in_trip boolean;
begin
 if not has_role(auth.uid(), 'admin') and session_user not in ('postgres', 'supabase_admin') then raise exception 'admin only'; end if;
 select * into c from car_sentry_home where id = 1;
 select exists (select 1 from turo_trips tr where now() between tr.starts_at - interval '2 hours' and tr.ends_at + interval '1 hour'
  and coalesce(tr.status, '') not in ('test', 'CANCELLED', 'CANCELED')) into in_trip;
 return jsonb_build_object('enabled', c.enabled, 'dry_run', c.dry_run, 'zone', c.zone, 'zone_since', c.zone_since, 'override', c.override,
  'last_action', c.last_action, 'last_action_at', c.last_action_at, 'sentry_on', c.sentry_on, 'sentry_at', c.sentry_at,
  'attempts', c.attempts, 'next_try_at', c.next_try_at, 'last_error', c.last_error, 'in_trip', in_trip, 'tezlab_up', tezlab_up(),
  'problem', exists (select 1 from monitor_issues where key = 'car.sentry_home' and status = 'open'),
  'settle_eta', c.zone_since + make_interval(mins => c.settle_min), 'settle_min', c.settle_min,
  'want', c.last_decision->>'want', 'would_send', c.last_decision->>'send', 'last_tick_at', c.last_tick_at);
end $$;

create or replace function public.admin_sentry_home_set(p_enabled boolean, p_dry_run boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c car_sentry_home;
begin
 if not has_role(auth.uid(), 'admin') and session_user not in ('postgres', 'supabase_admin') then raise exception 'admin only'; end if;
 update car_sentry_home set enabled = p_enabled, dry_run = coalesce(p_dry_run, dry_run), updated_at = now(),
  attempts = case when p_enabled then 0 else attempts end, override = case when p_enabled then null else override end,
  next_try_at = case when p_enabled then null else next_try_at end, last_error = case when p_enabled then null else last_error end
 where id = 1 returning * into c;
 if not p_enabled and exists (select 1 from monitor_issues where key = 'car.sentry_home' and status = 'open') then
  perform bestly_raise('car.sentry_home', 'resolved', 'warning', 'Sentry at home is off', 'Turned off from the admin widget.');
 end if;
 perform car_sentry_home_tick();
 perform car_event('sentry_auto', 'info', case when p_enabled then 'Sentry at home turned on' else 'Sentry at home turned off' end,
  case when not p_enabled then 'Sentry follows the trip rules only.' when c.dry_run then 'Test mode: it only logs what it would do.' else 'Live: Sentry goes off when parked at home and on when the car leaves.' end,
  'sentryauto-' || to_char(now(), 'YYYYMMDDHH24MISS'), null, null, null, jsonb_build_object('enabled', p_enabled, 'dry_run', c.dry_run), false);
 return admin_sentry_home();
end $$;

revoke all on function public.admin_sentry_home() from public, anon;
revoke all on function public.admin_sentry_home_set(boolean, boolean) from public, anon;
grant execute on function public.admin_sentry_home() to authenticated;
grant execute on function public.admin_sentry_home_set(boolean, boolean) to authenticated;
revoke all on function public.car_sentry_now() from public, anon, authenticated;
revoke all on function public.sentry_home_live() from public, anon, authenticated;
revoke all on function public.car_sentry_home_decide(jsonb) from public, anon, authenticated;
revoke all on function public.car_sentry_home_tick() from public, anon, authenticated;
revoke all on function public.car_sentry_home_watchdog() from public, anon, authenticated;

select cron.schedule('car-sentry-home', '3-59/5 * * * *', 'select public.car_sentry_home_tick()');
select cron.schedule('car-sentry-home-watchdog', '11-59/15 * * * *', 'select public.car_sentry_home_watchdog()');
