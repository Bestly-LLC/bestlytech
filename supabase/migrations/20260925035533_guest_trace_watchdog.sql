-- Self-healing for the trust rules, and the lesson written down so it is not relearned.
-- (Supersedes 20260925035047 and 20260925035506, which were the same function with fewer checks.)
--
-- Four ways this goes quietly wrong: the browser id stops being sent, so every visit is anonymous
-- and the cross-trip rule can never fire; a host browser gets learned but old rows keep their old
-- label; a trip shows activity that is entirely the host's while reading as a visited page; and no
-- drive can name a driver because no guest ever accepted a digital key. All four look like healthy
-- data from the outside, which is the whole problem this set of changes exists to fix.
create or replace function public.guest_trace_watchdog()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_learned int; v_recent int; v_noid int; v_hostonly int; v_devices int;
        v_drives int; v_keyed int; v_nokeyrow int; v_ever boolean;
begin
  v_learned := public.lax_learn_host_devices();
  select count(*) into v_devices from public.lax_host_devices;

  select count(*), count(*) filter (where device_id is null)
    into v_recent, v_noid
    from public.lax_guest_events
   where at > now() - interval '24 hours' and device is not null and reservation_id > 0;

  -- Before the page shipped the browser id, every visit lacks one — the same shape as the
  -- regression this watches for. Stay quiet until at least one id has ever arrived.
  select exists (select 1 from public.lax_guest_events where device_id is not null) into v_ever;

  if v_ever and v_recent >= 5 and v_noid = v_recent then
    perform public.bestly_raise('guest.deviceid', 'problem', 'warning',
      'Trip pages: visits have stopped carrying a browser id',
      format('%s visits in 24 hours, none with a browser id. The host/guest rule needs it — without it every visit counts as the guest. Check track.ts still sends p_device_id.', v_recent),
      'turo');
  else
    perform public.bestly_raise('guest.deviceid', 'resolved', 'info', null);
  end if;

  select count(*) into v_hostonly from (
    select reservation_id from public.lax_guest_events
     where reservation_id > 0 and device is not null
     group by 1 having count(*) filter (where actor = 'guest') = 0 and count(*) > 0
  ) t;

  if v_hostonly > 0 then
    perform public.bestly_raise('guest.hostonly', 'problem', 'info',
      'Trip pages: activity on a trip is all yours',
      format('%s trip(s) have page activity but none of it from the guest. Their page has not actually been opened by them.', v_hostonly),
      'turo', null, true);
  else
    perform public.bestly_raise('guest.hostonly', 'resolved', 'info', null);
  end if;

  select count(*), count(*) filter (where a.basis = 'key')
    into v_drives, v_keyed
    from (select distinct reservation_id r from public.car_drives
           where reservation_id is not null and started_at > now() - interval '60 days') d
    cross join lateral public.trip_drive_attribution(d.r) a;

  select count(*) into v_nokeyrow
    from (select distinct reservation_id r from public.car_drives
           where reservation_id is not null and started_at > now() - interval '60 days') d
   where not exists (select 1 from public.tesla_guest_keys k
                      where k.reservation_id = d.r and k.accepted_at is not null);

  if v_drives >= 3 and v_keyed = 0 then
    perform public.bestly_raise('guest.driveproof', 'problem', 'info',
      'Turo Watch: no drive can name who was driving',
      format('%s drives in 60 days, none inside a window where a named Tesla account held a digital key (%s trip(s) have no accepted key on record). Every drive is attributed by the booking alone, which does not rule out you.', v_drives, v_nokeyrow),
      'turo', null, true);
  else
    perform public.bestly_raise('guest.driveproof', 'resolved', 'info', null);
  end if;

  return jsonb_build_object('ok', true, 'host_devices', v_devices, 'learned', v_learned,
                            'visits_24h', v_recent, 'without_id', v_noid, 'ids_ever_seen', v_ever,
                            'host_only_trips', v_hostonly, 'drives_60d', v_drives,
                            'key_attributed', v_keyed, 'trips_without_accepted_key', v_nokeyrow);
end $$;

select cron.schedule('guest-trace-watchdog', '23 * * * *', $$select public.guest_trace_watchdog()$$);

-- The lesson, so the next session does not rebuild the same false confidence.
delete from public.scout_lessons where signature = 'turo:guest-activity-actor';
insert into public.scout_lessons (scope, title, when_text, do_text, avoid_text, signature, source, active)
values (
  'turo',
  'Guest activity only counts when it can tell the host from the guest',
  'reading a trip page''s traced history, answering "did the guest actually do this", or building anything that records who did something',
  'lax_guest_events.actor is the answer: guest, host, or unsure. A browser id (bestly-did in localStorage) goes with every visit, and a browser seen on two different trip pages is the host — a guest only ever sees their own trip — so it is written to lax_host_devices and its past events are relabelled. lax_guest_activity(res) is the counted version; use it rather than counting rows. For the car, use trip_drive_attribution(res): basis=key means a named Tesla account held a live digital key across that drive, basis=booking only means a trip was active. guest_trace_watchdog runs hourly at :23.',
  'Do not treat a client-side host check as exclusion — the old filter only skipped browsers signed in to the admin or carrying the bestly-host flag, so Jared''s own iPhone opening a link he had just sent was logged as the guest, twice, on 23 Sep 2026. Do not describe "a trip was active" as proof of who was driving.',
  'turo:guest-activity-actor',
  'incident',
  true
);
