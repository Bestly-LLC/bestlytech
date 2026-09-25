-- Demo key: "checks are stuck" alarm now keys off what is actually stuck, not a time window.
--
-- What went wrong on 2026-09-24 4:32 PM PT: demo_key_tick raised "Demo key checks are stuck" whenever no demo
-- key_check had COMPLETED in the last 10 minutes. But the tick itself only enqueues a backup check when the last
-- one is 5+ minutes old, and it runs every 5 minutes, so the checks land 5 or 10 minutes apart depending on
-- millisecond jitter. The previous check was 10 min 0.03 s old -> alarm, worker healthy the whole time
-- (every check finished in 2-4 s). The 5:02 PM hotfix widened the window to 20 minutes, which hides the race
-- but keeps the guess, and still counted a single failed check (status <> 'done') as "stuck" for 30 minutes.
--
-- Now two honest signals, either of which means the demo page really would sit on "Checking with Tesla":
--   1. STUCK: a demo job (key_check / key_create / key_remove) has sat queued or running for 3+ minutes.
--      tesla_worker_claim() times such jobs out within 5 minutes, so this only happens when the worker is
--      not claiming at all - the alert says when the worker was last seen.
--   2. FAILING: the last three demo key_checks all failed (Tesla errors or the worker's own 'timed out'),
--      with the newest inside 30 minutes - the alert carries the error text.
-- Same hourly dedupe key as before, so Scout's history stays continuous.

CREATE OR REPLACE FUNCTION public.demo_key_tick()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare d demo_key; fs tesla_fleet_settings; ids jsonb; out jsonb := '{}'::jsonb;
        v_job_action text; v_job_mins int; v_n int; v_fail int; v_last timestamptz; v_err text;
begin
  select * into d from demo_key where id = 1;
  select * into fs from tesla_fleet_settings where id = 1;
  if fs.connected_at is null then return jsonb_build_object('off','tesla not connected'); end if;
  if d.status = 'creating' and d.updated_at < now() - interval '20 minutes' and not demo_key_busy() then
    update demo_key set status = 'failed', fails = fails + 1, last_error = coalesce(last_error, 'Worker never answered'), updated_at = now() where id = 1;
    d.status := 'failed';
  end if;
  select jsonb_agg(share_user_id) into ids from demo_key_drivers where removed_at is null and remove_at <= now();
  if ids is not null and demo_key_enqueue('key_remove', jsonb_build_object('only', ids, 'baseline', '[]'::jsonb)) then
    out := out || jsonb_build_object('remove', ids);
  end if;
  if not d.enabled then
    if d.invite_id is not null and demo_key_enqueue('key_remove', jsonb_build_object('invite_id', d.invite_id, 'only', '["none"]'::jsonb, 'baseline','[]'::jsonb, 'revoke_only', true)) then
      out := out || '{"revoke":true}';
    end if;
    return out;
  end if;
  if d.status = 'ready' and d.invite_expires_at < now() + interval '10 minutes' then
    update demo_key set status = 'none', updated_at = now() where id = 1; d.status := 'none';
  end if;
  if (d.status = 'none' or (d.status = 'failed' and d.fails < 5 and d.updated_at < now() - interval '10 minutes'))
     and coalesce(d.last_view_at, 'epoch') > now() - interval '7 days' and demo_key_enqueue('key_create') then
    update demo_key set status = 'creating', updated_at = now() where id = 1;
    out := out || '{"create":true}';
  end if;
  if d.status = 'ready' and d.last_view_at > now() - interval '30 minutes' and coalesce(d.last_check_at,'epoch') < now() - interval '5 minutes'
     and demo_key_enqueue('key_check', jsonb_build_object('baseline', demo_key_baseline())) then
    update demo_key set last_check_at = now() where id = 1;
  end if;

  -- Stuck or failing checks while the demo page is in use (see the header of this migration).
  if d.status = 'ready' and d.last_view_at > now() - interval '30 minutes' then
    select action, (extract(epoch from now() - created_at) / 60)::int into v_job_action, v_job_mins
      from tesla_fleet_commands
     where args->>'demo' = 'true' and status in ('queued','running')
       and created_at between now() - interval '30 minutes' and now() - interval '3 minutes'
     order by created_at limit 1;
    if v_job_action is not null then
      perform scout_notify('Demo key checks are stuck',
        'A demo ' || v_job_action || ' job has been waiting ' || v_job_mins || ' min and the Tesla worker has not picked it up'
        || case when fs.worker_seen_at is null then '' else ' (worker last seen ' || to_char(fs.worker_seen_at at time zone 'America/Los_Angeles', 'FMHH12:MI AM') || ' PT)' end
        || '. The demo page will sit on "Checking with Tesla" until it does. Check the Tesla worker on the Mac.',
        'warning', true, '/admin/turo/settings#demo-key', 'demo-key-check-stuck-' || to_char(now(),'YYYYMMDDHH24'));
    else
      select count(*), count(*) filter (where status = 'failed'), max(created_at),
             (array_agg(result->>'error' order by created_at desc) filter (where status = 'failed'))[1]
        into v_n, v_fail, v_last, v_err
        from (select status, created_at, result from tesla_fleet_commands
               where args->>'demo' = 'true' and action = 'key_check' and status in ('done','failed')
               order by created_at desc limit 3) x;
      if v_n = 3 and v_fail = 3 and v_last > now() - interval '30 minutes' then
        perform scout_notify('Demo key checks are failing',
          'The last 3 Tesla driver checks from the demo page failed' || coalesce(': ' || left(v_err, 200), '')
          || '. The page will sit on "Checking with Tesla" until one succeeds. Check the Tesla worker on the Mac and the Tesla connection in Turo settings.',
          'warning', true, '/admin/turo/settings#demo-key', 'demo-key-check-stuck-' || to_char(now(),'YYYYMMDDHH24'));
      end if;
    end if;
  end if;

  if exists (select 1 from demo_key_drivers where removed_at is null and remove_at < now() - interval '30 minutes') then
    perform scout_notify('Demo driver still on Blue Steel', 'A driver added from the demo page wasn''t removed on time. Retrying every 5 min. Check Tesla app > Add Driver, or Turo settings > Demo key.',
      'critical', true, '/admin/turo/settings#demo-key', 'demo-key-stuck-' || to_char(now(),'YYYYMMDDHH24'));
  end if;
  if d.status = 'failed' and d.fails >= 3 then
    perform scout_notify('Demo key can''t be made', coalesce(d.last_error,'unknown error') || '. The demo falls back to the pretend key.', 'warning', false,
      '/admin/turo/settings#demo-key', 'demo-key-fail-' || to_char(now(),'YYYYMMDD'));
  end if;
  return out;
end $function$;
