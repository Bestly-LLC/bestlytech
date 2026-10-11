-- Cloud employee fixes, 2026-10-11 (stressed moods on the team page).
--
-- 1. watchdogs: "83 checks, 6 failing" was a false count. team_mood_sweep runs inside the org-chart-watch job at :x7,
--    the same minute that about eight other watch jobs start. pg_cron shows those as 'running' while the sweep samples,
--    and team_pulses counted anything that was not 'succeeded' as failing. A run in flight is not a failure: its ok is now
--    null (unknown), which every reader already treats as "not failing" (cron_family uses coalesce(ok, true)).
-- 2. lax-concierge: guest.hostonly looked at every trip that ever had page activity, forever. Two September trips with
--    only "unsure" visits kept the incident open for 400+ checks while no guest was booked. It now looks only at trips
--    that have not ended yet (turo_trips.ends_at > now()), so no live trips means nothing to flag.
-- 3. wall: wall.data_freshness was a Scout idea ("make a watchdog") that already exists: wall_feeds_watch (every 10 min,
--    one incident per feed) plus the Wall card's wall_state.pulled_at pulse. Every feed is fresh, so close it.

create or replace function public.team_pulses()
 returns table(slug text, last_at timestamptz, last_ok boolean, summary text)
 language plpgsql security definer
 set search_path to 'public', 'cron'
as $function$
declare
  a record; p jsonb; v_cron jsonb; r record;
  v_at timestamptz; v_ok boolean; v_sum text;
begin
  select coalesce(jsonb_object_agg(j.jobname, jsonb_build_object('at', d.end_time, 'start', d.start_time,
           'ok', case when d.status in ('running', 'starting') then null else d.status = 'succeeded' end,
           'msg', left(d.return_message, 160), 'active', j.active)), '{}')
    into v_cron
    from cron.job j
    left join lateral (select x.end_time, x.start_time, x.status, x.return_message
                    from (select distinct on (jobid) jobid, end_time, start_time, status, return_message
                            from cron.job_run_details where start_time > now() - interval '3 days'
                           order by jobid, start_time desc) x where x.jobid = j.jobid) d on true;

  for a in select * from bestly_agents where status <> 'retired' and pulse is not null loop
    p := a.pulse; v_at := null; v_ok := null; v_sum := null;
    begin
      case p->>'src'
        when 'at' then
          execute format('select %I::timestamptz, (%s)::boolean, (%s)::text from %I where %s order by %I desc nulls last limit 1',
                         p->>'col', coalesce(p->>'ok', 'true'), coalesce(p->>'sum', 'null'), p->>'table',
                         coalesce(p->>'where', 'true'), p->>'col')
            into v_at, v_ok, v_sum;
        when 'pi_job' then
          select coalesce(j.last_run_at, j.last_ok_at), j.last_ok,
                 case when not j.enabled then 'Switched off on the Pi' else j.last_summary end
            into v_at, v_ok, v_sum
            from pi_jobs j where j.job = p->>'key';
        when 'pi_any' then
          select max(last_run_at), bool_and(coalesce(consecutive_failures, 0) = 0),
                 count(*) filter (where enabled) || ' jobs, ' || count(*) filter (where enabled and coalesce(consecutive_failures,0) > 0) || ' failing'
            into v_at, v_ok, v_sum from pi_jobs where enabled;
        when 'cron' then
          if v_cron ? (p->>'job') and not coalesce((v_cron->(p->>'job')->>'active')::boolean, true) then
            -- switched off on purpose: never "gone quiet"
            v_at := null; v_ok := null; v_sum := 'Switched off in the schedule';
          elsif not (v_cron ? (p->>'job')) then
            v_at := null; v_ok := false; v_sum := 'Its schedule entry is gone';
          else
            v_at := coalesce((v_cron->(p->>'job')->>'at')::timestamptz, (v_cron->(p->>'job')->>'start')::timestamptz);
            v_ok := (v_cron->(p->>'job')->>'ok')::boolean;
            v_sum := case when v_ok is false then 'Last run failed: ' || coalesce(v_cron->(p->>'job')->>'msg', '') end;
          end if;
        when 'cron_family' then
          select max(coalesce((e.value->>'at')::timestamptz, (e.value->>'start')::timestamptz)),
                 bool_and(coalesce((e.value->>'ok')::boolean, true)),
                 count(*) || ' checks, ' || count(*) filter (where (e.value->>'ok')::boolean is false) || ' failing'
            into v_at, v_ok, v_sum
            from jsonb_each(v_cron) e where e.key like (p->>'like') and coalesce((e.value->>'active')::boolean, true);
        when 'beat' then
          select b.at, b.ok, b.summary into v_at, v_ok, v_sum from agent_beats b where b.slug = a.slug;
        else null;
      end case;
    exception when others then
      v_at := null; v_ok := false; v_sum := 'Could not read its check-in: ' || left(sqlerrm, 120);
    end;
    if p->>'src' <> 'beat' then
      select b.at as bat, b.ok as bok, coalesce(b.summary, v_sum) as bsum into r from agent_beats b
       where b.slug = a.slug and (v_at is null or b.at > v_at);
      if found then v_at := r.bat; v_ok := r.bok; v_sum := r.bsum; end if;
    end if;
    slug := a.slug; last_at := v_at; last_ok := v_ok; summary := v_sum;
    return next;
  end loop;
end $function$;

-- guest.hostonly only for trips that have not ended
create or replace function public.guest_trace_watchdog()
 returns jsonb
 language plpgsql security definer
 set search_path to 'public'
as $function$
declare v_learned int; v_recent int; v_noid int; v_hostonly int; v_unsureonly int; v_devices int;
        v_drives int; v_keyed int; v_nokeyrow int; v_ever boolean;
begin
  v_learned := public.lax_learn_host_devices();
  select count(*) into v_devices from public.lax_host_devices;

  select count(*), count(*) filter (where device_id is null)
    into v_recent, v_noid
    from public.lax_guest_events
   where at > now() - interval '24 hours' and device is not null and reservation_id > 0;

  select exists (select 1 from public.lax_guest_events where device_id is not null) into v_ever;

  if v_ever and v_recent >= 5 and v_noid = v_recent then
    perform public.bestly_raise('guest.deviceid', 'problem', 'warning',
      'Trip pages: visits have stopped carrying a browser id',
      format('%s visits in 24 hours, none with a browser id. The host/guest rule needs it — without it every visit counts as the guest. Check track.ts still sends p_device_id.', v_recent),
      'turo');
  else
    perform public.bestly_raise('guest.deviceid', 'resolved', 'info', null);
  end if;

  -- only trips that are booked or running: a finished trip can no longer be opened by its guest, and no trips means nothing to flag
  select count(*) filter (where host_n > 0 and unsure_n = 0),
         count(*) filter (where unsure_n > 0)
    into v_hostonly, v_unsureonly
    from (select e.reservation_id,
                 count(*) filter (where e.actor = 'host')   host_n,
                 count(*) filter (where e.actor = 'unsure') unsure_n
            from public.lax_guest_events e
            join public.turo_trips tt on tt.reservation_id = e.reservation_id
           where e.reservation_id > 0 and e.device is not null
             and tt.ends_at > now() and coalesce(tt.status, '') not ilike '%cancel%'
           group by 1
          having count(*) filter (where e.actor = 'guest') = 0 and count(*) > 0) t;

  if v_hostonly + v_unsureonly > 0 then
    perform public.bestly_raise('guest.hostonly', 'problem', 'info',
      'Trip pages: no confirmed guest visits',
      format('%s trip(s) have page activity with nothing confirmed as the guest%s. Do not read these pages as opened by them.',
             v_hostonly + v_unsureonly,
             case when v_unsureonly > 0 then format(' — %s of them only have visits from a browser that was also used elsewhere, which cannot be attributed either way', v_unsureonly) else ', all of it yours' end),
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
   where not exists (select 1 from public.car_drivers_seen s where s.reservation_id = d.r);

  if v_drives >= 3 and v_keyed = 0 then
    perform public.bestly_raise('guest.driveproof', 'problem', 'info',
      'Turo Watch: no drive can name who was driving',
      format('%s drives in 60 days, none inside a window where a named account held a key to the car (%s trip(s) have nobody on the roster). Every drive is attributed by the booking alone, which does not rule out you.', v_drives, v_nokeyrow),
      'turo', null, true);
  else
    perform public.bestly_raise('guest.driveproof', 'resolved', 'info', null);
  end if;

  return jsonb_build_object('ok', true, 'host_devices', v_devices, 'learned', v_learned,
                            'visits_24h', v_recent, 'without_id', v_noid, 'ids_ever_seen', v_ever,
                            'trips_host_only', v_hostonly, 'trips_unsure_only', v_unsureonly,
                            'drives_60d', v_drives, 'key_attributed', v_keyed,
                            'trips_without_roster', v_nokeyrow);
end $function$;

-- wall.data_freshness: the watchdog it asked for already exists; every feed is fresh
select public.fix_log_add('wall.data_freshness', 'claude',
  'Closed: the freshness watchdog already exists (wall_feeds_watch every 10 min raises one incident per stale feed, and the Wall card reads wall_state.pulled_at). All 10 feeds are inside their refresh window.', true);
select public.bestly_raise('wall.data_freshness', 'resolved', 'info', 'Wall data freshness is already watched');
