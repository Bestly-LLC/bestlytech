-- Charge Watch: label away-from-home sessions honestly (2026-10-06).
--
-- Two things the first real day of data turned up:
--
-- 1. car_charge_tick set at_home from `(rs->>'spot') = 'home'`, which is NULL -- not false -- whenever
--    car_return_state() has no spot for the car. Every Supercharger stop today landed with at_home null.
--    No money was miscounted (null fell through the same `case when v_home` else-branch as false), but the
--    sessions were unlabeled. Now coalesced to false.
--
-- 2. home_charge_admin fed every session to the Charging card, so three Supercharger stops showed up as
--    $0.00 charges on the card for the Essex charger -- which reads like free electricity rather than
--    "we don't price this one." The card is the home charger: recent is now home-only, and the open
--    session carries at_home so the card can say "charging away from home" instead of nothing.

create or replace function public.car_charge_tick()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v turo_vehicle_state; fs tesla_fleet_settings; s home_charge_settings; rs jsonb; c car_charge_sessions;
  v_plugged boolean; v_charging boolean; v_home boolean; v_dc boolean; v_pw numeric;
  v_hrs numeric; v_idle_min numeric; v_rate numeric; v_limit int;
begin
  select * into s from home_charge_settings where id = 1;
  select * into fs from tesla_fleet_settings where id = 1;
  select * into v from turo_vehicle_state where vin = fs.vin;
  if v.vin is null then return jsonb_build_object('ok', false, 'why', 'no reading from the car'); end if;
  if v.observed_at < now() - interval '45 minutes' then
    return jsonb_build_object('ok', false, 'why', 'the car reading is stale');
  end if;
  rs := public.car_return_state();

  v_plugged  := coalesce(v.plugged_in, false);
  v_charging := v.charging_state in ('Charging', 'Starting');
  v_home     := coalesce((rs->>'spot') = 'home', false);   -- was null when car_return_state had no spot
  v_dc       := coalesce((v.raw #>> '{fleet_api,charge,fast}')::boolean, false);
  v_pw       := coalesce((v.raw #>> '{fleet_api,charge,power_kw}')::numeric, 0);
  v_limit    := (v.raw #>> '{fleet_api,charge,limit_pct}')::int;

  select * into c from car_charge_sessions where vin = v.vin and ended_at is null order by started_at desc limit 1;

  if not v_plugged then
    if c.id is not null then
      update car_charge_sessions set ended_at = now(), end_pct = v.battery_pct where id = c.id;
      return jsonb_build_object('ok', true, 'event', 'unplugged', 'session', c.id,
                                'kwh', round(c.kwh, 2), 'total', round(c.energy_cost + c.idle_fee + c.session_fee, 2));
    end if;
    return jsonb_build_object('ok', true, 'event', 'idle', 'plugged', false);
  end if;

  if c.id is null then
    insert into car_charge_sessions (vin, at_home, dc_fast, start_pct, last_sample_at, last_power_kw, session_fee, limit_pct)
    values (v.vin, v_home, v_dc, v.battery_pct, now(), v_pw, case when v_home then s.session_fee else 0 end, v_limit)
    returning * into c;
    return jsonb_build_object('ok', true, 'event', 'plugged in', 'session', c.id, 'at_home', v_home);
  end if;

  v_hrs := least(extract(epoch from (now() - coalesce(c.last_sample_at, now()))), 900) / 3600.0;
  v_rate := public.home_charge_rate(now());

  if v_charging then
    update car_charge_sessions
       set kwh = car_charge_sessions.kwh + (v_pw * v_hrs),
           energy_cost = car_charge_sessions.energy_cost + case when v_home then v_pw * v_hrs * v_rate else 0 end,
           last_sample_at = now(), last_power_kw = v_pw, stopped_at = null, warned_at = null,
           limit_pct = coalesce(v_limit, car_charge_sessions.limit_pct)
     where id = c.id;
    return jsonb_build_object('ok', true, 'event', 'charging', 'session', c.id, 'kw', v_pw,
                              'kwh', round(c.kwh + v_pw * v_hrs, 2), 'rate', v_rate);
  end if;

  if c.stopped_at is null then
    update car_charge_sessions set stopped_at = now(), last_sample_at = now(), last_power_kw = 0 where id = c.id;
    return jsonb_build_object('ok', true, 'event', 'stopped charging', 'session', c.id, 'grace_min', s.idle_grace_min);
  end if;

  v_idle_min := greatest(0, extract(epoch from (now() - c.stopped_at)) / 60.0 - s.idle_grace_min);
  update car_charge_sessions
     set idle_fee = case when v_home then round((v_idle_min / 60.0) * s.idle_rate_hr, 2) else 0 end,
         last_sample_at = now(), last_power_kw = 0
   where id = c.id;
  return jsonb_build_object('ok', true, 'event', 'sitting on the plug', 'session', c.id,
                            'idle_min', round(v_idle_min), 'idle_fee', round((v_idle_min / 60.0) * s.idle_rate_hr, 2));
end $function$;

-- Today's unlabeled sessions were all Superchargers.
update car_charge_sessions set at_home = false where at_home is null;

create or replace function public.home_charge_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'vault'
as $function$
declare s home_charge_settings; c car_charge_sessions; v_email timestamptz; v_pass timestamptz;
begin
  if auth.role() <> 'service_role' and not public.has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'Admins only';
  end if;
  select * into s from home_charge_settings where id = 1;
  select * into c from car_charge_sessions order by started_at desc limit 1;
  select updated_at into v_email from vault.secrets where name = 'home_hub_chargepoint_email';
  select updated_at into v_pass  from vault.secrets where name = 'home_hub_chargepoint_password';

  return jsonb_build_object(
    'settings', jsonb_build_object(
      'night_rate', s.night_rate, 'day_rate', s.day_rate,
      'night_from_hour', s.night_from_hour, 'night_to_hour', s.night_to_hour,
      'session_fee', s.session_fee, 'idle_grace_min', s.idle_grace_min,
      'idle_rate_hr', s.idle_rate_hr, 'station', s.station, 'updated_at', s.updated_at),
    'chargepoint', jsonb_build_object('email_at', v_email, 'password_at', v_pass,
                                      'ready', (v_email is not null and v_pass is not null)),
    'now', case when c.id is null then null else jsonb_build_object(
      'open', c.ended_at is null, 'started_at', c.started_at, 'ended_at', c.ended_at,
      'at_home', coalesce(c.at_home, false), 'dc_fast', coalesce(c.dc_fast, false),
      'kwh', round(c.kwh, 2), 'start_pct', c.start_pct, 'end_pct', c.end_pct,
      'cost', round(c.energy_cost + c.idle_fee + c.session_fee, 2), 'idle_fee', round(c.idle_fee, 2),
      'stopped_at', c.stopped_at) end,
    -- Home only: a Supercharger stop at $0.00 on the Essex card reads like free electricity.
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

-- Read side for home_hub_* Vault secrets, for the Pi workers only (applied as
-- home_hub_vault_get_service_role_only). home_hub_vault_put stays write-only so a browser can save a
-- credential but never read one back; the Charge Watch worker does need the real ChargePoint login and
-- already holds SUPABASE_SERVICE_ROLE_KEY. Mirrors partner_google_vault_get: service_role only, never anon,
-- never authenticated -- so it is deliberately NOT in security_public_rpcs.
create or replace function public.home_hub_vault_get(p_name text)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'vault'
as $function$
declare v text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role only';
  end if;
  if p_name !~ '^home_hub_[a-z0-9_]{2,60}$' then
    raise exception 'Bad secret name';
  end if;
  select decrypted_secret into v from vault.decrypted_secrets where name = p_name;
  return v;
end $function$;

revoke all on function public.home_hub_vault_get(text) from public, anon, authenticated;
grant execute on function public.home_hub_vault_get(text) to service_role;

-- ChargePoint blocks password logins from servers (applied as charge_watch_session_token_readiness).
--
-- A real login attempt from the Pi came back 403 with a Datadome captcha challenge; the python-chargepoint
-- client even ships a DatadomeCaptcha exception for it. So the saved password can never get Charge Watch in.
-- The client's other door takes a coulomb_sess session token from an already-signed-in session
-- (ChargePoint.create(email, coulomb_token=...)). That cookie is HttpOnly, so only Jared can copy it --
-- the Charging card takes it and Vault holds it, same write-only path as the password.
--
-- "ready" now means email + session token. The password stays saved but no longer counts.
create or replace function public.home_charge_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'vault'
as $function$
declare s home_charge_settings; c car_charge_sessions;
        v_email timestamptz; v_pass timestamptz; v_token timestamptz;
begin
  if auth.role() <> 'service_role' and not public.has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'Admins only';
  end if;
  select * into s from home_charge_settings where id = 1;
  select * into c from car_charge_sessions order by started_at desc limit 1;
  select updated_at into v_email from vault.secrets where name = 'home_hub_chargepoint_email';
  select updated_at into v_pass  from vault.secrets where name = 'home_hub_chargepoint_password';
  select updated_at into v_token from vault.secrets where name = 'home_hub_chargepoint_token';

  return jsonb_build_object(
    'settings', jsonb_build_object(
      'night_rate', s.night_rate, 'day_rate', s.day_rate,
      'night_from_hour', s.night_from_hour, 'night_to_hour', s.night_to_hour,
      'session_fee', s.session_fee, 'idle_grace_min', s.idle_grace_min,
      'idle_rate_hr', s.idle_rate_hr, 'station', s.station, 'updated_at', s.updated_at),
    'chargepoint', jsonb_build_object(
      'email_at', v_email, 'password_at', v_pass, 'token_at', v_token,
      'ready', (v_email is not null and v_token is not null)),
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
