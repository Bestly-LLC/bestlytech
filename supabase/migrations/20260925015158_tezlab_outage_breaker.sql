-- TezLab outages are TezLab's problem, and the trip apps should treat them that way.
--
-- What happened (2026-09-24, 4:34 PM and again 6:25 PM PT): TezLab's OAuth origin behind Cloudflare answered
-- "error code: 502" to every POST /oauth/token (a bogus refresh token got the same 502; a healthy server says
-- 400 invalid_grant), and in the same windows their MCP endpoint rejected our still-valid access token
-- (good until Oct 1) with 401 invalid_token. The very same token worked again 5:30-6:20 PM. So: their auth
-- backend was down, nothing was wrong with our credentials, and a Reconnect would have failed on the same 502.
--
-- What went wrong on our side: the tezlab function called it "token refresh failed (502)", retried the
-- refresh 3x per job (~9 s with a guest waiting before the Tesla backup), the fallback bell told Jared to
-- Reconnect, and trip health flipped broken/recovered on every 10-minute check.
--
-- This migration (with supabase/functions/tezlab/index.ts v12):
--   * tezlab_settings.down_until / down_streak: while set, new car commands skip TezLab (tesla_cmd_route uses
--     tezlab_up()) and go straight to the Mac mini Tesla worker. tezlab_down() sets it 5 -> 10 -> 20 -> 30 min;
--     tezlab_ok() clears it. The every-5-minute refresh job is the probe that notices TezLab is back.
--   * tezlab_job_fallback(): no bell for a TezLab-side outage (trip health covers it); "Reconnect" advice only
--     when TezLab actually rejected our refresh token (4xx).
--   * trip_health_run() #6: a TezLab failure counts only after 30 minutes straight; an outage is 'warn' (info,
--     no push) worded as their problem with the Tesla backup covering; anything else stays 'fail'.
--   * tezlab_admin_state(): exposes down_until / down_streak so the admin card can say "paused".

alter table public.tezlab_settings
  add column if not exists down_until timestamptz,
  add column if not exists down_streak integer not null default 0;
comment on column public.tezlab_settings.down_until is 'TezLab routing is paused until this time because TezLab''s own servers were failing (5xx / 401 on a fresh token). Cleared by the next success.';
comment on column public.tezlab_settings.down_streak is 'Consecutive TezLab-side outages seen without a success in between; sets the pause length (5, 10, 20, 30 min).';

-- Connected AND not paused. tezlab_ready() keeps meaning "connected" (the admin card and health check use it).
create or replace function public.tezlab_up() returns boolean
language sql stable security definer set search_path = public, vault as $$
  select tezlab_ready() and coalesce((select down_until is null or down_until <= now() from tezlab_settings where id = 1), false)
$$;
revoke all on function public.tezlab_up() from public;
grant execute on function public.tezlab_up() to authenticated, service_role;

-- Called by the tezlab function when TezLab's side fails (5xx, unreachable, or 401 on a token they just issued).
create or replace function public.tezlab_down(p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare streak int; mins int;
begin
  select coalesce(down_streak, 0) into streak from tezlab_settings where id = 1;
  mins := case least(streak, 3) when 0 then 5 when 1 then 10 when 2 then 20 else 30 end;
  update tezlab_settings
     set down_until = now() + make_interval(mins => mins), down_streak = streak + 1,
         last_error = left(p_error, 300), last_error_at = now()
   where id = 1;
end $$;
revoke all on function public.tezlab_down(text) from public;
grant execute on function public.tezlab_down(text) to service_role;

-- A success clears the pause.
create or replace function public.tezlab_ok() returns void
language sql security definer set search_path = public as $$
  update tezlab_settings set last_ok_at = now(), last_error = null, down_until = null, down_streak = 0 where id = 1
$$;

-- New commands skip TezLab while it is paused: straight to the Tesla worker, no waiting on a dead endpoint.
create or replace function public.tesla_cmd_route() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.action in ('cool','warm','seat','off','refresh','honk','flash','unlock','lock','windows_close','nav_charger','nav_charger_lax','nav_garage_lax','nav_home','nav_point','charges','caps','drives','cmd')
     and coalesce(new.via, '') = '' and tezlab_up() then
    new.via := 'tezlab'; new.status := 'running'; new.claimed_at := now(); new.attempts := 1;
  end if;
  return new;
end $$;

-- The job goes back to the queue for the Tesla worker. Bell only for real, repeated TezLab errors; an outage on
-- their side is already paused by tezlab_down() and reported (once it lasts) by trip health.
create or replace function public.tezlab_job_fallback(p_id bigint, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare prev timestamptz; ok timestamptz; outage boolean := p_error like 'TezLabDown:%';
begin
  select last_error_at, last_ok_at into prev, ok from tezlab_settings where id = 1;
  update tesla_fleet_commands set via = 'fleet', status = 'queued', claimed_at = null, stage = null, created_at = now(),
    result = jsonb_build_object('tezlab_error', left(p_error, 250)) where id = p_id and status = 'running';
  update tezlab_settings set last_error = left(p_error, 300), last_error_at = now() where id = 1;
  if outage then return; end if;
  -- The Tesla backup already handled this command. Only bother Jared if TezLab keeps failing
  -- (a second failure within 30 minutes with no success in between), not for a one-off blip.
  if prev is not null and prev > now() - interval '30 minutes' and (ok is null or ok < prev) then
    perform scout_notify('TezLab keeps failing (Tesla backup is covering)',
      left(regexp_replace(p_error, '^Error: ', ''), 220)
        || case when p_error ~* 'rejected our refresh token|invalid_grant|isn''t connected' then ' Reconnect it: admin > Guest Trips > Settings > TezLab > Reconnect.' else '' end,
      'warning', true, '/admin/turo/lax-pass#tezlab', 'tezlab-fail-' || to_char(now(), 'YYYYMMDDHH24'));
  end if;
end $$;

-- Admin card state, now with the pause.
create or replace function public.tezlab_admin_state() returns jsonb
language plpgsql security definer set search_path = public, vault as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return (select jsonb_build_object('connected', exists(select 1 from vault.secrets where name = 'tezlab_refresh_token'),
    'enabled', s.enabled, 'connected_at', s.connected_at, 'last_ok_at', s.last_ok_at, 'last_error', s.last_error, 'last_error_at', s.last_error_at,
    'down_until', case when s.down_until > now() then s.down_until end, 'down_streak', s.down_streak,
    'via_tezlab_30d', (select count(*) from tesla_fleet_commands where via = 'tezlab' and created_at > now() - interval '30 days'))
  from tezlab_settings s where s.id = 1);
end $$;

-- Trip health #6 rewritten (the rest of the function is unchanged from what is live).
CREATE OR REPLACE FUNCTION public.trip_health_run()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
declare r record; n int; bad text; heal text; fs tesla_fleet_settings; ts tezlab_settings; ks tesla_key_settings; out jsonb := '{}'::jsonb;
begin
  -- 1) Scheduled jobs: missing -> recreate, paused -> turn back on, silent/failing -> report.
  bad := null; heal := null;
  for r in select e.*, j.jobid, j.active,
      (select max(d.end_time) from cron.job_run_details d where d.jobid = j.jobid and d.status = 'succeeded') last_ok,
      (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) last_status
    from trip_health_expected_crons() e left join cron.job j on j.jobname = e.jobname loop
    if r.jobid is null then
      perform cron.schedule(r.jobname, r.schedule, r.command); heal := concat_ws(', ', heal, 'recreated ' || r.jobname);
    elsif not r.active then
      perform cron.alter_job(r.jobid, active := true); heal := concat_ws(', ', heal, 'turned ' || r.jobname || ' back on');
    elsif r.jobname <> 'trip-health' and r.last_ok is not null and r.last_ok < now() - r.max_gap then
      bad := concat_ws('; ', bad, r.jobname || ' last succeeded ' || to_char(r.last_ok at time zone 'America/Los_Angeles', 'Mon DD HH12:MI AM') || coalesce(' (last run ' || r.last_status || ')', ''));
    end if;
  end loop;
  perform trip_health_set('crons', 'Scheduled jobs', case when bad is null then 'ok' else 'fail' end, bad, heal);

  -- 2) Every upcoming trip has its guest link.
  select count(*) into n from turo_trips t left join lax_guest_links l using (reservation_id)
    where t.ends_at > now() and t.starts_at < now() + interval '14 days' and l.token is null and (coalesce(t.airport_code,'') = 'LAX' or t.airport_code is null);
  heal := null;
  if n > 0 then perform lax_guest_sync(); heal := 'made missing guest links';
    select count(*) into n from turo_trips t left join lax_guest_links l using (reservation_id)
      where t.ends_at > now() and t.starts_at < now() + interval '14 days' and l.token is null and (coalesce(t.airport_code,'') = 'LAX' or t.airport_code is null);
  end if;
  perform trip_health_set('links', 'Guest trip links', case when n = 0 then 'ok' else 'fail' end, case when n > 0 then n || ' upcoming trip(s) still have no link.' end, heal);

  -- 3) Keys: each home trip within 90 min of pickup should have its key out. Heal: make it now.
  select * into ks from tesla_key_settings where id = 1;
  heal := null; bad := null;
  if ks.enabled then
    for r in select t.reservation_id, t.guest_first, t.starts_at, k.status from turo_trips t left join tesla_guest_keys k using (reservation_id)
        where lax_trip_kind(t.airport_code) = any(ks.kinds) and now() between t.starts_at - interval '90 minutes' and t.starts_at + interval '1 hour'
          and coalesce(k.status, 'scheduled') in ('scheduled','failed','expired') loop
      if tesla_key_enqueue(r.reservation_id, 'key_create') then
        update tesla_guest_keys set status = 'creating', updated_at = now() where reservation_id = r.reservation_id;
        heal := concat_ws(', ', heal, 'made ' || coalesce(r.guest_first, 'guest') || '''s key');
      end if;
      bad := concat_ws('; ', bad, coalesce(r.guest_first, 'Guest') || ' picks up ' || to_char(r.starts_at at time zone 'America/Los_Angeles', 'HH12:MI AM') || ' and the key was ' || coalesce(r.status, 'not made'));
    end loop;
    -- Access still on the car after the trip (the key watchdog retries; this is the backstop).
    for r in select t.guest_first, t.ends_at from tesla_guest_keys k join turo_trips t using (reservation_id)
        where k.status in ('ready','accepted','removing','failed') and k.removed_at is null and now() > t.ends_at + ks.remove_after + interval '45 minutes' loop
      bad := concat_ws('; ', bad, coalesce(r.guest_first, 'A guest') || ' may still have access (trip ended ' || to_char(r.ends_at at time zone 'America/Los_Angeles', 'Mon DD HH12:MI AM') || ')');
    end loop;
  end if;
  perform trip_health_set('keys', 'Guest Tesla keys', case when bad is null then 'ok' when heal is not null and bad not like '%still have access%' then 'warn' else 'fail' end, bad, heal);

  -- 4) Car helper on the Mac mini (Tesla backup path). Only matters when TezLab isn't carrying commands.
  select * into fs from tesla_fleet_settings where id = 1;
  select * into ts from tezlab_settings where id = 1;
  perform trip_health_set('worker', 'Mac mini car helper',
    case when fs.worker_seen_at > now() - interval '10 minutes' then 'ok' when tezlab_ready() then 'warn' else 'fail' end,
    case when fs.worker_seen_at <= now() - interval '10 minutes' or fs.worker_seen_at is null then 'Last check-in ' || coalesce(to_char(fs.worker_seen_at at time zone 'America/Los_Angeles', 'Mon DD HH12:MI AM'), 'never') || '. It restarts itself via launchd; if the Mac is off or asleep it can''t.' end, null);

  -- 5) Stuck car commands: fail them so guests get an answer.
  update tesla_fleet_commands set status = 'failed', done_at = now(), result = jsonb_build_object('error', 'timed out (trip health)')
    where status in ('queued','running') and created_at < now() - interval '6 minutes';
  get diagnostics n = row_count;
  select count(*) into n from tesla_fleet_commands where status = 'failed' and done_at > now() - interval '1 hour' and tesla_guest_action(action);
  perform trip_health_set('commands', 'Guest car buttons', case when n >= 3 then 'fail' else 'ok' end,
    case when n >= 3 then n || ' guest car commands failed in the last hour. Last error: ' || coalesce(fs.last_error, ts.last_error, 'unknown') end, null);

  -- 6) TezLab: connected and working? TezLab's own servers flap (2026-09-24: 502 from their token endpoint,
  --    401 on a still-valid token, fine again minutes later) and every command falls back to the Tesla worker
  --    meanwhile, so one failure is not news. Report only after 30 minutes of failing, and say whose problem it is.
  bad := case when not tezlab_ready() then 'unconnected'
              when ts.last_error_at is null or ts.last_error_at <= coalesce(ts.last_ok_at, 'epoch') then 'ok'
              when coalesce(ts.last_ok_at, ts.connected_at, ts.last_error_at) > now() - interval '30 minutes' then 'ok'   -- a blip, or too soon to tell
              when ts.last_error like 'TezLabDown:%' then 'outage'   -- their side; routing is paused, Tesla backup covers
              else 'failing' end;
  perform trip_health_set('tezlab', 'TezLab connection',
    case bad when 'ok' then 'ok' when 'failing' then 'fail' else 'warn' end,
    case bad when 'unconnected' then 'Not connected yet, so car buttons use the paid Tesla API. Connect it once in admin.'
             when 'outage' then 'TezLab''s own servers have been failing since ' || to_char(coalesce(ts.last_ok_at, ts.connected_at) at time zone 'America/Los_Angeles', 'FMHH12:MI AM')
               || ' (their side, not ours). Guest car buttons use the Tesla backup, so nobody is stuck. Nothing to reconnect; this clears itself when TezLab is back.'
             when 'failing' then 'TezLab has been failing since ' || to_char(coalesce(ts.last_ok_at, ts.connected_at) at time zone 'America/Los_Angeles', 'FMHH12:MI AM')
               || ': ' || coalesce(regexp_replace(ts.last_error, '^Error: ', ''), '?') || '. Guest car buttons use the Tesla backup.' end,
    case when bad = 'outage' then 'paused TezLab and sent car buttons to the Tesla backup' end);

  -- 7) Reminder emails overdue: resend, then report what is still late.
  select count(*) into n from lax_guest_links where email is not null and reminder_sent_at is null and reminder_at < now() - interval '15 minutes' and reminder_at > now() - interval '12 hours' and coalesce(reminder_error,'') not like 'gave up%';
  heal := null;
  if n > 0 then
    begin perform invoke_edge_function('wallet-pass', '{"op":"remind_due"}'::jsonb, 60000); exception when others then null; end;
    begin perform invoke_edge_function('trip-remind', '{}'::jsonb, 60000); exception when others then null; end;
    heal := 'resent due reminders';
  end if;
  select count(*) into n from lax_guest_links where email is not null and reminder_sent_at is null and reminder_at < now() - interval '40 minutes' and reminder_at > now() - interval '12 hours';
  perform trip_health_set('reminders', 'Reminder emails', case when n = 0 then 'ok' else 'fail' end, case when n > 0 then n || ' reminder(s) are 40+ minutes late.' end, heal);

  -- 8) Errors guests actually hit on their pages (sent by the page itself).
  select count(*), string_agg(distinct left(detail->>'msg', 80), ' | ') into n, bad from lax_guest_events where kind = 'error' and at > now() - interval '1 hour';
  perform trip_health_set('page_errors', 'Guest page errors', case when n >= 3 then 'fail' when n > 0 then 'warn' else 'ok' end, case when n > 0 then n || ' error(s) on guest phones in the last hour: ' || bad end, null);

  -- 9) Housekeeping: test trips (negative ids) are cleared 2 hours after they end, once access is removed.
  for r in select t.reservation_id from turo_trips t left join tesla_guest_keys k using (reservation_id)
      where t.reservation_id < 0 and t.ends_at < now() - interval '2 hours' and coalesce(k.status, 'removed') in ('removed','off','scheduled') loop
    delete from lax_guest_events where reservation_id = r.reservation_id;
    delete from lax_ask_msgs where reservation_id = r.reservation_id;
    delete from tesla_guest_keys where reservation_id = r.reservation_id;
    delete from trip_extra_drivers where reservation_id = r.reservation_id;
    delete from turo_driver_approvals where reservation_id = r.reservation_id;
    delete from turo_link_msgs where reservation_id = r.reservation_id;
    delete from lax_guest_links where reservation_id = r.reservation_id;
    delete from turo_trips where reservation_id = r.reservation_id;
    out := out || jsonb_build_object('cleaned_test_trip', r.reservation_id);
  end loop;

  -- 11) Turo sync + trip-link messages (Mac mini + Chrome). Heal: requeue failed sends; Scout what's still unsent.
  declare ss turo_sender_settings; w jsonb; begin
    select * into ss from turo_sender_settings where id = 1;
    update turo_link_msgs set status = 'queued', updated_at = now() where status = 'failed' and attempts < 3 and coalesce(last_error,'') not like 'sender stopped%' and updated_at < now() - interval '10 minutes';
    w := turo_sender_watchdog();
    select count(*) into n from turo_link_msgs where status in ('queued','failed','sending') and queued_at < now() - interval '45 minutes';
    perform trip_health_set('turo_links', 'Trip link messages (Turo)',
      case when not ss.enabled then 'warn' when ss.seen_at is null or ss.seen_at < now() - interval '30 minutes' then 'fail' when n > 0 then 'fail' else 'ok' end,
      case when not ss.enabled then 'Auto-send is off.'
           when ss.seen_at is null or ss.seen_at < now() - interval '30 minutes' then 'Mac mini sender last checked in ' || coalesce(lax_ask_fmt(ss.seen_at), 'never') || '. New bookings are not being picked up.'
           when n > 0 then n || ' link message(s) not sent after 45 min' || coalesce(': ' || ss.last_error, '') || '.' end, null);
    perform trip_health_set('turo_sync', 'Turo bookings sync',
      case when ss.last_ingest_at > now() - interval '30 minutes' then 'ok' else 'fail' end,
      case when ss.last_ingest_at is null or ss.last_ingest_at <= now() - interval '30 minutes' then 'Last booking sync ' || coalesce(lax_ask_fmt(ss.last_ingest_at), 'never') || '.' end, null);
  end;

  -- 12) Extra drivers: waiting on Turo too long, or a key failed.
  select count(*) into n from trip_extra_drivers x join turo_trips t using (reservation_id) where x.status = 'failed' and t.ends_at > now();
  perform trip_health_set('extra_drivers', 'Extra-driver keys', case when n > 0 then 'fail' else 'ok' end, case when n > 0 then n || ' extra-driver key(s) failed.' end, null);

  -- 13) Trip helper AI + its fixes.
  begin perform trip_health_agent(); exception when others then perform trip_health_set('helper_ai', 'Trip helper AI', 'fail', 'check crashed: ' || left(sqlerrm, 150), null); end;

  -- 14) Supercharging sync for live trips.
  begin perform trip_charges_health(); exception when others then perform trip_health_set('charging', 'Supercharging sync', 'fail', 'check crashed: ' || left(sqlerrm, 150), null); end;

  -- 10) The web checks (pages, pictures, weather, helper) come from the trip-health edge function.
  if not exists (select 1 from trip_health where check_key = 'web' and checked_at > now() - interval '40 minutes') then
    begin perform invoke_edge_function('trip-health', '{}'::jsonb, 60000); exception when others then null; end;
  end if;
  return out;
end $function$;
