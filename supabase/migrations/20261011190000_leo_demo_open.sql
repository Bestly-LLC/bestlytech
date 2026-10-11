-- Leo: temporary "open demo" + demo parity watchdog (Jared, 2026-10-11).
--
-- 1) leo_settings.demo_open_until: while it is in the future, the DEMO trip pages (demo-lax, demo-home) let Leo
--    and the page do everything on the pretend car, including unlock, and the demo session cap goes 40 -> 200 an hour.
--    It expires by itself (7 days from this migration), so nothing has to be turned back off. Real trips are never
--    affected: trip-voice still refuses unlock for anything that is not a demo token.
--      leo_demo_open()          public, read only: {open, until}. Called by the trip page with the publishable key.
--      leo_demo_open_set(hours) admin only, 0..720 hours from now, 0 = off.
-- 2) leo_demo_car is replaced (same shape: {ok, car:{...}}) with an 'unlock' action that only works while open.
-- 3) Watchdog: the leo-demo-parity cron (hourly at :23) posts {op:"selftest"} to trip-voice, which drives the demo car
--    (status, cool, off), checks a real-shaped unlock is still refused, and raises/clears leo.demo-parity, signed Leo.
-- 4) Leo's team card now owns that job.

create table if not exists public.leo_settings (
  id int primary key default 1 check (id = 1),
  demo_open_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.leo_settings enable row level security;
revoke all on public.leo_settings from anon, authenticated;
insert into public.leo_settings (id, demo_open_until) values (1, now() + interval '7 days') on conflict (id) do nothing;

create or replace function public.leo_demo_open()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'open', coalesce(demo_open_until > now(), false),
    'until', case when demo_open_until > now() then demo_open_until end)
  from (select max(demo_open_until) demo_open_until from public.leo_settings where id = 1) s
$$;
revoke all on function public.leo_demo_open() from public;
grant execute on function public.leo_demo_open() to anon, authenticated, service_role;

create or replace function public.leo_demo_open_set(p_hours int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' and not public.has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'Admins only';
  end if;
  if p_hours is null or p_hours < 0 or p_hours > 720 then raise exception 'Hours must be 0 to 720'; end if;
  insert into public.leo_settings (id, demo_open_until, updated_at)
  values (1, case when p_hours = 0 then null else now() + make_interval(hours => p_hours) end, now())
  on conflict (id) do update set demo_open_until = excluded.demo_open_until, updated_at = now();
  return public.leo_demo_open();
end $$;
revoke all on function public.leo_demo_open_set(int) from public, anon;
grant execute on function public.leo_demo_open_set(int) to authenticated, service_role;

insert into public.security_public_rpcs (fn, why) values
  ('leo_demo_open', 'Trip page asks (publishable key) whether the temporary open demo is on; read only, returns only {open, until}')
on conflict (fn) do nothing;

-- Pretend car v3: v2 presets + unlock while the open demo is on.
create or replace function public.leo_demo_car(p_link text, p_name text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  st jsonb; a text; t numeric; dest text; mode text;
  is_open boolean := coalesce((public.leo_demo_open()->>'open')::boolean, false);
begin
  if p_link not in ('d:demo-home','d:demo-lax') then return jsonb_build_object('ok', false, 'error', 'not a demo'); end if;
  select case when updated_at > now() - interval '2 hours' then state end into st from leo_demo_car_state where link = p_link;
  st := coalesce(st, jsonb_build_object('locked', true, 'climate_on', false, 'climate_mode', 'off', 'target_f', 70, 'inside_f', 84,
                                        'outside_f', 79, 'battery', 78, 'range_mi', 241, 'nav', null));
  -- Auto-off after 20 minutes, like the real buttons.
  if coalesce((st->>'climate_on')::boolean, false) and (st->>'climate_until') is not null and (st->>'climate_until')::timestamptz < now() then
    st := st || jsonb_build_object('climate_on', false, 'climate_mode', 'off');
  end if;
  a := lower(coalesce(p_args->>'action', ''));
  if p_name = 'car_climate' then
    t := nullif(p_args->>'target_temp_f','')::numeric;
    mode := case when a in ('cool','start','on') then 'cool' when a = 'warm' then 'warm' when a = 'seat' then 'seat'
                 when a in ('off','stop') then 'off'
                 when a = 'set_temp' then case when coalesce(t, 70) <= 71 then 'cool' else 'warm' end end;
    if mode is null then return jsonb_build_object('ok', false, 'error', 'action must be cool, warm, seat or off'); end if;
    if mode = 'off' then st := st || jsonb_build_object('climate_on', false, 'climate_mode', 'off');
    else st := st || jsonb_build_object('climate_on', true, 'climate_mode', mode,
           'target_f', case mode when 'cool' then to_jsonb(68) when 'warm' then to_jsonb(74) else st->'target_f' end,
           'inside_f', case mode when 'cool' then to_jsonb(76) when 'warm' then to_jsonb(70) else st->'inside_f' end,
           'climate_until', now() + interval '20 minutes');
    end if;
  elsif p_name = 'car_lock' then
    if a = 'unlock' and not is_open then return jsonb_build_object('ok', false, 'error', 'unlock is off on the demo right now'); end if;
    if a not in ('lock','unlock') then return jsonb_build_object('ok', false, 'error', 'action must be lock'); end if;
    st := jsonb_set(st, '{locked}', to_jsonb(a = 'lock'));
  elsif p_name = 'send_to_car_nav' then
    dest := left(btrim(coalesce(p_args->>'destination', '')), 120);
    if length(dest) < 2 then return jsonb_build_object('ok', false, 'error', 'destination needed'); end if;
    st := jsonb_set(st, '{nav}', to_jsonb(dest));
  elsif p_name = 'find_superchargers' then
    return jsonb_build_object('ok', true, 'sites', jsonb_build_array(
      jsonb_build_object('name', 'Los Angeles - Century Blvd', 'miles', 1.2, 'open', 12, 'total', 20, 'lat', 33.9456, 'lon', -118.3712),
      jsonb_build_object('name', 'Hawthorne, CA', 'miles', 3.4, 'open', 8, 'total', 16, 'lat', 33.9167, 'lon', -118.3526),
      jsonb_build_object('name', 'Culver City, CA', 'miles', 5.9, 'open', 4, 'total', 12, 'lat', 34.0029, 'lon', -118.3931)));
  elsif p_name = 'charging_summary' then
    return jsonb_build_object('ok', true, 'charging', jsonb_build_object('total', 28.17, 'count', 2, 'kwh', 61.4, 'final', false,
      'sessions', jsonb_build_array(
        jsonb_build_object('started_at', now() - interval '20 hours', 'site', 'Barstow, CA', 'cost', 18.42),
        jsonb_build_object('started_at', now() - interval '14 hours', 'site', 'Baker, CA', 'cost', 9.75))));
  elsif p_name <> 'car_status' then
    return jsonb_build_object('ok', false, 'error', 'unknown tool');
  end if;
  insert into leo_demo_car_state(link, state, updated_at) values (p_link, st, now())
    on conflict (link) do update set state = excluded.state, updated_at = now();
  return jsonb_build_object('ok', true, 'car', st);
end $$;
revoke all on function public.leo_demo_car(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.leo_demo_car(text,text,jsonb) to service_role;

-- Watchdog: hourly at :23. trip-voice's selftest does the work and raises/clears leo.demo-parity itself.
select cron.unschedule('leo-demo-parity') where exists (select 1 from cron.job where jobname = 'leo-demo-parity');
select cron.schedule('leo-demo-parity', '23 * * * *', $c$select public.invoke_edge_function('trip-voice', '{"op":"selftest"}'::jsonb, 30000)$c$);

-- Team card: merge into Leo's existing card (keeps the Switchboard line pulse and leo-phone-watch, adds this job).
select public.team_onboard($j$[
 {"slug":"leo","name":"Leo","role":"Turo trip helper (voice)","reports_to":"jared","dept":"turo","runs_on":"cloud","icon":"phone-call","welcome":false,
  "schedule":"answers calls; Switchboard checks his line every 10 min; demo car self-test hourly at :23","admin_url":"/admin/agents/leo","sort":62,
  "what_it_does":"Talks with Turo guests by voice from the Talk to Leo button on their trip page and by phone: checks their Tesla key and sends a fresh one, checks extra drivers, runs the car buttons (climate, lock, Supercharger navigation), answers Supercharging and return-charge questions, opens things on their trip page, alerts Jared when a guest needs him, and files tickets. Every hour at :23 he runs his own test on the demo car (status, cool, off) and checks that unlock is still refused on real trips; if the demo car stops answering he tells you, signed Leo. Switchboard watches his line and tools.",
  "pulse":{"src":"at","table":"agent_health","col":"checked_at","ok":"ok","sum":"case when ok then 'Line OK' else 'Line problem' end","where":"agent_slug = 'leo'","gap":30,"alert":true,"on_demand":true,
           "also":["agent-watch","leo-phone-watch","leo-demo-parity","leo-client-diag-trim"]},
  "owns":["leo","leo.","agent.line.leo"]}
]$j$::jsonb);
