-- Charging settings for the Turo settings page (applied 2026-10-06 as home_charge_admin_rpcs).
--
-- Jared shouldn't have to hand-write SQL or paste a Vault secret to make a bot work. These two functions back
-- the Charging card at /admin/turo/settings (src/pages/admin/ChargingCard.tsx):
--
--   home_charge_admin()      reads the rate card, whether the ChargePoint login is in Vault (the saved-at
--                            timestamp only -- never the value), the open session and the last five.
--   home_charge_admin_set()  updates the rate card with sanity bounds, so a fat-fingered 28.85 can't quietly
--                            turn a $6 charge into a $600 one.
--
-- The login itself goes in through home_hub_vault_put, which is write-only by design.

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
      'at_home', c.at_home, 'kwh', round(c.kwh, 2), 'start_pct', c.start_pct, 'end_pct', c.end_pct,
      'cost', round(c.energy_cost + c.idle_fee + c.session_fee, 2), 'idle_fee', round(c.idle_fee, 2),
      'stopped_at', c.stopped_at) end,
    'recent', coalesce((select jsonb_agg(x order by x->>'started_at' desc) from (
        select jsonb_build_object('started_at', started_at, 'ended_at', ended_at, 'kwh', round(kwh, 2),
                                  'cost', round(energy_cost + idle_fee + session_fee, 2),
                                  'idle_fee', round(idle_fee, 2), 'at_home', at_home) x
          from car_charge_sessions where ended_at is not null order by started_at desc limit 5) q), '[]'::jsonb));
end $function$;

create or replace function public.home_charge_admin_set(
  p_night numeric default null, p_day numeric default null, p_session_fee numeric default null,
  p_idle_grace integer default null, p_idle_rate numeric default null,
  p_night_from integer default null, p_night_to integer default null, p_station text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.role() <> 'service_role' and not public.has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'Admins only';
  end if;
  if p_night is not null and (p_night < 0 or p_night > 5) then raise exception 'Night rate looks wrong'; end if;
  if p_day is not null and (p_day < 0 or p_day > 5) then raise exception 'Day rate looks wrong'; end if;
  if p_idle_rate is not null and (p_idle_rate < 0 or p_idle_rate > 50) then raise exception 'Idle rate looks wrong'; end if;
  if p_idle_grace is not null and (p_idle_grace < 0 or p_idle_grace > 240) then raise exception 'Grace looks wrong'; end if;
  update home_charge_settings set
    night_rate = coalesce(p_night, night_rate), day_rate = coalesce(p_day, day_rate),
    session_fee = coalesce(p_session_fee, session_fee), idle_grace_min = coalesce(p_idle_grace, idle_grace_min),
    idle_rate_hr = coalesce(p_idle_rate, idle_rate_hr),
    night_from_hour = coalesce(p_night_from, night_from_hour), night_to_hour = coalesce(p_night_to, night_to_hour),
    station = coalesce(nullif(trim(p_station), ''), station), updated_at = now()
  where id = 1;
  return public.home_charge_admin();
end $function$;

revoke all on function public.home_charge_admin() from public, anon;
revoke all on function public.home_charge_admin_set(numeric, numeric, numeric, integer, numeric, integer, integer, text) from public, anon;
grant execute on function public.home_charge_admin() to authenticated;
grant execute on function public.home_charge_admin_set(numeric, numeric, numeric, integer, numeric, integer, integer, text) to authenticated;
