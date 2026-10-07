-- Undo a duplicate Plug Puller (applied 2026-10-06 as plug_puller_single_owner_cleanup).
--
-- The Plug Puller already existed and was already running: /opt/bestly/cron/jobs/charge_stop.py on the Pi,
-- in crontab every minute, reporting to pi_jobs ('charge_stop', max_gap_min 10 -> Scout), with its own
-- ChargePoint bridge, adaptive polling, venv self-heal, token rotation and a chargepoint_connect RPC behind
-- the Plug Puller card on /admin/turo. For a full day it had been saying
--   "skip: ChargePoint not connected yet"
-- for exactly one reason: no session token had ever been saved.
--
-- Not knowing that, a second worker was built beside it (/opt/bestly/chargepoint/stopper.py on a systemd
-- timer, plus plug_puller_watchdog on pg_cron). Two things racing to stop the same session is worse than
-- either alone, so the second one is gone: the timer, unit and script are deleted from the Pi, and the cron
-- entry is unscheduled (cron.unschedule(209)). Two function bodies are left behind unused --
-- plug_puller_watchdog and charge_stop_save_login (chargepoint_connect already did that job) -- only because
-- DROP FUNCTION needs an interactive confirmation this session could not give. Nothing calls either.
--
-- The lasting fix was one row of data: the coulomb_sess token now lives in pi:chargepoint:token, where
-- charge_stop.py has always looked. The job flipped to "ok: next ChargePoint check in <30 min" on its very
-- next run.
--
-- Lesson for whoever is next: grep tools/ and pi_jobs for the thing you are about to build.

-- charge_stop_status() was right the first time: the worker's store is pi_secret, not home_hub Vault.
create or replace function public.charge_stop_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'vault'
as $function$
declare s charge_stop_state; j jsonb;
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  select * into s from charge_stop_state where id = 1;
  select to_jsonb(s) - 'station_lat' - 'station_lon' into j;
  return j || jsonb_build_object(
    'connected', exists (select 1 from vault.secrets where name = 'pi:chargepoint:token'),
    'log', coalesce((select jsonb_agg(x order by x.at desc) from (select at, kind, detail from charge_stop_log where kind not like 'test\_%' order by at desc limit 8) x), '[]'));
end $function$;

-- Readiness now reflects the store the worker actually reads, and the Charging card can show whether the
-- Plug Puller is really signed in rather than just whether something was typed.
create or replace function public.home_charge_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'vault'
as $function$
declare s home_charge_settings; c car_charge_sessions;
        v_user timestamptz; v_token timestamptz; st charge_stop_state;
begin
  if auth.role() <> 'service_role' and not public.has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'Admins only';
  end if;
  select * into s from home_charge_settings where id = 1;
  select * into c from car_charge_sessions order by started_at desc limit 1;
  select * into st from charge_stop_state where id = 1;
  select updated_at into v_user  from vault.secrets where name = 'pi:chargepoint:username';
  select updated_at into v_token from vault.secrets where name = 'pi:chargepoint:token';

  return jsonb_build_object(
    'settings', jsonb_build_object(
      'night_rate', s.night_rate, 'day_rate', s.day_rate,
      'night_from_hour', s.night_from_hour, 'night_to_hour', s.night_to_hour,
      'session_fee', s.session_fee, 'idle_grace_min', s.idle_grace_min,
      'idle_rate_hr', s.idle_rate_hr, 'station', s.station, 'updated_at', s.updated_at),
    'chargepoint', jsonb_build_object(
      'email_at', v_user, 'token_at', v_token,
      'ready', (v_user is not null and v_token is not null),
      'signed_in', st.signed_in, 'last_error', st.last_error,
      'last_check_at', st.last_cp_check_at,
      'last_stopped_at', st.last_stopped_at, 'last_stopped_summary', st.last_stopped_summary),
    'now', case when c.id is null then null else jsonb_build_object(
      'open', c.ended_at is null, 'started_at', c.started_at, 'ended_at', c.ended_at,
      'at_home', coalesce(c.at_home, false), 'dc_fast', coalesce(c.dc_fast, false),
      'kwh', round(c.kwh, 2), 'start_pct', c.start_pct, 'end_pct', c.end_pct,
      'cost', round(c.energy_cost + c.idle_fee + c.session_fee, 2), 'idle_fee', round(c.idle_fee, 2),
      'stopped_at', c.stopped_at) end,
    'recent', coalesce((select jsonb_agg(x order by x->>'started_at' desc) from (
        select jsonb_build_object('started_at', started_at, 'ended_at', ended_at, 'kwh', round(kwh, 2),
                                  'cost', round(energy_cost + idle_fee + session_fee, 2),
                                  'idle_fee', round(idle_fee, 2), 'at_home', at_home) x
          from car_charge_sessions
         where ended_at is not null and at_home is true
         order by started_at desc limit 5) q), '[]'::jsonb));
end $function$;

revoke all on function public.home_charge_admin() from public, anon;
grant execute on function public.home_charge_admin() to authenticated;

update bestly_agents
   set schedule = 'every minute on the Pi (cron: /opt/bestly/cron/run.sh charge_stop), self-paced',
       pulse = '{"src":"pi_job","job":"charge_stop"}'::jsonb,
       admin_url = '/admin/turo#plug-puller',
       updated_at = now()
 where slug = 'plug-puller';
