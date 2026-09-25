-- Holding a key longer is the safe direction, so the new gate fails safe — which means it can also
-- fail silently forever. Watch both ends: a key held because the car never came back, and a key
-- that should have gone and did not.
create or replace function public.t_ended_long_ago(p_at timestamptz)
returns boolean language sql immutable as $$ select p_at < now() - interval '2 hours' $$;

create or replace function public.key_hold_watchdog()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare r record; st jsonb; rr jsonb; v_held text; v_stuck int := 0; v_nudged int := 0; v_win boolean;
begin
  st := public.car_return_state();

  for r in
    select k.reservation_id, k.status, k.driver_name, t.guest_first, t.ends_at, l.settled_at
      from public.tesla_guest_keys k
      join public.turo_trips t using (reservation_id)
      left join public.lax_guest_links l using (reservation_id)
     where k.status in ('ready','accepted','removing')
       and t.ends_at < now() - interval '2 hours'
  loop
    rr := public.key_removal_ready(r.reservation_id);

    if (rr->>'ready')::boolean then
      if r.status <> 'removing' or r.settled_at < now() - interval '30 minutes' then
        if tesla_key_enqueue(r.reservation_id, 'key_remove',
             jsonb_build_object('invite_id', (select invite_id from public.tesla_guest_keys where reservation_id = r.reservation_id),
                                'baseline', coalesce((select baseline_drivers from public.tesla_guest_keys where reservation_id = r.reservation_id), '[]'::jsonb),
                                'share_user_id', (select share_user_id from public.tesla_guest_keys where reservation_id = r.reservation_id))) then
          update public.tesla_guest_keys set status = 'removing', updated_at = now() where reservation_id = r.reservation_id;
          v_nudged := v_nudged + 1;
        end if;
      end if;
      v_stuck := v_stuck + 1;
    elsif t_ended_long_ago(r.ends_at) then
      v_held := concat_ws('; ', v_held,
        format('%s still has a key %s after their trip ended — %s',
               coalesce(r.driver_name, r.guest_first, 'the guest'),
               case when now() - r.ends_at > interval '48 hours'
                    then format('%s days', round(extract(epoch from now() - r.ends_at) / 86400))
                    else format('%s hours', round(extract(epoch from now() - r.ends_at) / 3600)) end,
               rr->>'why'));
    end if;
  end loop;

  if v_held is not null then
    perform public.bestly_raise('key.held', 'problem', 'warning',
      'Turo Watch: a guest key is still live after the trip',
      v_held || '. This is deliberate — the key is not taken away until the car is back at the spot, locked and shut. Remove it by hand in the Tesla app if the car is not coming back.',
      'turo', null, true);
  else
    perform public.bestly_raise('key.held', 'resolved', 'info', null);
  end if;

  if v_nudged > 0 then
    perform public.bestly_raise('key.stuck', 'problem', 'info',
      'Turo Watch: re-sent a key removal that had not gone through',
      format('%s key removal(s) were ready and still on the car, so the command was queued again.', v_nudged),
      'turo', null, true);
  else
    perform public.bestly_raise('key.stuck', 'resolved', 'info', null);
  end if;

  -- The gate leans on what the car reports. If the window sensor never appears we are judging
  -- "shut" on doors and boots alone, and should know that rather than assume.
  v_win := (st->>'windows_open') is not null;
  if not v_win then
    perform public.bestly_raise('key.windowsignal', 'problem', 'info',
      'Turo Watch: no window state from the car',
      'Nothing in the feed reports the windows, so "shut" is being judged on the doors, boot and frunk alone. A window left down will not hold the key back.',
      'turo', null, true);
  else
    perform public.bestly_raise('key.windowsignal', 'resolved', 'info', null);
  end if;

  return jsonb_build_object('ok', true, 'ready_but_present', v_stuck, 'renudged', v_nudged,
                            'held', v_held, 'window_signal', v_win, 'car', st);
end $$;

select cron.schedule('key-hold-watchdog', '11 * * * *', $$select public.key_hold_watchdog()$$);

delete from public.scout_lessons where signature = 'turo:key-removal-waits-for-the-car';
insert into public.scout_lessons (scope, title, when_text, do_text, avoid_text, signature, source, active)
values (
  'turo',
  'A guest key expires when the car is back, never on the clock',
  'anything that removes, revokes or schedules the end of a guest''s Tesla access, or a guest reporting they cannot get into the car',
  'key_removal_ready(reservation_id) is the gate and it answers in words. It requires the reservation to be over (or Turo checked out) AND car_return_state() settled: a reading under 30 minutes old, the car within 350m of N Kings Rd or the LAX garage, locked, and no boot, frunk or window we can see standing open — then held for tesla_key_settings.settle_minutes, 10 by default, restarted if anything opens again. lax_guest_links.settled_at carries that clock. key_hold_watchdog runs hourly at :11: it re-sends a removal that was ready and did not take, and reports a key still live long after a trip with the reason.',
  'Never remove a key on a timer. tesla_keys_tick used to fire at the reservation end plus remove_after, and had a second branch that removed the key SIX HOURS BEFORE the end if Turo said the guest had checked out. Guests routinely bring the car back late without extending in Turo, and a guest who has stepped out at a Supercharger is locked out of the car by a timed removal. Turo''s checked-out flag says nothing about where the car is.',
  'turo:key-removal-waits-for-the-car',
  'incident',
  true
);
