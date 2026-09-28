-- The Tesla worker (Mac mini) makes guest keys. When it stops answering, key_create jobs sit unclaimed until
-- the 7-minute watchdog fails them ("timed out (watchdog)") and the guest page hangs on "Making your key".
-- This watch (every 5 min):
--   1. tells Scout the worker is down, in plain words, while any worker job is stuck or has just timed out;
--   2. the moment the worker answers again, gives guest keys that died that way a fresh start (attempts reset),
--      so they are made on the next scheduler tick instead of staying failed after the 4-try limit.
create or replace function public.tesla_worker_alive_watch()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_stuck int; v_timedout int; v_last timestamptz; v_alive boolean; v_healed int := 0; ks tesla_key_settings;
begin
  select count(*) into v_stuck from tesla_fleet_commands
   where via is null and status = 'queued' and claimed_at is null and created_at < now() - interval '4 minutes';
  select count(*) into v_timedout from tesla_fleet_commands
   where via is null and status = 'failed' and result->>'error' = 'timed out (watchdog)' and done_at > now() - interval '20 minutes';
  select max(claimed_at) into v_last from tesla_fleet_commands where via is null;
  -- Back means: it picked something up in the last 3 minutes (no waiting out the 20-minute look-back).
  v_alive := (v_last is not null and v_last > now() - interval '3 minutes') or (v_stuck + v_timedout) = 0;

  if not v_alive then
    perform public.bestly_raise('tesla.worker.down', 'problem', 'warning',
      'Tesla worker on the Mac mini is not answering',
      format('%s job(s) waiting, %s timed out in the last 20 min. Last time it picked up a job: %s. Guest keys, key checks and car reads all go through it, so a guest opening their page now would see "Making your key" and nothing else. Wake or restart the Mac mini worker (see docs/tesla-worker.md). Failed keys are retried on their own once it answers.',
             v_stuck, v_timedout, coalesce(to_char(v_last at time zone 'America/Los_Angeles', 'Mon DD, HH12:MI AM'), 'never')),
      'turo', 'Wake or restart the Tesla worker on the Mac mini (docs/tesla-worker.md)', false);
  else
    perform public.bestly_raise('tesla.worker.down', 'resolved', 'info', null);
    -- Worker is back: keys that only failed because it was away get a fresh start.
    select * into ks from tesla_key_settings where id = 1;
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
select cron.schedule('tesla-worker-alive-watch', '*/5 * * * *', 'select public.tesla_worker_alive_watch()');
