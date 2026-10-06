-- Turo handoff close-out, 2026-10-05 (Jared: "the live activity says he's an hour over when he's not").
--
-- WHAT WENT WRONG. The return Live Activity had no idea the handoff was OVER. It keyed off the trip's end time
-- and the car's live state, so an hour after Henok had gone it was still counting "1 h over". Underneath:
--   * trip_return_detect() set settled_at when the car looked settled and WIPED IT AGAIN the moment it did not
--     (Jared opened the doors to take return photos, then moved the car to the charger). Settled went true, false,
--     true. Nothing downstream could trust it.
--   * key_removal_ready() waits on settled_at, so the guest's phone key was still live on the car an hour later.
--   * "returned" meant parked + locked. Guests have sat in the car for an hour after dropping it off.
--
-- WHAT IT DOES NOW (Jared's answers, 2026-10-05):
--   done using = at the spot, locked, nothing open, climate off, nobody in the seat -- and QUIET that way for
--     quiet_minutes (10). done_using_at is stamped with the START of that quiet run, which is the real moment
--     they walked away, not ten minutes later.
--   done_using_at and settled_at are ONE-WAY. Once set they are never cleared by a later reading. What Jared
--     does with his own car afterwards is not the guest's handoff.
--   late_minutes is frozen at done_using_at. The card may say they were late getting it back; it never keeps counting.
--   wind-down: the card lives wind_down_minutes (30) past done_using_at, then the key comes off and the card
--     ends in the same move.
--   no ceiling on the CARD -- if nothing ever confirms it stays up until Jared acts. The KEY does not wait on
--     that: key_ceiling_hours (2) past the trip end, with the car home and locked, it is pulled anyway.
--   every trip that gets stuck is logged in turo_handoff_stuck and Scout says so once it is over an hour.

alter table public.tesla_key_settings
  add column if not exists quiet_minutes     int not null default 10,
  add column if not exists wind_down_minutes int not null default 30,
  add column if not exists key_ceiling_hours int not null default 2;

alter table public.lax_guest_links
  add column if not exists quiet_since   timestamptz,
  add column if not exists done_using_at timestamptz,
  add column if not exists late_minutes  int;

comment on column public.lax_guest_links.quiet_since is
  'Start of the current run of quiet car readings (at the spot, locked, shut, climate off, nobody aboard). Cleared whenever a reading is not quiet. Working value only.';
comment on column public.lax_guest_links.done_using_at is
  'ONE-WAY. When the guest was really done: the start of a quiet run that lasted quiet_minutes. Drives the wind-down and the key removal.';
comment on column public.lax_guest_links.late_minutes is
  'Frozen at done_using_at: how late the return actually was, in minutes. Null or 0 means not late. The card never counts past this.';

-- car_return_state gains climate_on / user_present (additive; every existing key is unchanged).
create or replace function public.car_return_state() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v turo_vehicle_state; fs tesla_fleet_settings; d_km float8; spot text;
        v_trunk boolean; v_frunk boolean; v_win boolean; v_open text[] := '{}'; v_fresh boolean;
        v_clim boolean; v_user boolean;
begin
  select * into fs from tesla_fleet_settings where id = 1;
  select * into v from turo_vehicle_state where vin = fs.vin;
  if v.vin is null or v.latitude is null then
    return jsonb_build_object('known', false, 'why', 'no reading from the car');
  end if;

  v_fresh := v.observed_at > now() - interval '30 minutes';

  d_km := sqrt(power((v.latitude - 34.084241) * 111.0, 2) + power((v.longitude + 118.371793) * 111.0 * cos(radians(34.084241)), 2));
  if d_km < 0.35 then spot := 'home'; end if;
  if spot is null then
    d_km := sqrt(power((v.latitude - 33.9472637) * 111.0, 2) + power((v.longitude + 118.3826063) * 111.0 * cos(radians(33.9472637)), 2));
    if d_km < 0.35 then spot := 'lax'; end if;
  end if;

  v_trunk := (v.raw #>> '{fleet_api,doors,rear_trunk_open}')::boolean;
  v_frunk := (v.raw #>> '{fleet_api,doors,front_trunk_open}')::boolean;
  v_win   := car_windows_open();
  v_clim  := (v.raw #>> '{fleet_api,climate_on}')::boolean;
  v_user  := (v.raw #>> '{fleet_api,user_present}')::boolean;

  if coalesce(v_trunk, false) then v_open := array_append(v_open, 'the boot'); end if;
  if coalesce(v_frunk, false) then v_open := array_append(v_open, 'the frunk'); end if;
  if coalesce(v_win,   false) then v_open := array_append(v_open, 'a window'); end if;
  if v.locked is false        then v_open := array_append(v_open, 'the doors (unlocked)'); end if;

  return jsonb_build_object(
    'known', true, 'at', v.observed_at, 'fresh', v_fresh, 'spot', spot, 'locked', v.locked,
    'trunk_open', v_trunk, 'frunk_open', v_frunk, 'windows_open', v_win, 'open', to_jsonb(v_open),
    'climate_on', v_clim, 'user_present', v_user,
    'settled', (v_fresh and spot is not null and coalesce(v.locked, false) and array_length(v_open, 1) is null));
end $$;

-- trip_return_detect: settled_at / returned_at are now ONE-WAY. The old "elsif ... set settled_at = null"
-- branch is what let Jared's own return photos un-return the trip.
create or replace function public.trip_return_detect() returns integer
language plpgsql security definer set search_path to 'public' as $function$
declare r record; st jsonb; n int := 0;
begin
  st := public.car_return_state();
  if not (st->>'known')::boolean then return 0; end if;
  if not (st->>'settled')::boolean then return 0; end if;

  for r in select l.reservation_id, l.returned_at, l.settled_at
             from lax_guest_links l join turo_trips t using (reservation_id)
            where now() between t.ends_at - interval '6 hours' and t.ends_at + interval '7 days'
              and (l.returned_at is null or l.settled_at is null)
  loop
    update lax_guest_links
       set returned_at = coalesce(returned_at, least(now(), (st->>'at')::timestamptz)),
           settled_at  = coalesce(settled_at,  least(now(), (st->>'at')::timestamptz))
     where reservation_id = r.reservation_id;
    n := n + 1;
  end loop;
  return n;
end $function$;

create table if not exists public.turo_handoff_stuck (
  id             bigserial primary key,
  reservation_id bigint not null,
  noticed_at     timestamptz not null default now(),
  cleared_at     timestamptz,
  minutes_stuck  int,
  why            text,
  car_state      jsonb
);
alter table public.turo_handoff_stuck enable row level security;
create index if not exists turo_handoff_stuck_res on public.turo_handoff_stuck (reservation_id, noticed_at desc);
comment on table public.turo_handoff_stuck is
  'One row per trip whose handoff could not close itself. Written by turo_handoff_tick so stuck returns are measurable instead of remembered.';

-- The tick: judges quiet, stamps done_using_at one-way, freezes late_minutes, logs and alerts when stuck.
create or replace function public.turo_handoff_tick() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  r record; st jsonb; s tesla_key_settings;
  quiet boolean; why text; n_done int := 0; n_stuck int := 0; n_quiet int := 0;
  q_min int; stuck_row turo_handoff_stuck;
begin
  select * into s from tesla_key_settings where id = 1;
  q_min := coalesce(s.quiet_minutes, 10);
  st := public.car_return_state();
  if not (st->>'known')::boolean then return jsonb_build_object('ok', false, 'why', 'no reading from the car'); end if;

  quiet := (st->>'fresh')::boolean
       and (st->>'spot') is not null
       and coalesce((st->>'locked')::boolean, false)
       and jsonb_array_length(coalesce(st->'open', '[]'::jsonb)) = 0
       and not coalesce((st->>'climate_on')::boolean, false)
       and not coalesce((st->>'user_present')::boolean, false);

  why := case
    when not (st->>'fresh')::boolean then 'the last reading from the car is over half an hour old'
    when (st->>'spot') is null then 'the car is not back at the pickup spot'
    when not coalesce((st->>'locked')::boolean, false) then 'the car is unlocked'
    when jsonb_array_length(coalesce(st->'open','[]'::jsonb)) > 0
      then 'still open: ' || (select string_agg(x #>> '{}', ', ') from jsonb_array_elements(st->'open') x)
    when coalesce((st->>'climate_on')::boolean, false) then 'the climate is running, so someone is probably still in it'
    when coalesce((st->>'user_present')::boolean, false) then 'someone is still sitting in the car'
    else 'waiting for a quiet run' end;

  for r in
    select l.reservation_id, l.quiet_since, l.done_using_at, t.ends_at, t.guest_first
      from lax_guest_links l join turo_trips t using (reservation_id)
     where l.done_using_at is null
       and now() between t.ends_at - interval '6 hours' and t.ends_at + interval '7 days'
       and coalesce(t.status, '') not ilike '%cancel%'
  loop
    if not quiet then
      if r.quiet_since is not null then
        update lax_guest_links set quiet_since = null where reservation_id = r.reservation_id;
      end if;
    elsif r.quiet_since is null then
      update lax_guest_links set quiet_since = least(now(), (st->>'at')::timestamptz) where reservation_id = r.reservation_id;
      n_quiet := n_quiet + 1;
    elsif now() - r.quiet_since >= make_interval(mins => q_min) then
      update lax_guest_links
         set done_using_at = r.quiet_since,
             returned_at   = coalesce(returned_at, r.quiet_since),
             settled_at    = coalesce(settled_at,  r.quiet_since),
             late_minutes  = greatest(0, floor(extract(epoch from (r.quiet_since - r.ends_at)) / 60))::int
       where reservation_id = r.reservation_id;
      n_done := n_done + 1;
      update turo_handoff_stuck set cleared_at = now()
       where reservation_id = r.reservation_id and cleared_at is null;
    end if;

    -- stuck: over an hour past the trip end and still not closed
    if r.done_using_at is null and now() - r.ends_at > interval '1 hour' then
      select * into stuck_row from turo_handoff_stuck
       where reservation_id = r.reservation_id and cleared_at is null
       order by noticed_at desc limit 1;
      if stuck_row.id is null then
        insert into turo_handoff_stuck (reservation_id, minutes_stuck, why, car_state)
        values (r.reservation_id, floor(extract(epoch from (now() - r.ends_at)) / 60)::int, why, st);
        n_stuck := n_stuck + 1;
        begin
          perform scout_notify(
            'Turo Reader: ' || coalesce(r.guest_first, 'a guest') || ' trip has not closed',
            'The car has not given a clean, quiet reading since the trip ended, so the Live Activity is still up and the guest key is still live. Reason: ' || why,
            'warning', true, '/admin/turo', 'handoff-stuck-' || r.reservation_id);
        exception when others then null; end;
      else
        update turo_handoff_stuck
           set minutes_stuck = floor(extract(epoch from (now() - r.ends_at)) / 60)::int, why = why, car_state = st
         where id = stuck_row.id;
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'quiet', quiet, 'why', why,
                            'closed', n_done, 'started_quiet', n_quiet, 'stuck', n_stuck);
end $$;
revoke all on function public.turo_handoff_tick() from public, anon, authenticated;

-- trip_return_phase: now carries done_using_at, the wind-down clock and the frozen late figure.
create or replace function public.trip_return_phase(p_res bigint) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  t turo_trips; v turo_vehicle_state; g lax_guest_links; e car_eta; rs jsonb; s tesla_key_settings;
  dlat float8; dlon float8; d_now float8; d_old float8; n_pts int;
  lat0 float8; lon0 float8; lat1 float8; lon1 float8;
  phase text; pick int; batt int; short boolean; fresh boolean; efresh boolean;
  sc_n int := 0; sc_cost numeric := 0; wind_ends timestamptz;
begin
  select * into t from turo_trips where reservation_id = p_res;
  if t.reservation_id is null then return null; end if;
  select * into g from lax_guest_links where reservation_id = p_res;
  select * into v from turo_vehicle_state where vin = t.vin;
  select * into e from car_eta where reservation_id = p_res;
  select * into s from tesla_key_settings where id = 1;
  rs := public.car_return_state();

  if t.airport_code is not null then dlat := 33.9472637; dlon := -118.3826063;
  else dlat := 34.084241; dlon := -118.371793; end if;

  select count(*), (array_agg(lat order by at))[1], (array_agg(lon order by at))[1],
         (array_agg(lat order by at desc))[1], (array_agg(lon order by at desc))[1]
    into n_pts, lat0, lon0, lat1, lon1
    from car_trail where vin = t.vin and at > now() - interval '60 minutes';
  if v.latitude is not null and (lat1 is null or v.observed_at > now() - interval '30 minutes') then lat1 := v.latitude; lon1 := v.longitude; end if;

  d_now := case when lat1 is null then null else sqrt(power((lat1 - dlat) * 111.0, 2) + power((lon1 - dlon) * 111.0 * cos(radians(dlat)), 2)) end;
  d_old := case when lat0 is null then null else sqrt(power((lat0 - dlat) * 111.0, 2) + power((lon0 - dlon) * 111.0 * cos(radians(dlat)), 2)) end;

  pick := g.pickup_battery; batt := v.battery_pct;
  short := (pick is not null and batt is not null and batt < pick - 10);
  fresh := v.observed_at > now() - interval '30 minutes';
  efresh := e.updated_at is not null and e.updated_at > now() - interval '15 minutes';
  wind_ends := case when g.done_using_at is not null
                    then g.done_using_at + make_interval(mins => coalesce(s.wind_down_minutes, 30)) end;

  if g.host_completed_at is not null or (wind_ends is not null and now() >= wind_ends) then
    phase := 'closed';
  elsif g.done_using_at is not null then
    phase := case when short then 'wrapping_low' else 'wrapping' end;
  elsif (rs->>'spot') is not null and coalesce(fresh, false) then
    phase := case when short then 'home_low' else 'home' end;
  elsif (n_pts >= 2 and d_old is not null and d_now is not null and d_old - d_now > 0.5)
     or (efresh and coalesce(e.moving, false) and e.minutes <= 60) then
    phase := 'heading_home';
  else
    phase := 'away';
  end if;

  select count(*), coalesce(sum(coalesce(c.cost, 0) + coalesce(c.idle_fee, 0)), 0)
    into sc_n, sc_cost from trip_charges c where c.reservation_id = p_res and coalesce(c.supercharger, false);

  return jsonb_build_object(
    'phase', phase, 'pickup', pick, 'battery', batt, 'short', short,
    'delta', case when pick is not null and batt is not null then batt - pick end,
    'eta_min', case when efresh then e.minutes end, 'eta_at', case when efresh then e.eta_at end,
    'dist_mi', case when d_now is null then null else round((d_now / 1.609)::numeric, 1) end,
    'done_using_at', g.done_using_at, 'wind_ends_at', wind_ends,
    'wind_left_min', case when wind_ends is not null and wind_ends > now()
                          then ceil(extract(epoch from (wind_ends - now())) / 60)::int end,
    'late_min', nullif(coalesce(g.late_minutes, 0), 0),
    'quiet_since', g.quiet_since, 'key_off', (select removed_at is not null from tesla_guest_keys where reservation_id = p_res),
    'sc_stops', sc_n, 'sc_cost', round(sc_cost, 2));
end $$;
revoke all on function public.trip_return_phase(bigint) from public, anon, authenticated;
grant execute on function public.trip_return_phase(bigint) to service_role;

-- The key comes off when the wind-down ends, or at the ceiling if nothing ever confirmed.
create or replace function public.turo_key_due_off(p_res bigint) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare g lax_guest_links; t turo_trips; k tesla_guest_keys; s tesla_key_settings; rs jsonb; w timestamptz;
begin
  select * into s from tesla_key_settings where id = 1;
  select * into g from lax_guest_links where reservation_id = p_res;
  select * into t from turo_trips where reservation_id = p_res;
  select * into k from tesla_guest_keys where reservation_id = p_res;
  if k.reservation_id is null or k.removed_at is not null then
    return jsonb_build_object('due', false, 'why', 'no live key');
  end if;
  w := case when g.done_using_at is not null
            then g.done_using_at + make_interval(mins => coalesce(s.wind_down_minutes, 30)) end;
  if w is not null and now() >= w then
    return jsonb_build_object('due', true, 'why', 'the wind-down after they finished has run out', 'at', w);
  end if;
  rs := public.car_return_state();
  if now() > t.ends_at + make_interval(hours => coalesce(s.key_ceiling_hours, 2))
     and (rs->>'spot') is not null and coalesce((rs->>'locked')::boolean, false) then
    return jsonb_build_object('due', true, 'why', 'the ceiling passed and the car is home and locked', 'at', now());
  end if;
  return jsonb_build_object('due', false, 'why', coalesce(
    case when w is not null then 'the wind-down ends at ' || to_char(w at time zone 'America/Los_Angeles', 'HH12:MI AM') end,
    'the handoff has not closed yet'), 'wind_ends_at', w);
end $$;
revoke all on function public.turo_key_due_off(bigint) from public, anon, authenticated;

select cron.schedule('turo-handoff-tick', '*/2 * * * *', 'select public.turo_handoff_tick()');

-- Team card (CLAUDE.md: every bot gets one the day it goes live). Applied by hand 2026-10-05.
select public.team_onboard('[{
  "slug":"turo-handoff-close","name":"Handoff Closer","role":"Decides when a guest is really done with the car",
  "what_it_does":"Every 2 minutes it reads the car and asks one question: has the guest actually walked away? At the pickup spot, locked, nothing open, climate off, nobody in the seat, and quiet that way for 10 minutes. The moment that holds it stamps when they finished, freezes how late the return was, starts the 30-minute wind-down on the Live Activity and hands the guest key over for removal. If a trip cannot close itself it logs it and tells Jared once it is over an hour.",
  "reports_to":"turo-reader","runs_on":"supabase","schedule":"every 2 min","icon":"car-key",
  "pulse":{"src":"cron","key":"turo-handoff-tick","gap":10},
  "owns":["turo.handoff"]}]'::jsonb);
