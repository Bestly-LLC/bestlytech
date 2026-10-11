-- 1) Pretend car for Leo's new tools on demo trips (no real car is ever touched).
--    trip-voice routes car_status, car_lock, car_climate, find_superchargers, send_to_car_nav, charging_summary and
--    send_sms here for demo tokens; real trips answer "not live yet" until the trip-api gate is built.
-- 2) Caller lookup v2: Jared's own cell is a test guest on the LAX demo trip with a real demo trip_key, so every
--    tool can be exercised by phone (Jared, 2026-10-11).
create table if not exists public.leo_demo_car_state (
  link text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.leo_demo_car_state enable row level security;
revoke all on public.leo_demo_car_state from anon, authenticated;

create or replace function public.leo_demo_car(p_link text, p_name text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  st jsonb; r jsonb; a text; t numeric; dest text;
  lt text := to_char(now() at time zone 'America/Los_Angeles', 'FMHH12:MI AM');
begin
  if p_link not in ('d:demo-home','d:demo-lax') then return jsonb_build_object('ok', false, 'error', 'not a demo'); end if;
  select case when updated_at > now() - interval '2 hours' then state end into st from leo_demo_car_state where link = p_link;
  st := coalesce(st, jsonb_build_object('locked', true, 'climate_on', false, 'target_f', 70, 'inside_f', 78, 'outside_f', 71,
                                        'battery', 78, 'range_mi', 241, 'nav', null));
  a := lower(coalesce(p_args->>'action', ''));
  if p_name = 'car_status' then
    r := jsonb_build_object('ok', true, 'demo', true, 'as_of_local', lt,
      'battery_percent', (st->>'battery')::int, 'range_mi', (st->>'range_mi')::int, 'charging', false,
      'locked', (st->>'locked')::boolean, 'open', '[]'::jsonb,
      'tires_psi', jsonb_build_object('front_left', 42, 'front_right', 42, 'rear_left', 41, 'rear_right', 42, 'recommended', 42, 'status', 'ok'),
      'inside_f', (st->>'inside_f')::int, 'outside_f', (st->>'outside_f')::int,
      'climate_on', (st->>'climate_on')::boolean, 'target_f', (st->>'target_f')::int,
      'alerts', '[]'::jsonb, 'say', 'Demo car: all four tires look good and nothing needs attention.');
  elsif p_name = 'car_lock' then
    if a not in ('lock','unlock') then return jsonb_build_object('ok', false, 'error', 'action must be lock or unlock'); end if;
    st := jsonb_set(st, '{locked}', to_jsonb(a = 'lock'));
    r := jsonb_build_object('ok', true, 'demo', true, 'done', true, 'locked', a = 'lock',
      'say', case a when 'lock' then 'Done, the demo car is locked.' else 'Done, the demo car is unlocked. On a real trip, unlocking goes through your Tesla app key.' end);
  elsif p_name = 'car_climate' then
    t := coalesce(nullif(p_args->>'target_temp_f','')::numeric, (st->>'target_f')::numeric, 70);
    if t < 60 or t > 82 then return jsonb_build_object('ok', false, 'error', 'target_temp_f must be 60 to 82'); end if;
    if a in ('start','on') then st := st || jsonb_build_object('climate_on', true, 'target_f', round(t), 'inside_f', round(t) + 4);
    elsif a in ('stop','off') then st := st || jsonb_build_object('climate_on', false);
    elsif a = 'set_temp' then st := st || jsonb_build_object('climate_on', true, 'target_f', round(t));
    else return jsonb_build_object('ok', false, 'error', 'action must be start, stop or set_temp'); end if;
    r := jsonb_build_object('ok', true, 'demo', true, 'climate_on', (st->>'climate_on')::boolean, 'target_f', (st->>'target_f')::int,
      'say', case when (st->>'climate_on')::boolean then 'Climate is on in the demo car, set to ' || (st->>'target_f') || '°F. It turns off by itself after 30 minutes if nobody drives.' else 'Climate is off in the demo car.' end);
  elsif p_name = 'find_superchargers' then
    r := jsonb_build_object('ok', true, 'demo', true, 'stations', jsonb_build_array(
      jsonb_build_object('name', 'Demo Supercharger Century Blvd', 'distance_mi', 1.2, 'open_stalls', 12, 'total_stalls', 20, 'max_kw', 250),
      jsonb_build_object('name', 'Demo Supercharger Hawthorne', 'distance_mi', 3.4, 'open_stalls', 8, 'total_stalls', 16, 'max_kw', 250),
      jsonb_build_object('name', 'Demo Supercharger Culver City', 'distance_mi', 5.9, 'open_stalls', 4, 'total_stalls', 12, 'max_kw', 150)),
      'say', 'These are demo stations. Live prices show on the car screen.');
  elsif p_name = 'send_to_car_nav' then
    dest := left(btrim(coalesce(p_args->>'destination', '')), 120);
    if length(dest) < 2 then return jsonb_build_object('ok', false, 'error', 'destination needed'); end if;
    st := jsonb_set(st, '{nav}', to_jsonb(dest));
    r := jsonb_build_object('ok', true, 'demo', true, 'destination', dest, 'say', 'Sent to the demo car''s screen: ' || dest || '.');
  elsif p_name = 'charging_summary' then
    r := jsonb_build_object('ok', true, 'demo', true, 'stops', 2, 'total_display', '$28.17', 'final', false,
      'sessions', jsonb_build_array(
        jsonb_build_object('started_local', 'Sat 2:14 PM', 'site', 'Barstow, CA (demo)', 'total_display', '$18.42', 'status', 'final'),
        jsonb_build_object('started_local', 'Sat 7:51 PM', 'site', 'Baker, CA (demo)', 'total_display', '$9.75', 'status', 'pending')),
      'say', 'Demo trip: 2 Supercharger stops, $28.17 so far. They bill to Jared''s Tesla account and come through Turo after the trip.');
  elsif p_name = 'send_sms' then
    r := jsonb_build_object('ok', true, 'demo', true, 'sent', false, 'say', 'Demo trip: the text was not actually sent.');
  else
    return jsonb_build_object('ok', false, 'error', 'unknown tool');
  end if;
  insert into leo_demo_car_state(link, state, updated_at) values (p_link, st, now())
    on conflict (link) do update set state = excluded.state, updated_at = now();
  return r;
end $$;
revoke all on function public.leo_demo_car(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.leo_demo_car(text,text,jsonb) to service_role;

create or replace function public.leo_phone_caller(p_caller text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  d text := right(regexp_replace(coalesce(p_caller,''), '\D', '', 'g'), 10);
  t public.turo_trips;
  stage text := 'none';
  place text := 'unknown';
  k text;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role only'; end if;
  if d = '8165007236' then
    -- Test mode (Jared, Oct 2026): every tool works against the demo trip and pretend car, never the real car.
    k := 'tv_' || encode(extensions.gen_random_bytes(24), 'hex');
    insert into public.trip_voice_sessions(key, agent_slug, token) values (k, 'leo', 'demo:demo-lax');
    return jsonb_build_object('trip_key', k, 'call_mode', 'phone', 'caller_type', 'test_guest', 'guest_first_name', 'Jared',
      'trip_stage', 'active', 'pickup_place', 'lax', 'pickup_time_local', '', 'return_time_local', '', 'car_name', 'Blue Steel (demo)');
  end if;
  if length(d) >= 7 then
    select * into t from public.turo_trips
     where right(regexp_replace(coalesce(guest_phone,''), '\D', '', 'g'), 10) = d
       and coalesce(status,'') !~* 'cancel'
       and ends_at > now() - interval '2 days'
       and starts_at < now() + interval '7 days'
     order by abs(extract(epoch from (starts_at - now()))) limit 1;
  end if;
  if t.reservation_id is null then
    return jsonb_build_object('trip_key','none','call_mode','phone','caller_type','unknown','guest_first_name','',
      'trip_stage','none','pickup_place','unknown','car_name','Blue Steel');
  end if;
  stage := case when now() < t.starts_at then 'upcoming' when now() <= t.ends_at or coalesce(t.in_progress,false) then 'active' else 'ended' end;
  place := case when t.airport_code is not null then 'lax'
                when coalesce(t.pickup_address,'') ~* '(kings|90069)' then 'home'
                else 'delivery' end;
  return jsonb_build_object('trip_key','none','call_mode','phone','caller_type','guest',
    'guest_first_name', coalesce(t.guest_first,''), 'trip_stage', stage, 'pickup_place', place,
    'pickup_time_local', coalesce(t.local_start,''), 'return_time_local', coalesce(t.local_end,''), 'car_name','Blue Steel');
end $$;
revoke all on function public.leo_phone_caller(text) from public, anon, authenticated;
grant execute on function public.leo_phone_caller(text) to service_role;
