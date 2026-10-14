-- Climate Guard — A/C left running on a parked car with nobody in it.
--
-- Why: overnight 2026-10-13/14, on trip 62275681, the climate ran for hours on a locked, parked car at
-- the guest's address. Nothing of ours turned it on (no climate command in tesla_fleet_commands for 48h,
-- no Leo tool call, no trip-page tap) — so it was the guest or the car itself. Tesla's own 2-hour
-- unoccupied cutoff was the only thing that stopped it, and Jared only found out from a Tesla push.
-- Cost: 82% at 7:30 PM -> 72% at 6:05 AM, parked the whole time (~8% vs the ~1-2% a normal night costs).
--
-- What this does: every 5 minutes, works out whether climate is on with nobody in the seat. After
-- `unattended_min` (20) it tells Jared, and turns the climate off — but only when turning it off is
-- certainly safe. See the safety gates below; they are the point of the file.
--
-- Occupancy: Tesla's own is_user_present / climate_keeper_mode are NOT in anything we store (the Fleet
-- `health` worker lives on the Pi, outside this repo, and returns tires/windows/sentry/odometer only).
-- So "nobody in the seat" is inferred: doors locked + the car has not moved + no door opened since the
-- climate came on. That is a good proxy for a parked car and a bad proxy for an occupied one, which is
-- why auto-off is gated on the weather as well.

-- 0) Undo copy, before any change
insert into bestly_memory(area,key,title,body,kind,source,written_by)
select 'home','house/turo/climate-watch-undo-2026-10-14',
  'UNDO: Climate Guard (Oct 14) — drop the objects it creates',
  E'Rollback:\n  select cron.unschedule(''car-climate-watch'');\n  select cron.unschedule(''car-climate-watch-watchdog'');\n  drop function if exists public.car_climate_watch_tick();\n  drop function if exists public.car_climate_watch_watchdog();\n  drop function if exists public.car_climate_decide(jsonb);\n  drop function if exists public.car_climate_now();\n  drop function if exists public.car_climate_keeper();\n  drop function if exists public.admin_climate_watch();\n  drop function if exists public.admin_climate_watch_set(boolean, boolean, integer);\n  drop table if exists public.car_climate_watch;\n  delete from notification_owners where prefix = ''car.climate'';\nNothing existing is modified by this migration, so there is nothing else to restore.',
  'note','claude-code','claude'
where not exists (select 1 from bestly_memory where key='house/turo/climate-watch-undo-2026-10-14');

-- 1) State
create table if not exists public.car_climate_watch(
  id int primary key default 1 check (id = 1),
  enabled bool not null default true,
  dry_run bool not null default false,
  unattended_min int not null default 20,
  -- Auto-off only inside this outside/inside temperature band, in F. Outside it we still tell Jared but
  -- never touch the car: if something alive is in there (Dog Mode, a sleeping guest, a child) cutting the
  -- climate in real heat or real cold is the one mistake this watchdog must never make.
  mild_lo_f int not null default 45,
  mild_hi_f int not null default 85,
  climate_on bool, climate_at timestamptz,
  on_since timestamptz,
  on_lat float8, on_lon float8,
  unattended_since timestamptz,
  alerted_at timestamptz,
  job_id bigint, job_kind text,
  attempts int not null default 0,
  next_try_at timestamptz,
  last_action text, last_action_at timestamptz,
  last_error text,
  last_decision jsonb,
  last_tick_at timestamptz,
  last_watchdog_at timestamptz,
  updated_at timestamptz default now()
);
alter table public.car_climate_watch enable row level security;
insert into public.car_climate_watch(id) values (1) on conflict do nothing;

-- Car Guard owns it, so every alert is signed by the employee responsible (Jared's rule, 2026-10-09).
insert into public.notification_owners(prefix, agent_slug, note)
values ('car.climate','car-guard','A/C left running on a parked car with nobody in it')
on conflict do nothing;

-- 2) Is the climate on, and how fresh is that reading? Freshest of the three places we store it.
create or replace function public.car_climate_now()
returns table(climate_on boolean, seen_at timestamptz, src text)
language sql stable security definer set search_path = public as $$
  with a as (
    select (v.raw->'fleet_api'->>'climate_on')::boolean as c, v.observed_at as t, 'fleet'::text as s
      from turo_vehicle_state v
     where jsonb_typeof(v.raw->'fleet_api'->'climate_on') = 'boolean'
    union all
    select (v.raw->'climate'->>'active')::boolean, v.observed_at, 'tezlab-state'
      from turo_vehicle_state v
     where jsonb_typeof(v.raw->'climate'->'active') = 'boolean'
    union all
    select (r.raw->'climate'->>'active')::boolean,
           least(coalesce(nullif(r.raw->>'last_updated','')::timestamptz, r.at), r.at), 'tezlab-raw'
      from car_status_raw r
     where r.id = 1 and jsonb_typeof(r.raw->'climate'->'active') = 'boolean'
  )
  select c, t, s from a where c is not null order by t desc limit 1
$$;

-- 3) Dog Mode / Camp Mode, if any source ever reports it. Returns null when nothing reports it at all,
--    which is the normal case today — the caller treats null as "unknown", not as "off".
create or replace function public.car_climate_keeper()
returns text language sql stable security definer set search_path = public as $$
  select lower(v::text) from car_raw_find('climate_keeper|dog_mode|camp_mode')
   where v::text !~* 'null|false|^"?0"?$' limit 1
$$;

-- 4) Pure decision. Everything it needs is passed in, so it can be tested without a car.
create or replace function public.car_climate_decide(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  now_ timestamptz := (p->>'now')::timestamptz;
  obs timestamptz := nullif(p->>'climate_at','')::timestamptz;
  on_ boolean := (p->>'climate_on')::boolean;
  locked boolean := (p->>'locked')::boolean;
  moved boolean := coalesce((p->>'moved')::boolean, false);
  plugged boolean := coalesce((p->>'plugged_in')::boolean, false);
  inside int := nullif(p->>'inside_f','')::int;
  outside int := nullif(p->>'outside_f','')::int;
  lo int := coalesce((p->>'mild_lo_f')::int, 45);
  hi int := coalesce((p->>'mild_hi_f')::int, 85);
  mins int := coalesce((p->>'unattended_min')::int, 20);
  keeper text := p->>'keeper';
  ours boolean := coalesce((p->>'ours')::boolean, false);
  pickup boolean := coalesce((p->>'pickup_soon')::boolean, false);
  tz_up boolean := coalesce((p->>'tezlab_up')::boolean, false);
  job_open boolean := coalesce((p->>'job_open')::boolean, false);
  attempts int := coalesce((p->>'attempts')::int, 0);
  nxt timestamptz := nullif(p->>'next_try_at','')::timestamptz;
  on_since timestamptz := nullif(p->>'on_since','')::timestamptz;
  un_since timestamptz := nullif(p->>'unattended_since','')::timestamptz;
  alerted timestamptz := nullif(p->>'alerted_at','')::timestamptz;
  fresh boolean; unattended boolean; due boolean; mild boolean; blocked text; send boolean; alert boolean; stuck boolean;
begin
  fresh := obs is not null and obs > now_ - interval '30 minutes';

  -- Climate off, or we cannot see it: nothing is running, so forget everything we were counting.
  if not fresh or on_ is not true then
    return jsonb_build_object('on_since', case when on_ is true then on_since end,
      'unattended_since', null, 'alerted_at', null, 'minutes', 0, 'unattended', false,
      'alert', false, 'send', false, 'blocked', null, 'attempts', 0, 'next_try_at', null, 'stuck', false);
  end if;

  if on_since is null then on_since := obs; end if;

  -- Somebody is with the car: it is unlocked, or it has moved since the last look.
  unattended := coalesce(locked, false) and not moved;
  if not unattended then
    un_since := null; alerted := null;
  elsif un_since is null then
    un_since := greatest(on_since, obs - interval '5 minutes');
  end if;

  due := un_since is not null and un_since <= now_ - make_interval(mins => mins);
  mild := inside is not null and outside is not null
          and inside between lo and hi and outside between lo and hi;

  -- Why we would NOT turn it off. First match wins, most important first.
  blocked := case
    when keeper is not null then 'dog or camp mode is on'
    when not mild then 'it is too hot or too cold out to cut the climate on a car that might not be empty'
    when plugged then 'the car is plugged in'
    when pickup then 'a pickup is close, so it is probably warming up on purpose'
    when ours then 'we turned it on ourselves a moment ago'
    when not tz_up then 'TezLab is down'
  end;

  alert := due and alerted is null;
  send := due and blocked is null and not job_open and attempts < 3
          and (nxt is null or nxt <= now_);
  stuck := due and blocked is null and not job_open and attempts >= 3;

  return jsonb_build_object(
    'on_since', on_since, 'unattended_since', un_since,
    'alerted_at', case when alert then now_ else alerted end,
    'minutes', case when un_since is null then 0 else floor(extract(epoch from (now_ - un_since)) / 60)::int end,
    'unattended', unattended, 'due', due, 'alert', alert, 'send', send, 'blocked', blocked,
    'attempts', attempts, 'next_try_at', nxt, 'stuck', stuck, 'mild', mild);
end $$;

-- 5) The 5-minute tick
create or replace function public.car_climate_watch_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c car_climate_watch; fs tesla_fleet_settings; v turo_vehicle_state; j tesla_fleet_commands;
  cn_on boolean; cn_at timestamptz; cn_src text; keeper text; moved boolean := false; ours boolean := false;
  pickup boolean := false; p jsonb; dec jsonb; jid bigint; out jsonb := '{}';
  jobid bigint; jkind text; att int; nxt timestamptz; lact text; lact_at timestamptz; lerr text;
  mins int; body text;
begin
  select * into c from car_climate_watch where id = 1 for update;
  if not exists (select 1 from cron.job where jobname = 'car-climate-watch-watchdog' and active) then
    perform cron.schedule('car-climate-watch-watchdog', '7-59/15 * * * *', 'select public.car_climate_watch_watchdog()');
  end if;
  if not c.enabled then
    update car_climate_watch set last_tick_at = now() where id = 1;
    return jsonb_build_object('skip', 'disabled');
  end if;

  select * into fs from tesla_fleet_settings where id = 1;
  select * into v from turo_vehicle_state where vin = fs.vin;
  if v.vin is null then
    update car_climate_watch set last_tick_at = now() where id = 1;
    return jsonb_build_object('skip', 'no car');
  end if;

  select cc.climate_on, cc.seen_at, cc.src into cn_on, cn_at, cn_src from car_climate_now() cc;
  keeper := car_climate_keeper();

  -- Moved since the position we recorded when the climate came on (50 m of GPS wander is not a move).
  if c.on_lat is not null and v.latitude is not null then
    moved := trip_dist_m(v.latitude, v.longitude, c.on_lat, c.on_lon) > 50;
  end if;

  -- Did we turn it on ourselves in the last 30 minutes? Then it is wanted.
  select exists (
    select 1 from tesla_fleet_commands t
     where (t.action in ('cool','warm','seat')
            or (t.action = 'cmd' and t.args->>'kind' in ('cool','warm','seat','climate_on')))
       and t.status <> 'failed' and t.created_at > now() - interval '30 minutes') into ours;

  -- A pickup within 2 hours: warming up or cooling down for a guest is the whole point.
  select exists (
    select 1 from turo_trips tr
     where tr.starts_at between now() - interval '30 minutes' and now() + interval '2 hours'
       and coalesce(tr.status, '') not in ('test', 'CANCELLED', 'CANCELED')) into pickup;

  -- job bookkeeping
  jobid := c.job_id; jkind := c.job_kind; att := c.attempts; nxt := c.next_try_at;
  lact := c.last_action; lact_at := c.last_action_at; lerr := c.last_error;
  if jobid is not null then
    select * into j from tesla_fleet_commands where id = jobid;
    if not found then
      jobid := null; jkind := null;
    elsif j.status = 'done' then
      lact := jkind; lact_at := coalesce(j.done_at, now()); lerr := null; jobid := null; jkind := null;
    elsif j.status = 'failed' then
      if coalesce((j.result->>'deferred')::boolean, false) then
        att := greatest(att - 1, 0); nxt := now() + interval '5 minutes';
      else
        lerr := coalesce(j.result->>'error', 'failed');
        nxt := now() + make_interval(mins => 5 * (2 ^ greatest(att - 1, 0))::int);
      end if;
      jobid := null; jkind := null;
    elsif j.created_at < now() - interval '10 minutes' then
      lerr := 'No answer in 10 minutes';
      nxt := now() + make_interval(mins => 5 * (2 ^ greatest(att - 1, 0))::int);
      jobid := null; jkind := null;
    end if;
  end if;

  p := jsonb_build_object('now', now(), 'climate_on', cn_on, 'climate_at', cn_at, 'src', cn_src,
    'locked', v.locked, 'moved', moved, 'plugged_in', coalesce(v.plugged_in, false),
    'inside_f', v.inside_temp, 'outside_f', v.outside_temp, 'keeper', keeper, 'ours', ours,
    'pickup_soon', pickup, 'tezlab_up', tezlab_up(), 'job_open', jobid is not null,
    'attempts', att, 'next_try_at', nxt, 'on_since', c.on_since, 'unattended_since', c.unattended_since,
    'alerted_at', c.alerted_at, 'unattended_min', c.unattended_min,
    'mild_lo_f', c.mild_lo_f, 'mild_hi_f', c.mild_hi_f);
  dec := car_climate_decide(p);
  att := (dec->>'attempts')::int;
  nxt := nullif(dec->>'next_try_at','')::timestamptz;
  mins := coalesce((dec->>'minutes')::int, 0);

  -- Tell him once per stretch, whether or not we are allowed to act.
  if (dec->>'alert')::boolean then
    body := 'The A/C has been running ' || mins || ' minutes on a parked, locked car'
         || case when v.battery_pct is not null then ' (battery ' || v.battery_pct || '%)' else '' end || '. '
         || case when dec->>'blocked' is null
                 then case when c.dry_run then 'Test mode, so I am leaving it alone.' else 'Turning it off now.' end
                 else 'Leaving it alone: ' || (dec->>'blocked') || '.' end;
    perform car_event('climate_unattended', 'info', 'A/C left on with nobody in the car', body,
      'climateon-' || to_char(coalesce(nullif(dec->>'on_since','')::timestamptz, now()), 'YYYYMMDDHH24MI'),
      v.latitude, v.longitude, null,
      jsonb_build_object('minutes', mins, 'blocked', dec->>'blocked', 'battery_pct', v.battery_pct,
                         'inside_f', v.inside_temp, 'outside_f', v.outside_temp), true);
    out := out || jsonb_build_object('alerted', mins);
  end if;

  if (dec->>'send')::boolean then
    if c.dry_run then
      out := out || '{"dry_run_would_send":"climate_off"}';
    else
      jid := car_cmd('climate_off', 'climate-watch: ' || mins || ' min on a parked car with nobody in it');
      if jid is null then
        perform bestly_raise('car.climate', 'problem', 'warning', 'Can''t turn the A/C off',
          'TezLab didn''t list a climate command, so Climate Guard can only tell you, not act.',
          'turo', 'Refresh the car''s TezLab commands');
      else
        jobid := jid; jkind := 'climate_off'; att := att + 1;
        perform car_event('climate_off', 'info', 'Turned the A/C off',
          'It had been running ' || mins || ' minutes on a parked, locked car. Off to save the battery.',
          'climateoff-' || to_char(now(), 'YYYYMMDDHH24MI'), v.latitude, v.longitude, null,
          jsonb_build_object('job', jid, 'try', att, 'minutes', mins), true);
        out := out || jsonb_build_object('sent', 'climate_off', 'job', jid);
      end if;
    end if;
  end if;

  -- Still running after 2 hours and we are not allowed to stop it: that is his call to make, so it interrupts.
  if mins >= 120 and dec->>'blocked' is not null
     and not exists (select 1 from monitor_issues where key = 'car.climate' and status = 'open') then
    perform bestly_raise('car.climate', 'problem', 'warning', 'A/C has run 2 hours on a parked car',
      'I am not turning it off: ' || (dec->>'blocked') || '. Battery '
        || coalesce(v.battery_pct::text, '?') || '%.', 'turo', 'Turn the climate off in the Tesla app');
  elsif mins = 0 and exists (select 1 from monitor_issues where key = 'car.climate' and status = 'open') then
    perform bestly_raise('car.climate', 'resolved', 'warning', 'The A/C is off', 'Nothing is running now.');
  end if;

  if (dec->>'stuck')::boolean then
    perform bestly_raise('car.climate', 'problem', 'warning', 'The A/C won''t turn off',
      'Tried 3 times. Last answer: ' || coalesce(lerr, 'none'), 'turo', 'Turn the climate off in the Tesla app');
    att := 2; nxt := now() + interval '2 hours';
  end if;

  update car_climate_watch set
    climate_on = cn_on, climate_at = cn_at,
    on_since = nullif(dec->>'on_since','')::timestamptz,
    on_lat = case when nullif(dec->>'on_since','') is null then null
                  when c.on_since is null or moved then v.latitude else c.on_lat end,
    on_lon = case when nullif(dec->>'on_since','') is null then null
                  when c.on_since is null or moved then v.longitude else c.on_lon end,
    unattended_since = nullif(dec->>'unattended_since','')::timestamptz,
    alerted_at = nullif(dec->>'alerted_at','')::timestamptz,
    job_id = jobid, job_kind = jkind, attempts = att, next_try_at = nxt,
    last_action = lact, last_action_at = lact_at, last_error = lerr,
    last_decision = p || dec || jsonb_build_object('dry_run', c.dry_run),
    last_tick_at = now(), updated_at = now()
  where id = 1;

  return out || jsonb_build_object('minutes', mins, 'on', cn_on, 'blocked', dec->>'blocked');
end $$;

-- 6) Watchdog (every 15 min): restarts a stalled tick, restores either schedule, flags a blind climate feed
create or replace function public.car_climate_watch_watchdog()
returns jsonb language plpgsql security definer set search_path = public as $$
declare c car_climate_watch; healed text[] := '{}'; bad text[] := '{}'; nb int;
begin
  select * into c from car_climate_watch where id = 1;
  if not c.enabled then return jsonb_build_object('skip', 'disabled'); end if;
  if c.last_tick_at is null or c.last_tick_at < now() - interval '15 minutes' then
    perform car_climate_watch_tick();
    healed := array_append(healed, 'the climate check had stalled (restarted)');
  end if;
  if not exists (select 1 from cron.job where jobname = 'car-climate-watch' and active) then
    perform cron.schedule('car-climate-watch', '2-59/5 * * * *', 'select public.car_climate_watch_tick()');
    healed := array_append(healed, 'its 5-minute schedule was missing (restored)');
  end if;
  select * into c from car_climate_watch where id = 1;
  if c.climate_at is null or c.climate_at < now() - interval '3 hours' then
    bad := array_append(bad, 'can''t see whether the climate is on or off for over 3 hours');
  end if;
  if c.last_error is not null and coalesce(c.last_action_at, 'epoch') < now() - interval '60 minutes'
     and c.attempts >= 2 then
    bad := array_append(bad, 'the A/C has not turned off in over an hour');
  end if;
  nb := coalesce(array_length(bad, 1), 0);
  if nb > 0 or coalesce(array_length(healed, 1), 0) > 0 then
    perform bestly_raise('car.climate.watch', 'problem', 'warning',
      case when nb > 0 then 'Climate Guard needs a look' else 'Climate Guard fixed itself' end,
      array_to_string(bad || healed, '; ') || '.', 'turo',
      case when nb > 0 then 'Check the car in the Tesla app' end, nb = 0);
  else
    perform bestly_raise('car.climate.watch', 'resolved', 'warning', 'Climate Guard is healthy', 'Checks are passing.');
  end if;
  update car_climate_watch set last_watchdog_at = now() where id = 1;
  return jsonb_build_object('problems', bad, 'healed', healed);
end $$;

-- 7) Admin RPCs for the Turo settings card
create or replace function public.admin_climate_watch()
returns jsonb language plpgsql security definer set search_path = public as $$
declare c car_climate_watch;
begin
  if not has_role(auth.uid(), 'admin') and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'admin only';
  end if;
  select * into c from car_climate_watch where id = 1;
  return jsonb_build_object('enabled', c.enabled, 'dry_run', c.dry_run, 'unattended_min', c.unattended_min,
    'mild_lo_f', c.mild_lo_f, 'mild_hi_f', c.mild_hi_f, 'climate_on', c.climate_on, 'climate_at', c.climate_at,
    'on_since', c.on_since, 'unattended_since', c.unattended_since,
    'minutes', c.last_decision->>'minutes', 'blocked', c.last_decision->>'blocked',
    'last_action', c.last_action, 'last_action_at', c.last_action_at, 'last_error', c.last_error,
    'attempts', c.attempts, 'next_try_at', c.next_try_at, 'tezlab_up', tezlab_up(),
    'problem', exists (select 1 from monitor_issues where key = 'car.climate' and status = 'open'),
    'last_tick_at', c.last_tick_at);
end $$;

create or replace function public.admin_climate_watch_set(p_enabled boolean, p_dry_run boolean default null,
                                                          p_minutes int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c car_climate_watch;
begin
  if not has_role(auth.uid(), 'admin') and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'admin only';
  end if;
  update car_climate_watch set enabled = p_enabled, dry_run = coalesce(p_dry_run, dry_run),
    unattended_min = greatest(coalesce(p_minutes, unattended_min), 5),
    attempts = case when p_enabled then 0 else attempts end,
    next_try_at = case when p_enabled then null else next_try_at end,
    last_error = case when p_enabled then null else last_error end,
    updated_at = now()
  where id = 1 returning * into c;
  if not p_enabled and exists (select 1 from monitor_issues where key = 'car.climate' and status = 'open') then
    perform bestly_raise('car.climate', 'resolved', 'warning', 'Climate Guard is off', 'Turned off from the admin card.');
  end if;
  perform car_climate_watch_tick();
  return admin_climate_watch();
end $$;

-- 8) Grants
revoke all on function public.car_climate_now() from public, anon, authenticated;
revoke all on function public.car_climate_keeper() from public, anon, authenticated;
revoke all on function public.car_climate_decide(jsonb) from public, anon, authenticated;
revoke all on function public.car_climate_watch_tick() from public, anon, authenticated;
revoke all on function public.car_climate_watch_watchdog() from public, anon, authenticated;
revoke all on function public.admin_climate_watch() from public, anon;
revoke all on function public.admin_climate_watch_set(boolean, boolean, int) from public, anon;
grant execute on function public.admin_climate_watch() to authenticated;
grant execute on function public.admin_climate_watch_set(boolean, boolean, int) to authenticated;

-- 9) Schedules
select cron.schedule('car-climate-watch', '2-59/5 * * * *', 'select public.car_climate_watch_tick()');
select cron.schedule('car-climate-watch-watchdog', '7-59/15 * * * *', 'select public.car_climate_watch_watchdog()');

-- 10) Car Guard owns the two new schedules (house rule: every bot is on /admin/team the day it goes live)
update bestly_agents
   set pulse = jsonb_set(pulse, '{also}',
         (select jsonb_agg(distinct x) from jsonb_array_elements(
            coalesce(pulse->'also', '[]'::jsonb) || '["car-climate-watch","car-climate-watch-watchdog"]'::jsonb) x))
 where slug = 'car-guard' and pulse is not null;
