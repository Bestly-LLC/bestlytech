-- Watch the roster itself, because every failure here is silent by construction.
create or replace function public.car_drivers_watchdog()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_last timestamptz; v_on int; v_unknown text; v_stale text; v_names text;
begin
  select max(coalesce(done_at, created_at)) into v_last
    from public.tesla_fleet_commands where status = 'done' and result ? 'drivers';

  if v_last is null or v_last < now() - interval '3 hours' then
    perform public.bestly_raise('car.roster', 'problem', 'warning',
      'Turo Watch: the car has stopped reporting its drivers',
      format('Last driver list %s. Without it nothing can say who held a key, and every drive falls back to the booking window.',
             coalesce(to_char(v_last at time zone 'America/Los_Angeles', 'Mon FMDD, FMHH12:MI AM'), 'never')),
      'turo');
  else
    perform public.bestly_raise('car.roster', 'resolved', 'info', null);
  end if;

  select count(*), string_agg(name, ', ') into v_on, v_names
    from public.car_drivers_seen
   where gone_at is null and share_user_id not in (select share_user_id from public.car_host_drivers);

  -- Somebody holds a key we never issued. Dylan Hunt was exactly this, for days.
  select string_agg(s.name, ', ') into v_unknown
    from public.car_drivers_seen s
   where s.gone_at is null
     and s.share_user_id not in (select share_user_id from public.car_host_drivers)
     and not exists (select 1 from public.tesla_guest_keys k where k.share_user_id = s.share_user_id)
     and not exists (select 1 from public.trip_extra_drivers t where t.share_user_id = s.share_user_id)
     and not exists (select 1 from public.demo_key_drivers d where d.share_user_id = s.share_user_id);

  if v_unknown is not null then
    perform public.bestly_raise('car.keyunknown', 'problem', 'info',
      'Turo Watch: a key on the car was not issued here',
      format('%s hold a key we have no invite record for. It is now on the roster and their drives will be attributed, but nothing in Bestly granted it — so nothing here will remove it either.', v_unknown),
      'turo', null, true);
  else
    perform public.bestly_raise('car.keyunknown', 'resolved', 'info', null);
  end if;

  select string_agg(format('%s (%s ended %s)', s.name, t.guest_first,
                           to_char(t.ends_at at time zone 'America/Los_Angeles', 'Mon FMDD')), '; ')
    into v_stale
    from public.car_drivers_seen s
    join public.turo_trips t on t.reservation_id = s.reservation_id
   where s.gone_at is null
     and s.share_user_id not in (select share_user_id from public.car_host_drivers)
     and t.ends_at < now() - interval '2 hours';

  if v_stale is not null then
    perform public.bestly_raise('car.keystale', 'problem', 'warning',
      'Turo Watch: someone still has a key after their trip',
      format('%s. Remove them in the Tesla app.', v_stale), 'turo', null, true);
  else
    perform public.bestly_raise('car.keystale', 'resolved', 'info', null);
  end if;

  return jsonb_build_object('ok', true, 'last_roster_at', v_last, 'holding_keys', v_on, 'who', v_names,
                            'not_issued_here', v_unknown, 'past_trip_end', v_stale);
end $$;

select cron.schedule('car-drivers-watchdog', '47 * * * *', $$select public.car_drivers_watchdog()$$);

delete from public.scout_lessons where signature = 'turo:car-driver-roster';
insert into public.scout_lessons (scope, title, when_text, do_text, avoid_text, signature, source, active)
values (
  'turo',
  'The car already tells us who holds a key — read the whole list, not the diff',
  'asking who was driving, attributing a drive, checking whether a guest has a key, or building anything on tesla_guest_keys',
  'car_drivers_seen is the roster: every Tesla account that has held a key to the car and the window it held it, maintained by a trigger on tesla_fleet_commands from the drivers list key_check returns every 5 minutes. car_host_drivers holds Jared''s own share accounts and is excluded. trip_drive_attribution prefers this over tesla_guest_keys. car_drivers_watchdog runs hourly at :47 and flags a key nobody issued, a key still on the car after the trip ended, and the roster going stale.',
  'Do not treat tesla_guest_keys as the record of who has a key — it only knows about invites Bestly sent. Dylan Hunt held a mobile key for GianPaula Hulten''s Sep 2026 trip and appeared in every key_check for days, while tesla_guest_keys had no row and every drive read as "booking only". demo_key_apply consumed result->new_drivers and discarded result->drivers, which is how the answer was arriving 288 times a day and being thrown away.',
  'turo:car-driver-roster',
  'incident',
  true
);
