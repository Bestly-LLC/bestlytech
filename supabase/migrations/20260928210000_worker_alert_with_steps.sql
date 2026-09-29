-- The worker-down alert told Jared to "restart the worker" without saying how. Now it carries the exact steps.
create or replace function public.tesla_worker_alive_watch()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_stuck int; v_timedout int; v_last timestamptz; v_alive boolean; v_healed int := 0;
begin
  select count(*) into v_stuck from tesla_fleet_commands
   where via is null and status = 'queued' and claimed_at is null and created_at < now() - interval '4 minutes';
  select count(*) into v_timedout from tesla_fleet_commands
   where via is null and status = 'failed' and result->>'error' = 'timed out (watchdog)' and done_at > now() - interval '20 minutes';
  select max(claimed_at) into v_last from tesla_fleet_commands where via is null;
  v_alive := (v_last is not null and v_last > now() - interval '3 minutes') or (v_stuck + v_timedout) = 0;

  if not v_alive then
    perform public.bestly_raise('tesla.worker.down', 'problem', 'warning',
      'Tesla worker on the Mac mini is not answering',
      format($t$The Mac mini program that makes guest Tesla keys stopped answering (last answered %s). Until it is back, guests see "Making your key" and nothing else, and new bookings will not sync.

Fix, 2 steps, at the Mac mini:
1. Wake it (move the mouse) and check the Wi-Fi icon shows connected.
2. Open Terminal (Cmd+Space, type Terminal, Enter), paste this one line, press Enter:
for s in tesla-worker turo-sender; do launchctl kickstart -k gui/$(id -u)/tech.bestly.$s 2>/dev/null || launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/tech.bestly.$s.plist; done

Then wait 5 minutes. This alert clears by itself and any key that failed is remade automatically. If it is still red after that, tell Claude "worker still down" and paste what Terminal printed.$t$,
        coalesce(to_char(v_last at time zone 'America/Los_Angeles', 'Mon DD, HH12:MI AM'), 'never')),
      'turo', 'At the Mac mini: wake it, open Terminal, paste the one line from this alert', false);
  else
    perform public.bestly_raise('tesla.worker.down', 'resolved', 'info', null);
    with fixed as (
      update tesla_guest_keys k set status = 'scheduled', attempts = 0, last_error = null, updated_at = now()
        from turo_trips t
       where t.reservation_id = k.reservation_id and k.status = 'failed' and k.invite_id is null
         and k.last_error like 'timed out%' and now() < t.ends_at and coalesce(t.status,'') !~* 'cancel'
      returning 1)
    select count(*) into v_healed from fixed;
    if v_healed > 0 then perform tesla_keys_tick(); end if;
  end if;
  return jsonb_build_object('alive', v_alive, 'stuck', v_stuck, 'timed_out', v_timedout, 'last_pickup', v_last, 'keys_restarted', v_healed);
end $$;
revoke all on function public.tesla_worker_alive_watch() from public, anon, authenticated;
