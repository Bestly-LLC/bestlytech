-- Turo pick-up hand-off detection without TezLab (Claude 2026-10-11).
-- The pick-up Live Activity completes when the guest key is on the car and the car shows it was used:
--   gear in D/R/N or speed > 0  -> 'drove'
--   odometer 0.3 mi past the first reading after key-on-car -> 'drove'
--   seat sensor (is_user_present) true -> 'seat'
-- Readings come from the Pi Tesla worker (Fleet API, drive_state added), merged into turo_vehicle_state.raw.fleet_api.
-- Watchdog: if a trip is mid-pickup and the car has not reported for 30+ min, raise monitor turo.handoff_stale
-- (owner Turo Reader, p_healed = true so it goes to Scout / the bell and never pushes Jared's phone).
create or replace function public.turo_handoff_detect()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record; v turo_vehicle_state; fa jsonb; odo numeric; po numeric; how text; kt timestamptz; fvin text;
  n_set int := 0; n_stale int := 0; stale_names text := ''; stale_car text; stale_at timestamptz;
begin
  select vin into fvin from tesla_fleet_settings where id = 1;
  for r in
    select * from (
      select t.reservation_id, coalesce(t.vin, fvin) as vin, t.guest_first, k.accepted_at, g.pickup_odometer,
             (select min(d.first_seen) from car_drivers_seen d where d.reservation_id = t.reservation_id) as seen_at
        from turo_trips t
        join tesla_guest_keys k on k.reservation_id = t.reservation_id
        join lax_guest_links g on g.reservation_id = t.reservation_id
       where t.starts_at between now() - interval '12 hours' and now() + interval '3 hours'
         and t.ends_at > now()
         and coalesce(t.status, '') not ilike '%cancel%'
         and g.handed_at is null
         and k.checkin_ok_at is not null
    ) q
    where q.seen_at is not null or q.accepted_at is not null
  loop
    kt := coalesce(r.seen_at, r.accepted_at);
    select * into v from turo_vehicle_state where vin = r.vin;

    if v.vin is null or v.observed_at < now() - interval '30 minutes' then
      n_stale := n_stale + 1;
      stale_names := stale_names || case when stale_names = '' then '' else ', ' end || coalesce(r.guest_first, 'a guest');
      stale_car := coalesce(v.display_name, 'the Tesla');
      stale_at := v.observed_at;
      continue;
    end if;

    if v.observed_at <= kt then continue; end if;

    fa := coalesce(v.raw -> 'fleet_api', '{}'::jsonb);
    odo := coalesce(nullif(fa ->> 'odometer', '')::numeric, v.odometer);
    po := r.pickup_odometer;
    if po is null and odo is not null then
      update lax_guest_links set pickup_odometer = odo where reservation_id = r.reservation_id and pickup_odometer is null;
      po := odo;
    end if;

    how := case
      when coalesce(fa ->> 'shift', '') in ('D', 'R', 'N') or coalesce(nullif(fa ->> 'speed_mph', '')::numeric, 0) > 0 then 'drove'
      when odo is not null and po is not null and odo > po + 0.3 then 'drove'
      when coalesce((fa ->> 'user_present')::boolean, false) then 'seat'
      else null end;

    if how is not null then
      update lax_guest_links set handed_at = v.observed_at, handed_how = how
       where reservation_id = r.reservation_id and handed_at is null;
      n_set := n_set + 1;
    end if;
  end loop;

  if n_stale > 0 then
    perform bestly_raise('turo.handoff_stale', 'problem', 'warning',
      'Can''t see ' || stale_car || '''s status for 30+ min during ' || stale_names || '''s pickup',
      'Last reading from the car was ' || coalesce(to_char(stale_at at time zone 'America/Los_Angeles', 'FMHH12:MI AM'), 'never')
        || '. The pick-up card can''t tell the guest has left until the car reports again. Turo Reader is watching; it clears itself when readings return.',
      'turo', null, true);
  elsif exists (select 1 from monitor_issues where key = 'turo.handoff_stale' and status = 'open') then
    perform bestly_raise('turo.handoff_stale', 'resolved', 'info', 'Car status is reporting again during pickup', null, 'turo');
  end if;

  return jsonb_build_object('ok', true, 'handed', n_set, 'stale', n_stale);
end
$function$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'turo-handoff-detect') then perform cron.unschedule('turo-handoff-detect'); end if;
  perform cron.schedule('turo-handoff-detect', '* * * * *', 'select public.turo_handoff_detect()');
end $$;
