-- Delivery trip page, server half (docs/delivery-trip-opusplan.md, section 1). 2026-10-13.
-- Third guest trip page for every Turo trip that is neither LAX nor home pickup (hotels, pods, Union Station, custom addresses).
--
-- THE RULE: lax_guest_public().kind is NEVER changed. Delivery trips keep kind 'home' (keys, reminders, gating keep working).
-- Production's LaxGuest.tsx renders the LAX page for any kind that is not 'home'. Only the NEW fields `place` and `delivery` are added.
--
-- Everything here is additive and idempotent. Replaced functions (originals saved in bestly_memory, area home,
-- key house/turo/delivery-undo-2026-10-13): lax_guest_public, lax_guest_admin_list, lax_home_due, turo_link_body,
-- leo_phone_caller, lax_demo_tool, leo_demo_car, leo_demo_weather. Each is patched in place with a guarded string
-- replace (see zz_patch_fn), so nothing else in those bodies can drift.
--
-- NOTE on the file name: 20261013010000 was already taken by hunter_apollo_keys, so this is 20261013040000.
-- Applied to the live project in six pieces (delivery_trips_1 .. _5) because one big statement gets cancelled by the MCP; this file is the union.

-- ---------------------------------------------------------------------------------------------------------------------
-- 0. A switch that says the delivery PAGE is live on bestly.tech (flipped by the lead when the site merges).
--    While false: trip-health does not look for /t/demo-delivery assets, and turo_link_body will not hand out a trip link
--    for a delivery trip (production would show a hotel guest the N Kings Rd home page).
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.delivery_settings (
  id boolean primary key default true check (id),
  web_live boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.delivery_settings (id) values (true) on conflict do nothing;
alter table public.delivery_settings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='delivery_settings' and policyname='delivery_settings_admin') then
    create policy delivery_settings_admin on public.delivery_settings for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. delivery_locations: Jared's places. Reads for guests go through SECURITY DEFINER functions only.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.delivery_locations (
  id text primary key,
  kind text not null check (kind in ('hotel', 'pod', 'train', 'custom')),
  name text not null,
  short text not null,
  match text[] not null default '{}',       -- ilike patterns against Turo's location name
  address text,
  lat double precision,
  lon double precision,
  ask text[] not null default '{}',         -- what Leo collects: room | front_desk | parking | eta
  optional text[] not null default '{}',    -- the subset of ask the guest may skip
  parking_note text,
  fee numeric,                              -- stored, never shown to guests
  active boolean not null default true,
  sort int not null default 50,
  created_at timestamptz not null default now()
);
alter table public.delivery_locations enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='delivery_locations' and policyname='delivery_locations_admin') then
    create policy delivery_locations_admin on public.delivery_locations for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
  end if;
end $$;

insert into public.delivery_locations (id, kind, name, short, match, address, lat, lon, ask, optional, fee, sort) values
  ('space-pods-hollywood',      'pod',    'Space Pods Hollywood', 'Space Pods', array['%space pod%'], null, null, null, array['room','front_desk'], '{}', 40, 10),
  ('hyatt-regency-lax',         'hotel',  'Hyatt Regency Los Angeles International Airport', 'Hyatt Regency LAX',
     array['%hyatt regency%los angeles international%','%hyatt regency%lax%','%hyatt%lax%'], '6225 W Century Blvd, Los Angeles, CA 90045', null, null, array['room','front_desk'], '{}', 70, 20),
  ('courtyard-lax-century',     'hotel',  'Courtyard Los Angeles LAX / Century Boulevard', 'Courtyard LAX',
     array['%courtyard%lax%','%courtyard%century%'], '5711 W Century Blvd, Los Angeles, CA 90045', null, null, array['room','front_desk'], '{}', 70, 30),
  ('sheraton-gateway-lax',      'hotel',  'Sheraton Gateway Los Angeles Hotel', 'Sheraton Gateway',
     array['%sheraton gateway%'], '6101 W Century Blvd, Los Angeles, CA 90045', null, null, array['room','front_desk'], '{}', 70, 40),
  ('best-western-sunset-plaza', 'hotel',  'Best Western Plus Sunset Plaza Hotel', 'Best Western Sunset Plaza',
     array['%sunset plaza%'], '8400 Sunset Blvd, West Hollywood, CA 90069', 34.09506, -118.37267, array['room','front_desk'], '{}', 45, 50),
  ('sls-beverly-hills',         'hotel',  'SLS Hotel, a Luxury Collection Hotel, Beverly Hills', 'SLS Beverly Hills',
     array['%sls%beverly%'], '465 S La Cienega Blvd, Los Angeles, CA 90048', null, null, array['room','front_desk'], '{}', 35, 60),
  ('union-station',             'train',  'Union Station', 'Union Station',
     array['%union station%'], '800 N Alameda St, Los Angeles, CA 90012', 34.05614, -118.23655, array['eta'], '{}', 120, 70),
  ('custom',                    'custom', 'Your address', 'your address', '{}', null, null, null, array['room','parking'], array['room'], null, 99)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. trip_delivery_info: what the guest told Leo / the page. One row per reservation.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.trip_delivery_info (
  reservation_id bigint primary key,
  room text,
  front_desk text,
  parking text,
  eta text,
  reported_at timestamptz,
  via text check (via in ('leo', 'page')),
  guest_phone text,                          -- digits only, copied from the trip: the key Vera uses to find this person
  saves_hour_start timestamptz,
  saves_hour int not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.trip_delivery_info enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='trip_delivery_info' and policyname='trip_delivery_info_admin') then
    create policy trip_delivery_info_admin on public.trip_delivery_info for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
  end if;
end $$;

-- Vera (Privacy Clerk): the privacy map matches people by email/phone only, so the row is found by guest_phone and deleted whole
-- (room, front desk, parking and train time go with it; a blank would leave an empty row that proves nothing).
insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason, enabled)
select 'trip_delivery_info', 'guest_phone', 'phone', 'delete',
       'Delivery notes the guest gave Leo (room, front desk, parking, train time); removed with their phone number', true
 where not exists (select 1 from public.privacy_data_map where table_name = 'trip_delivery_info' and column_name = 'guest_phone');

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. place + location
-- ---------------------------------------------------------------------------------------------------------------------
-- 'lax' when the car is at LAX. 'home' for an ordinary street pickup (type STREET, not a delivery). Everything else is a delivery
-- (LODGING, a street delivery, any other airport). NOT the old (kings|90069) rule: the Best Western is 90069 too.
create or replace function public.trip_place(p_reservation bigint) returns text
language sql stable security definer set search_path to 'public' as $fn$
  select case
    when t.reservation_id is null then 'home'
    when coalesce(t.airport_code, '') = 'LAX' then 'lax'
    when t.raw is null or t.raw->'location' is null then 'home'
    when upper(coalesce(t.raw->'location'->>'type', '')) = 'STREET'
         and coalesce((t.raw->'location'->>'deliveryLocation')::boolean, false) = false then 'home'
    else 'delivery' end
  from (select 1) x left join public.turo_trips t on t.reservation_id = p_reservation
$fn$;

create or replace function public.trip_delivery_location(p_reservation bigint) returns text
language plpgsql stable security definer set search_path to 'public' as $fn$
declare t turo_trips; nm text; v text;
begin
  select * into t from turo_trips where reservation_id = p_reservation;
  if t.reservation_id is null then return 'custom'; end if;
  nm := coalesce(t.raw->'location'->>'name', '');
  if nm <> '' then
    select dl.id into v from delivery_locations dl
     where dl.active and dl.id <> 'custom' and exists (select 1 from unnest(dl.match) m where nm ilike m)
     order by dl.sort limit 1;
    if v is not null then return v; end if;
  end if;
  if t.pickup_lat is not null and t.pickup_lon is not null then
    select dl.id into v from delivery_locations dl
     where dl.active and dl.id <> 'custom' and dl.lat is not null and dl.lon is not null
       and trip_dist_m(t.pickup_lat, t.pickup_lon, dl.lat, dl.lon) <= 183   -- 600 ft
     order by trip_dist_m(t.pickup_lat, t.pickup_lon, dl.lat, dl.lon), dl.sort limit 1;
    if v is not null then return v; end if;
  end if;
  return 'custom';
end $fn$;

-- The `delivery` object of the payload contract (plan section 0). Pure builder: one location row + the trip facts + the info jsonb.
create or replace function public.trip_delivery_build(d delivery_locations, p_name text, p_addr text, p_lat double precision,
                                                      p_lon double precision, p_instr text, p_info jsonb) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare v_name text; v_short text; v_addr text; v_ask text[];
begin
  if d.id = 'custom' then
    v_name := coalesce(nullif(btrim(p_name), ''), nullif(btrim(p_addr), ''), d.name);
    v_short := coalesce(nullif(btrim(p_name), ''), nullif(btrim(split_part(coalesce(p_addr, ''), ',', 1)), ''), d.short);
    v_addr := coalesce(nullif(btrim(p_addr), ''), d.address);
  else
    v_name := d.name; v_short := d.short; v_addr := coalesce(d.address, nullif(btrim(p_addr), ''));
  end if;
  select coalesce(array_agg(u.a order by u.ord), '{}') into v_ask
    from unnest(d.ask) with ordinality u(a, ord)
   where nullif(btrim(coalesce(p_info->>u.a, '')), '') is null;
  return jsonb_build_object(
    'location_id', d.id, 'kind', d.kind, 'name', v_name, 'short', v_short, 'address', v_addr,
    'lat', coalesce(p_lat, d.lat), 'lon', coalesce(p_lon, d.lon),
    'ask', to_jsonb(v_ask), 'optional', to_jsonb(d.optional),
    'info', jsonb_build_object('room', nullif(p_info->>'room', ''), 'front_desk', nullif(p_info->>'front_desk', ''),
      'parking', nullif(p_info->>'parking', ''), 'eta', nullif(p_info->>'eta', ''),
      'reported_at', nullif(p_info->>'reported_at', ''), 'via', nullif(p_info->>'via', '')),
    'turo_instructions', nullif(btrim(coalesce(p_instr, '')), ''),
    'return_note', 'Bring it back here, same place.');
end $fn$;

create or replace function public.trip_delivery_json(p_reservation bigint) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare t turo_trips; d delivery_locations; i trip_delivery_info;
begin
  select * into t from turo_trips where reservation_id = p_reservation;
  if t.reservation_id is null then return null; end if;
  select * into d from delivery_locations where id = trip_delivery_location(p_reservation);
  select * into i from trip_delivery_info where reservation_id = p_reservation;
  return trip_delivery_build(d, t.raw->'location'->>'name', t.pickup_address, t.pickup_lat, t.pickup_lon,
    t.raw->'location'->'pickupAndReturn'->>'deliveryInstructions',
    jsonb_build_object('room', i.room, 'front_desk', i.front_desk, 'parking', i.parking, 'eta', i.eta,
      'reported_at', i.reported_at, 'via', i.via));
end $fn$;

-- Dynamic variables Leo's prompt needs on a delivery trip (empty object for lax/home).
create or replace function public.trip_delivery_vars(p_reservation bigint) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare j jsonb;
begin
  if trip_place(p_reservation) <> 'delivery' then return '{}'::jsonb; end if;
  j := trip_delivery_json(p_reservation);
  return jsonb_build_object('delivery_name', j->>'short', 'delivery_kind', j->>'kind',
    'delivery_missing', coalesce((select string_agg(x, ',') from jsonb_array_elements_text(j->'ask') x), ''),
    'return_place', j->>'short');
end $fn$;

-- Internal helpers: not callable with the public key (Ares would lock them anyway).
revoke all on function public.trip_place(bigint) from public, anon, authenticated;
revoke all on function public.trip_delivery_location(bigint) from public, anon, authenticated;
revoke all on function public.trip_delivery_build(delivery_locations, text, text, double precision, double precision, text, jsonb) from public, anon, authenticated;
revoke all on function public.trip_delivery_json(bigint) from public, anon, authenticated;
revoke all on function public.trip_delivery_vars(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. trip_place_for(token): like lax_trip_kind_for but returns the place (the trip.html splash). Public-key RPC.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.trip_place_for(p_token text) returns text
language sql stable security definer set search_path to 'public' as $fn$
  select case when p_token = 'demo-delivery' then 'delivery'
         else (select trip_place(l.reservation_id) from lax_guest_links l where l.token = p_token) end
$fn$;
grant execute on function public.trip_place_for(text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. trip_delivery_report: the guest (page form) or Leo (delivery_info tool) hands over room / front desk / parking / train time.
--    Token-bound, 200 chars per field, merges (a blank field never erases what is saved), 30 saves an hour per trip.
--    A CHANGE tells Jared, signed Leo: it interrupts only when the guest is close to pickup or on the trip (a real person waiting).
--    demo-delivery keeps its notes in lax_demo_state and never notifies.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.trip_delivery_report(p_token text, p_room text default null, p_front_desk text default null,
  p_parking text default null, p_eta text default null, p_via text default 'page') returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  l lax_guest_links; t turo_trips; o trip_delivery_info; n trip_delivery_info; dj jsonb; st jsonb; inf jsonb; d delivery_locations;
  v_via text := case when p_via = 'leo' then 'leo' else 'page' end;
  r text; f text; p text; e text; first_name text; short text; title text; body text; room_lbl text; live boolean; sig text;
begin
  r := left(nullif(btrim(regexp_replace(coalesce(p_room, ''), '\s+', ' ', 'g')), ''), 200);
  f := left(nullif(btrim(regexp_replace(coalesce(p_front_desk, ''), '\s+', ' ', 'g')), ''), 200);
  p := left(nullif(btrim(regexp_replace(coalesce(p_parking, ''), '\s+', ' ', 'g')), ''), 200);
  e := left(nullif(btrim(regexp_replace(coalesce(p_eta, ''), '\s+', ' ', 'g')), ''), 200);
  if r is null and f is null and p is null and e is null then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;

  if p_token = 'demo-delivery' then
    select * into d from delivery_locations where id = 'best-western-sunset-plaza';
    select case when updated_at > now() - interval '2 hours' then state end into st from lax_demo_state where link = 'd:demo-delivery';
    st := coalesce(st, '{}'::jsonb);
    inf := coalesce(st->'delivery', '{}'::jsonb);
    inf := inf || jsonb_strip_nulls(jsonb_build_object('room', r, 'front_desk', f, 'parking', p, 'eta', e,
      'reported_at', now(), 'via', v_via));
    st := jsonb_set(st, '{delivery}', inf, true);
    insert into lax_demo_state (link, state, updated_at) values ('d:demo-delivery', st, now())
      on conflict (link) do update set state = excluded.state, updated_at = now();
    return jsonb_build_object('ok', true, 'demo', true, 'changed', true,
      'delivery', trip_delivery_build(d, 'Best Western Plus Sunset Plaza Hotel', '8400 Sunset Boulevard, Los Angeles, CA 90069', 34.09506, -118.37267, null, inf));
  end if;

  select * into l from lax_guest_links where token = p_token;
  if l.reservation_id is null then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  select * into t from turo_trips where reservation_id = l.reservation_id;
  if t.reservation_id is null or t.ends_at < now() - interval '1 day' then return jsonb_build_object('ok', false, 'reason', 'ended'); end if;
  if trip_place(t.reservation_id) <> 'delivery' then return jsonb_build_object('ok', false, 'reason', 'not_delivery'); end if;

  select * into o from trip_delivery_info where reservation_id = t.reservation_id;
  if o.reservation_id is not null and o.saves_hour_start > now() - interval '1 hour' and o.saves_hour >= 30 then
    return jsonb_build_object('ok', false, 'reason', 'slow_down');
  end if;

  insert into trip_delivery_info as x (reservation_id, room, front_desk, parking, eta, reported_at, via, guest_phone, saves_hour_start, saves_hour)
  values (t.reservation_id, r, f, p, e, now(), v_via,
          nullif(regexp_replace(coalesce(l.sms_phone, t.guest_phone, ''), '\D', '', 'g'), ''), now(), 1)
  on conflict (reservation_id) do update set
    room = coalesce(excluded.room, x.room), front_desk = coalesce(excluded.front_desk, x.front_desk),
    parking = coalesce(excluded.parking, x.parking), eta = coalesce(excluded.eta, x.eta),
    reported_at = now(), via = v_via,
    guest_phone = coalesce(x.guest_phone, excluded.guest_phone),
    saves_hour_start = case when x.saves_hour_start > now() - interval '1 hour' then x.saves_hour_start else now() end,
    saves_hour = case when x.saves_hour_start > now() - interval '1 hour' then x.saves_hour + 1 else 1 end,
    updated_at = now();
  select * into n from trip_delivery_info where reservation_id = t.reservation_id;
  dj := trip_delivery_json(t.reservation_id);

  -- Tell Jared only when something actually changed (a repeat of the same words is silent).
  if md5(concat_ws('|', o.room, o.front_desk, o.parking, o.eta)) is distinct from md5(concat_ws('|', n.room, n.front_desk, n.parking, n.eta)) then
    begin
      first_name := coalesce(nullif(initcap(btrim(t.guest_first)), ''), 'Your guest');
      short := dj->>'short';
      live := now() between t.starts_at - interval '24 hours' and t.ends_at;
      room_lbl := case when n.room is null then null
                       when dj->>'kind' = 'hotel' and n.room ~ '^[A-Za-z0-9-]{1,8}$' then 'room ' || n.room
                       else n.room end;
      title := case when n.room is distinct from o.room and room_lbl is not null
                    then 'Leo: ' || first_name || ' is in ' || room_lbl || ' at ' || short
                    else 'Leo: ' || first_name || ' sent delivery info for ' || short end;
      body := 'Res ' || t.reservation_id || '. '
              || coalesce('Room: ' || n.room || '. ', '') || coalesce('Front desk: ' || n.front_desk || '. ', '')
              || coalesce('Parking: ' || n.parking || '. ', '') || coalesce('Train gets in: ' || n.eta || '. ', '')
              || 'Pickup ' || to_char(t.starts_at at time zone 'America/Los_Angeles', 'Dy Mon FMDD, FMHH12:MI AM') || '. Told ' ||
              case v_via when 'leo' then 'Leo' else 'the trip page' end || '.';
      sig := md5(concat_ws('|', n.room, n.front_desk, n.parking, n.eta));
      if live then perform set_config('autonomy.allow', '1', true); end if;   -- a guest waiting on a delivery is "a real person waiting"
      perform notify_route(title, body, case when live then 'time-sensitive' else 'passive' end, 'Leo', 'https://bestly.tech/admin/turo/lax-pass',
                           null, 'leo.delivery.' || t.reservation_id || '.' || sig, null, null, false, now());
    exception when others then null;   -- never lose the guest's answer because a push failed
    end;
  end if;

  return jsonb_build_object('ok', true, 'changed', true, 'delivery', dj);
end $fn$;
grant execute on function public.trip_delivery_report(text, text, text, text, text, text) to anon, authenticated;

insert into public.security_public_rpcs (fn, why)
select v.fn, v.why from (values
  ('trip_place_for', 'Delivery trip page (2026-10-13): the trip.html splash asks (publishable key) which look to show for a trip link; returns only lax, home or delivery'),
  ('trip_delivery_report', 'Delivery trip page (2026-10-13): the guest''s trip page form and Leo save the room number / front desk / parking / train time for ONE trip, bound to the trip token; 200 chars a field, 30 saves an hour')
) v(fn, why) where not exists (select 1 from public.security_public_rpcs s where s.fn = v.fn);

-- Leo's team card already owns 'leo' and 'leo.'; make the delivery alert prefix explicit so the Recruiter's scanner sees it.
insert into public.notification_owners (prefix, agent_slug, note)
select 'leo.delivery', 'leo', 'Delivery trip page: guest gave Leo a room number / front-desk / parking / train time (2026-10-13)'
 where not exists (select 1 from public.notification_owners where prefix = 'leo.delivery');

-- ---------------------------------------------------------------------------------------------------------------------
-- 5/7/8. Patch the live functions in place (guarded: runs once, skips if already patched, raises if the text moved).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.zz_patch_fn(p_sig regprocedure, p_old text, p_new text) returns text
language plpgsql as $fn$
declare d text;
begin
  d := pg_get_functiondef(p_sig);
  if position(p_new in d) > 0 then return 'already'; end if;
  if position(p_old in d) = 0 then raise exception 'patch target not found in %: %', p_sig, left(p_old, 80); end if;
  execute replace(d, p_old, p_new);
  return 'patched';
end $fn$;

do $patch$
begin
  -- lax_guest_public: ADD place + delivery. kind is not touched.
  perform zz_patch_fn('public.lax_guest_public(text)'::regprocedure,
    $q$v_rel boolean; v_held boolean;$q$,
    $q$v_rel boolean; v_held boolean; v_place text; v_delivery jsonb := null;$q$);
  perform zz_patch_fn('public.lax_guest_public(text)'::regprocedure,
    $q$kind := lax_trip_kind(t.airport_code);$q$,
    $q$kind := lax_trip_kind(t.airport_code);
  v_place := trip_place(t.reservation_id);
  if v_place = 'delivery' then v_delivery := trip_delivery_json(t.reservation_id); end if;$q$);
  perform zz_patch_fn('public.lax_guest_public(text)'::regprocedure,
    $q$'ok', true, 'kind', kind,$q$,
    $q$'ok', true, 'kind', kind, 'place', v_place, 'delivery', v_delivery,$q$);

  -- lax_guest_admin_list: add place, delivery_short, delivery_info, delivery_ask.
  perform zz_patch_fn('public.lax_guest_admin_list()'::regprocedure,
    $q$'kind', lax_trip_kind(t.airport_code), 'activity',$q$,
    $q$'kind', lax_trip_kind(t.airport_code), 'place', trip_place(t.reservation_id), 'delivery_short', dl.dj->>'short',
      'delivery_info', dl.dj->'info', 'delivery_ask', dl.dj->'ask', 'activity',$q$);
  perform zz_patch_fn('public.lax_guest_admin_list()'::regprocedure,
    $q$left join tesla_guest_keys k using (reservation_id)$q$,
    $q$left join tesla_guest_keys k using (reservation_id)
    left join lateral (select case when trip_place(t.reservation_id) = 'delivery' then trip_delivery_json(t.reservation_id) end as dj) dl on true$q$);

  -- lax_home_due: the "N Kings Rd" reminder email never goes to a hotel guest.
  perform zz_patch_fn('public.lax_home_due()'::regprocedure,
    $q$where lax_trip_kind(t.airport_code) = 'home' and l.email is not null$q$,
    $q$where lax_trip_kind(t.airport_code) = 'home' and trip_place(t.reservation_id) <> 'delivery' and l.email is not null$q$);

  -- Leo's pretend car + demo helper accept the demo-delivery page too.
  perform zz_patch_fn('public.lax_demo_tool(text,text,jsonb)'::regprocedure,
    $q$p_link not in ('d:demo-home','d:demo-lax')$q$, $q$p_link not in ('d:demo-home','d:demo-lax','d:demo-delivery')$q$);
  perform zz_patch_fn('public.leo_demo_car(text,text,jsonb)'::regprocedure,
    $q$p_link not in ('d:demo-home','d:demo-lax')$q$, $q$p_link not in ('d:demo-home','d:demo-lax','d:demo-delivery')$q$);
  perform zz_patch_fn('public.leo_demo_weather(text,text)'::regprocedure,
    $q$p_link not in ('d:demo-home','d:demo-lax')$q$, $q$p_link not in ('d:demo-home','d:demo-lax','d:demo-delivery')$q$);

  -- Leo on the phone: a hotel guest is "delivery", not "home" (the old (kings|90069) rule called the Best Western home).
  perform zz_patch_fn('public.leo_phone_caller(text)'::regprocedure,
    $q$when coalesce(t.pickup_address,'') ~* '(kings|90069)' then 'home'$q$,
    $q$when public.trip_place(t.reservation_id) = 'home' then 'home'$q$);
  perform zz_patch_fn('public.leo_phone_caller(text)'::regprocedure,
    $q$'minutes_to_pickup', round(extract(epoch from t.starts_at - now())/60)::int, 'controls_state', 'unknown');$q$,
    $q$'minutes_to_pickup', round(extract(epoch from t.starts_at - now())/60)::int, 'controls_state', 'unknown')
    || coalesce(public.trip_delivery_vars(t.reservation_id), '{}'::jsonb);$q$);

  -- The Turo "here is your trip page" message: a delivery trip gets its own wording, and none until the page is live on the site.
  perform zz_patch_fn('public.turo_link_body(bigint)'::regprocedure,
    $q$url := 'bestly.tech/t/' || l.token;$q$,
    $q$url := 'bestly.tech/t/' || l.token;
  if trip_place(t.reservation_id) = 'delivery' then
    if not coalesce((select s.web_live from delivery_settings s where s.id), false) then return null; end if;
    return 'Hi ' || coalesce(t.guest_first, 'there') || '! Thanks for booking Blue Steel 🚗 I''ll drive your Tesla to ' || (trip_delivery_json(t.reservation_id)->>'short')
      || '. Everything for your trip is on your personal trip page: ' || url || E'\n\n'
      || 'Leo, our trip helper, is there too: tell him your room number and any parking info so I can find you. Your Tesla key turns on after I check the car in with you, and the return is the same spot. See you soon! – Jared';
  end if;$q$);
end $patch$;


-- Ended (>14 days) branch of lax_guest_public also carries place, so a finished delivery trip keeps its look.
do $p$
declare d text;
  o text := $q$'reason', 'ended', 'kind', lax_trip_kind(t.airport_code));$q$;
  n text := $q$'reason', 'ended', 'kind', lax_trip_kind(t.airport_code), 'place', trip_place(t.reservation_id));$q$;
begin
  d := pg_get_functiondef('public.lax_guest_public(text)'::regprocedure);
  if position(n in d) > 0 then return; end if;
  if position(o in d) = 0 then raise exception 'ended branch not found'; end if;
  execute replace(d, o, n);
end $p$;

-- The patch helper is not for the public key.
revoke all on function public.zz_patch_fn(regprocedure, text, text) from public, anon, authenticated;
-- (zz_patch_fn is left in place on purpose: the MCP session could not run DROP. Drop it by hand: drop function public.zz_patch_fn(regprocedure, text, text);)
