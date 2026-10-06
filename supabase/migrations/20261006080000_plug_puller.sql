-- Plug Puller (Charging Attendant), hired 2026-10-05 at Jared's request.
-- Watches Jared's ChargePoint account from the Pi (/opt/bestly/cron/jobs/charge_stop.py, every minute) and ends the
-- ChargePoint session as soon as the Tesla is done: the car's own charge limit (set in the Tesla app, so it can be
-- different every time) or a one-off target set on /admin/turo. Ending the session stops ChargePoint idle fees.
-- ChargePoint has no driver API; this uses the open-source python-chargepoint library (unofficial, free).
-- Login: Jared pastes his ChargePoint email + session cookie once (write-only into Vault, pi:chargepoint:*).

create table if not exists public.charge_stop_state (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  target_override int check (target_override between 20 and 100),   -- one-off "stop at X%"; cleared when the session ends
  signed_in boolean,
  last_error text,
  last_cp_check_at timestamptz,
  session_id bigint,                 -- the ChargePoint session being watched (null = none)
  session_started_at timestamptz,
  station text,
  station_lat float8,
  station_lon float8,
  session_state text,
  power_kw numeric,
  energy_kwh numeric,
  cost numeric,
  idle_since timestamptz,            -- ChargePoint reports no power flowing since
  battery int,
  car_limit int,
  stop_tries int not null default 0,
  last_stopped_at timestamptz,
  last_stopped_summary text,
  updated_at timestamptz not null default now()
);
insert into public.charge_stop_state (id) values (1) on conflict do nothing;
alter table public.charge_stop_state enable row level security;

create table if not exists public.charge_stop_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null,                -- watching | stopped | stop_failed | signed_out | signed_in | target | done_by_car
  session_id bigint,
  detail jsonb not null default '{}'
);
create index if not exists charge_stop_log_at on public.charge_stop_log (at desc);
alter table public.charge_stop_log enable row level security;

-- Notifications from Plug Puller are signed by Plug Puller (house rule: every alert belongs to an AI employee).
create or replace function public.charge_stop_notify(p_title text, p_body text default '', p_level text default 'active', p_tag text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  v := notify_route('Plug Puller: ' || left(p_title, 170), coalesce(p_body, ''), p_level, 'Plug Puller',
                    'https://bestly.tech/admin/turo#plug-puller', null, p_tag, null, null, false, now());
  return v;
exception when others then
  begin perform admin_notify('plug-puller', 'Plug Puller: ' || p_title, p_body, '/admin/turo#plug-puller', null, 'warning', p_tag); exception when others then null; end;
  return 'bell';
end $$;
revoke all on function public.charge_stop_notify(text, text, text, text) from public, anon, authenticated;

-- Admin: connect ChargePoint (write-only; values never come back out).
create or replace function public.chargepoint_connect(p_username text, p_token text)
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid; n text; val text;
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  if coalesce(trim(p_username), '') !~ '^[^@\s]+@[^@\s]+$' then raise exception 'Enter your ChargePoint email'; end if;
  if length(coalesce(trim(p_token), '')) < 20 then raise exception 'That does not look like the coulomb_sess cookie'; end if;
  foreach n in array array['pi:chargepoint:username', 'pi:chargepoint:token'] loop
    val := case when n like '%username' then lower(trim(p_username)) else trim(p_token) end;
    select id into v_id from vault.secrets where name = n;
    if v_id is null then perform vault.create_secret(val, n, 'Plug Puller: ChargePoint login (2026-10-05)');
    else perform vault.update_secret(v_id, val, n); end if;
  end loop;
  update charge_stop_state set signed_in = null, last_error = null, last_cp_check_at = null, updated_at = now() where id = 1;
  insert into charge_stop_log (kind, detail) values ('connected', jsonb_build_object('by', 'admin'));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.chargepoint_connect(text, text) from public, anon;
grant execute on function public.chargepoint_connect(text, text) to authenticated;

-- Admin: one-off target (null = use the car's own charge limit) and on/off.
create or replace function public.charge_stop_set(p_target int default null, p_enabled boolean default null, p_clear_target boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  if p_target is not null and (p_target < 20 or p_target > 100) then raise exception 'Pick 20 to 100%%'; end if;
  update charge_stop_state set
    target_override = case when p_clear_target then null else coalesce(p_target, target_override) end,
    enabled = coalesce(p_enabled, enabled), updated_at = now() where id = 1;
  insert into charge_stop_log (kind, detail) values ('target', jsonb_build_object('target', p_target, 'enabled', p_enabled, 'clear', p_clear_target));
  return charge_stop_status();
end $$;

create or replace function public.charge_stop_status()
returns jsonb language plpgsql stable security definer set search_path = public, vault as $$
declare s charge_stop_state; j jsonb;
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  select * into s from charge_stop_state where id = 1;
  select to_jsonb(s) - 'station_lat' - 'station_lon' into j;
  return j || jsonb_build_object(
    'connected', exists (select 1 from vault.secrets where name = 'pi:chargepoint:token'),
    'log', coalesce((select jsonb_agg(x order by x.at desc) from (select at, kind, detail from charge_stop_log where kind not like 'test\_%' order by at desc limit 8) x), '[]'));
end $$;
revoke all on function public.charge_stop_set(int, boolean, boolean) from public, anon;
revoke all on function public.charge_stop_status() from public, anon;
grant execute on function public.charge_stop_set(int, boolean, boolean) to authenticated;
grant execute on function public.charge_stop_status() to authenticated;

-- Pi job writes (service role). Keys in p overwrite the matching columns; plus checked / stopped_summary / clear_target / log_*.
create or replace function public.charge_stop_save(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare s charge_stop_state;
begin
  select * into s from charge_stop_state where id = 1;
  s := jsonb_populate_record(s, p - 'checked' - 'clear_target' - 'stopped_summary' - 'log_kind' - 'log_session' - 'log_detail');
  if p ? 'checked' then s.last_cp_check_at := now(); end if;
  if p ? 'stopped_summary' then s.last_stopped_at := now(); s.last_stopped_summary := p->>'stopped_summary'; end if;
  if coalesce((p->>'clear_target')::boolean, false) then s.target_override := null; end if;
  s.id := 1; s.updated_at := now();
  update charge_stop_state set (enabled, target_override, signed_in, last_error, last_cp_check_at, session_id, session_started_at,
    station, station_lat, station_lon, session_state, power_kw, energy_kwh, cost, idle_since, battery, car_limit, stop_tries,
    last_stopped_at, last_stopped_summary, updated_at)
  = (s.enabled, s.target_override, s.signed_in, s.last_error, s.last_cp_check_at, s.session_id, s.session_started_at,
    s.station, s.station_lat, s.station_lon, s.session_state, s.power_kw, s.energy_kwh, s.cost, s.idle_since, s.battery, s.car_limit, s.stop_tries,
    s.last_stopped_at, s.last_stopped_summary, s.updated_at) where id = 1;
  if p ? 'log_kind' then
    insert into charge_stop_log (kind, session_id, detail) values (p->>'log_kind', nullif(p->>'log_session', '')::bigint, coalesce(p->'log_detail', '{}'));
  end if;
end $$;
revoke all on function public.charge_stop_save(jsonb) from public, anon, authenticated;

-- Pi-side readers of the ChargePoint login (service role only; pi_secret_get already limits to pi: names).
-- (No new function: the job uses pi_secret_get / pi_secret_put.)

-- Car Guard's "done charging, move it" pings stand down while Plug Puller is signed in and watching the session:
-- Plug Puller ends it (no idle fee) and alerts itself if it can't. One owner per alert.
create or replace function public.charge_stop_owns_session()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select enabled and signed_in is true and session_id is not null
                          and last_cp_check_at > now() - interval '5 minutes'
                     from charge_stop_state where id = 1), false)
      or coalesce((select last_stopped_at > now() - interval '3 hours' from charge_stop_state where id = 1), false)
$$;
revoke all on function public.charge_stop_owns_session() from public, anon;

do $do$
declare d text := pg_get_functiondef('public.car_watch_tick()'::regprocedure);
begin
  if d not like '%charge_stop_owns_session%' then
    d := replace(d,
      $o$      if complete or (charging and mins is not null and mins <= 3) then
        f := f || jsonb_build_object('charge_done_at', coalesce(f->>'charge_done_at', now()::text));$o$,
      $n$      -- Plug Puller (2026-10-05) ends Jared's ChargePoint session itself; these pings only run when it isn't on the job.
      if (complete or (charging and mins is not null and mins <= 3)) and not charge_stop_owns_session() then
        f := f || jsonb_build_object('charge_done_at', coalesce(f->>'charge_done_at', now()::text));$n$);
    if d not like '%charge_stop_owns_session%' then raise exception 'car_watch_tick patch did not apply'; end if;
    execute d;
  end if;
end $do$;

