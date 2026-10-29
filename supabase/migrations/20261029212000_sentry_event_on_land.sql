-- Sentry at home reported a change that never happened (2026-10-29).
-- car_sentry_home_tick wrote the "Sentry off at home" / "Sentry back on" car_event, and the
-- car_protect_settings.sentry flag the Ready widget reads, at the moment it QUEUED the command.
-- Job 11278 spent 82 s asleep and failed, and the feed still said Sentry was off. Move both into the
-- job bookkeeping: they are written only when tesla_fleet_commands.status = 'done', i.e. the car
-- answered the command. A failed or timed-out attempt now leaves no event and no flag change.
-- Nothing else in the decision path changes: attempts, backoff, nudges and the stuck alert are as
-- they were. Undo copy of the function we replace is saved below.
insert into bestly_memory(area,key,title,body,kind,source,written_by)
select 'home','house/turo/sentry-event-on-land-undo-2026-10-29','UNDO: car_sentry_home_tick before the Sentry event waited for the car (Oct 29)',
  pg_get_functiondef('public.car_sentry_home_tick'::regproc)||E'\n\nRollback: run the body above.',
  'note','claude-code','claude'
where not exists (select 1 from bestly_memory where key='house/turo/sentry-event-on-land-undo-2026-10-29');

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
   -- The car took the command, so now the change is real. Event and flag describe what the car did,
   -- never what we asked it to do.
   if jkind in ('sentry_off', 'sentry_on') then
    update car_protect_settings set flags = coalesce(flags, '{}'::jsonb)
      || jsonb_build_object('sentry', replace(jkind, 'sentry_', '')) where id = 1;
    if jkind = 'sentry_off' then
     perform car_event('sentry_off', 'info', 'Sentry off at home', 'Parked at N Kings Rd. Off to save battery; it comes back on when the car leaves.',
      'sentryhome-off-' || to_char(now(), 'YYYYMMDDHH24MI'), v.latitude, v.longitude, null, jsonb_build_object('job', jobid, 'try', att), false);
    else
     perform car_event('sentry_on', 'info', 'Sentry back on', 'The car left home, so Sentry is back on.',
      'sentryhome-on-' || to_char(now(), 'YYYYMMDDHH24MI'), v.latitude, v.longitude, null, jsonb_build_object('job', jobid, 'try', att), false);
    end if;
   end if;
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
    -- Deliberately no event and no sentry flag here: queued is not done. Both are written in the job
    -- bookkeeping above when this job answers done, so a command that fails leaves nothing behind
    -- that reads like the car changed.
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
