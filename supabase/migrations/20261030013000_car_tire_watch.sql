-- Car Guard tire watch (2026-10-29, Jared). Lesson from Craig's trip (62784054): the car showed "Air pressure in tires very
-- low - PULL OVER SAFELY" 5 minutes into the trip, the guest drove about 15 more miles, the tire came off the rim, and nobody
-- but the guest knew until 3:35 PM. The car could have told us: Tesla streams each tire's pressure and its own soft / hard
-- tire warnings over Fleet Telemetry; we only streamed location.
--
-- What this adds (Car Guard owns it; alerts car.tire.*):
--   1. The car streams TpmsPressureFl/Fr/Rl/Rr + TpmsSoftWarnings / TpmsHardWarnings to the receiver on bestly-pi (hestia).
--      car-telemetry-fwd 1.1.0 posts them to car_tire_ingest (at once on a warning change).
--   2. During a trip, a Tesla tire warning (or any tire at or under 30 psi) posts a message in the Turo chat (the record Turo
--      reviews; Turo also pushes it to the guest's phone) that sends the guest to Turo Roadside Assistance (415) 965-4525
--      and quotes Turo's flat tire policy. Our own stricter thresholds (car_protect_settings) only tell Jared.
--      Wording rules (Jared): never "call Leo" / never diagnose; quote the car's own warning; point to Turo and its policy.
--   3. Trip-start tire check: a fresh Fleet API read before pickup; once the trip starts, the four pressures and the time the
--      sensors last measured them are posted in the Turo chat. That is the proof of proper inflation at the start of the trip
--      (Turo makes the host pay for a flat if the tire was improperly inflated at the start of the trip).
--   4. A hard warning opens (or adds to) the Claims Closer case with Turo's deadline: damage report within 24 hours after
--      the trip ends.
--   5. turo_out_msgs (already in the database, unused until now) is the queue; turo-reader 1.6.0 sends and verifies.
-- Sources (Oct 29, 2026): help.turo.com Flat tire damage | Hosts / Guests, Roadside assistance | US hosts / guests.
-- Guest texts (Leo SMS) are off until Leo's text line is approved, so the Turo chat is the only guest channel for now.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Stream the tires (the worker pushes this config to the car)
-- ---------------------------------------------------------------------------------------------------------------
update public.car_telemetry_settings
   set fields = fields || '{"TpmsPressureFl":{"interval_seconds":60},"TpmsPressureFr":{"interval_seconds":60},
                            "TpmsPressureRl":{"interval_seconds":60},"TpmsPressureRr":{"interval_seconds":60},
                            "TpmsHardWarnings":{"interval_seconds":5},"TpmsSoftWarnings":{"interval_seconds":5}}'::jsonb,
       updated_at = now()
 where id = 1;
insert into public.tesla_fleet_commands (action, auto) values ('telemetry_push', true);

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Readings + settings
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.car_tire_readings (
  id             bigserial primary key,
  at             timestamptz not null default now(),     -- when the car measured / sent it
  vin            text,
  reservation_id bigint,                                  -- the trip the car was on, if any
  source         text not null check (source in ('stream', 'pickup')),
  fl numeric, fr numeric, rl numeric, rr numeric,         -- psi
  hard_warn      text,                                    -- Tesla's raw enum text
  soft_warn      text,
  measured_at    timestamptz,                             -- pickup reads: when the sensors last measured
  created_at     timestamptz not null default now()
);
create index if not exists car_tire_readings_res_at on public.car_tire_readings (reservation_id, at desc);
create index if not exists car_tire_readings_at on public.car_tire_readings (at desc);
alter table public.car_tire_readings enable row level security;
revoke all on public.car_tire_readings from anon, authenticated;
drop policy if exists car_tire_readings_admin_read on public.car_tire_readings;
create policy car_tire_readings_admin_read on public.car_tire_readings for select to authenticated using (has_role(auth.uid(), 'admin'));
grant select on public.car_tire_readings to authenticated;

create table if not exists public.car_tire_settings (
  id              int primary key default 1 check (id = 1),
  enabled         boolean not null default true,
  guest_hard_psi  numeric not null default 30,           -- at or under this during a trip: same message as Tesla's hard warning
  roadside_phone  text not null default '(415) 965-4525', -- Turo Roadside Assistance, US, 24/7 (help.turo.com, Oct 2026)
  pickup_check    boolean not null default true,
  updated_at      timestamptz not null default now()
);
insert into public.car_tire_settings (id) values (1) on conflict (id) do nothing;
alter table public.car_tire_settings enable row level security;
revoke all on public.car_tire_settings from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.car_tire_is_warn(p text) returns boolean language sql immutable as $$
  select p is not null and btrim(p) <> '' and lower(p) !~ '(none|invalid|^0+$|^false$|^\[\]$|^\{\}$)';
$$;

create or replace function public.car_tire_name(p text) returns text language sql immutable as $$
  select case p when 'fl' then 'front left' when 'fr' then 'front right' when 'rl' then 'rear left' when 'rr' then 'rear right' end;
$$;

create or replace function public.car_tire_pt(p timestamptz) returns text language sql stable as $$
  select to_char(p at time zone 'America/Los_Angeles', 'FMHH12:MI AM');
$$;

-- The tire Tesla's warning names, else the lowest one.
create or replace function public.car_tire_pick(p_t jsonb, p_warn text) returns text language plpgsql immutable as $$
declare k text; best text; bv numeric;
begin
  if p_warn is not null then
    if p_warn ~* '(fl|front.?left)' then return 'fl'; end if;
    if p_warn ~* '(fr|front.?right)' then return 'fr'; end if;
    if p_warn ~* '(rl|rear.?left)' then return 'rl'; end if;
    if p_warn ~* '(rr|rear.?right)' then return 'rr'; end if;
  end if;
  foreach k in array array['fl','fr','rl','rr'] loop
    if (p_t->>k) ~ '^[0-9.]+$' and (bv is null or (p_t->>k)::numeric < bv) then bv := (p_t->>k)::numeric; best := k; end if;
  end loop;
  return best;
end $$;

create or replace function public.car_tire_poke_reader() returns void language sql security definer set search_path to 'public' as $$
  update turo_reader_state set poke_at = now() where id = 1;
$$;

-- The trip the car is on right now (start to end + 30 min), if any.
create or replace function public.car_tire_active_trip(p_vin text) returns turo_trips language sql stable security definer set search_path to 'public' as $$
  select * from turo_trips t
   where (p_vin is null or t.vin = p_vin or t.vin is null)
     and now() between t.starts_at and t.ends_at + interval '30 minutes'
     and coalesce(t.status, '') !~* 'cancel'
   order by t.starts_at desc limit 1;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. The decision (stream readings)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.car_tire_evaluate(p_id bigint) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare r car_tire_readings; s car_tire_settings; ps car_protect_settings; t turo_trips; tj jsonb; lo numeric; hi numeric;
  hard boolean; soft boolean; tire text; psi numeric; who text; body text; msg_id uuid; kind text; c uuid; line text;
begin
  select * into r from car_tire_readings where id = p_id;
  select * into s from car_tire_settings where id = 1;
  select * into ps from car_protect_settings where id = 1;
  if r.id is null or not coalesce(s.enabled, true) then return jsonb_build_object('skip', true); end if;
  tj := jsonb_strip_nulls(jsonb_build_object('fl', r.fl, 'fr', r.fr, 'rl', r.rl, 'rr', r.rr));
  select min(value::numeric), max(value::numeric) into lo, hi from jsonb_each_text(tj);
  hard := car_tire_is_warn(r.hard_warn) or (lo is not null and lo <= s.guest_hard_psi);
  soft := car_tire_is_warn(r.soft_warn);
  tire := car_tire_pick(tj, case when car_tire_is_warn(r.hard_warn) then r.hard_warn when soft then r.soft_warn end);
  psi := (tj->>tire)::numeric;
  t := car_tire_active_trip(r.vin);
  who := coalesce(t.guest_first, 'the guest');
  line := 'Tesla ' || case when car_tire_is_warn(r.hard_warn) then 'hard tire warning (' || r.hard_warn || ')'
                           when soft then 'soft tire warning (' || r.soft_warn || ')' else 'tire reading' end
          || ' at ' || car_tire_pt(r.at) || ' ' || to_char(r.at at time zone 'America/Los_Angeles', 'Mon FMDD')
          || coalesce('; ' || car_tire_name(tire) || ' ' || round(psi) || ' psi', '')
          || '; all four: FL ' || coalesce(r.fl::text, '?') || ', FR ' || coalesce(r.fr::text, '?') || ', RL ' || coalesce(r.rl::text, '?')
          || ', RR ' || coalesce(r.rr::text, '?') || ' psi.';

  -- Not on a trip (Jared or a delivery driving): Jared only.
  if t.reservation_id is null then
    if hard or soft then
      perform bestly_raise('car.tire.notrip.' || to_char(now(), 'YYYYMMDD'), 'problem', 'warning',
        'Tire warning on the Model 3 (no trip right now)', line, 'turo',
        'Check the ' || coalesce(car_tire_name(tire), 'low') || ' tire before the next guest.');
    end if;
    return jsonb_build_object('trip', null, 'hard', hard, 'soft', soft);
  end if;

  if hard then
    kind := 'tire_hard';
    body := 'Important: your Tesla just reported very low pressure in ' || coalesce('the ' || car_tire_name(tire) || ' tire', 'a tire')
         || coalesce(' (' || round(psi) || ' psi at ' || car_tire_pt(r.at) || ')', ' (' || car_tire_pt(r.at) || ')')
         || '. When the car shows "PULL OVER SAFELY - Check for flat tire," please pull over when it''s safe and don''t keep driving on it, since that can destroy the tire and wheel. '
         || 'Call Turo Roadside Assistance, 24/7: ' || s.roadside_phone || '. '
         || 'Per Turo''s flat tire policy, please message me here before any repair or tire replacement, and keep all receipts.';
  elsif soft and not exists (select 1 from turo_out_msgs where reservation_id = t.reservation_id and kind = 'tire_hard') then
    kind := 'tire_soft';
    body := 'Heads up: your Tesla is showing low pressure in ' || coalesce('the ' || car_tire_name(tire) || ' tire', 'a tire')
         || coalesce(' (' || round(psi) || ' psi at ' || car_tire_pt(r.at) || ')', ' (' || car_tire_pt(r.at) || ')')
         || '. Please don''t keep driving on a low tire. If the warning stays on, pull over when it''s safe and call Turo Roadside Assistance, 24/7: '
         || s.roadside_phone || '. Per Turo''s flat tire policy, please message me here before any repair or tire replacement, and keep all receipts.';
  end if;

  if kind is not null then
    insert into turo_out_msgs (reservation_id, kind, body, verify_snippet, status)
    values (t.reservation_id, kind, body, 'Turo Roadside Assistance, 24/7', 'queued')
    on conflict (reservation_id, kind) do nothing
    returning id into msg_id;
    if msg_id is not null then
      perform car_tire_poke_reader();
      perform bestly_raise('car.tire.' || kind || '.' || t.reservation_id, 'problem', case when hard then 'error' else 'warning' end,
        case when hard then 'Flat tire warning on ' || who || '''s trip' else 'Low tire on ' || who || '''s trip' end,
        line || ' I posted a message in the Turo chat telling ' || who || ' to pull over and call Turo Roadside Assistance ' || s.roadside_phone
          || ', and to message you before any repair or replacement.', 'turo',
        case when hard then 'Watch the Turo chat. A replacement tire needs your OK (equal or better quality, per Turo).' end);
    end if;
  elsif lo is not null and (lo < ps.tire_low_psi or hi - lo > ps.tire_spread_psi) then
    -- Our own stricter limits, no Tesla warning: Jared only, once a trip.
    perform bestly_raise('car.tire.watch.' || t.reservation_id, 'problem', 'warning', 'A tire is running low on ' || who || '''s trip',
      line || ' Tesla shows no warning yet, so the guest has not been told.', 'turo', null);
  end if;

  -- Claims Closer: a hard warning is evidence, and Turo wants the damage report within 24 hours after the trip ends.
  if hard then
    select id into c from claim_cases where reservation_id = t.reservation_id;
    if c is null then
      insert into claim_cases (reservation_id, guest_first, guest_last, vin, trip_end, path, goal, escalate_by, opened_at,
                               turo_deadline, held_for_gate, needs_work, work_reason, facts)
      values (t.reservation_id, t.guest_first, t.guest_last, t.vin, t.ends_at, 'turo_claim',
              'Tire warning during the trip. At return, check the tire and wheel. If they are damaged, report it in Turo within 24 hours after the trip ends and get the cost paid by the guest. If nothing is damaged, close the case.',
              t.ends_at + interval '20 days', now(), t.ends_at + interval '24 hours', true, true, 'tire warning during the trip', line)
      returning id into c;
      insert into claim_events (case_id, reservation_id, kind, title) values (c, t.reservation_id, 'opened', 'Case opened by Car Guard: ' || line);
    else
      update claim_cases set facts = coalesce(facts || ' ', '') || 'Car Guard: ' || line,
             turo_deadline = coalesce(turo_deadline, t.ends_at + interval '24 hours'), needs_work = true, updated_at = now()
       where id = c and coalesce(facts, '') not like '%' || car_tire_pt(r.at) || '%';
    end if;
  end if;
  return jsonb_build_object('trip', t.reservation_id, 'hard', hard, 'soft', soft, 'sent', kind, 'msg', msg_id);
end $fn$;

-- Called by car-telemetry-fwd on bestly-pi with the publishable key + the ingest token (same token as car_telemetry_ingest).
create or replace function public.car_tire_ingest(p_token text, p_row jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare s car_telemetry_settings; fs tesla_fleet_settings; t turo_trips; nid bigint; at_ timestamptz;
  f numeric[]; k text; i int := 0;
begin
  select * into s from car_telemetry_settings where id = 1;
  if p_token is null or s.token_hash is null or encode(sha256(convert_to(p_token, 'utf8')), 'hex') <> s.token_hash then
    raise exception 'forbidden';
  end if;
  select * into fs from tesla_fleet_settings where id = 1;
  at_ := least(coalesce(nullif(p_row->>'at', '')::timestamptz, now()), now());
  f := array[]::numeric[];
  foreach k in array array['fl','fr','rl','rr'] loop
    f := f || case when (p_row->>k) ~ '^[0-9.]+$' and (p_row->>k)::numeric between 0 and 99 then (p_row->>k)::numeric end;
  end loop;
  t := car_tire_active_trip(fs.vin);
  insert into car_tire_readings (at, vin, reservation_id, source, fl, fr, rl, rr, hard_warn, soft_warn)
  values (at_, fs.vin, t.reservation_id, 'stream', f[1], f[2], f[3], f[4], left(p_row->>'hard', 120), left(p_row->>'soft', 120))
  returning id into nid;
  return jsonb_build_object('ok', true, 'id', nid, 'check', car_tire_evaluate(nid));
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. The queue the Turo reader sends from (turo-reader 1.6.0)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.turo_out_claim(p_token text) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare out jsonb;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  update turo_out_msgs set status = 'failed', last_error = 'sender stopped mid-send; check the Turo thread', updated_at = now()
   where status = 'sending' and claimed_at < now() - interval '5 minutes';
  with d as (
    update turo_out_msgs m set status = 'sending', claimed_at = now(), attempts = coalesce(attempts, 0) + 1, updated_at = now()
     where m.id in (select x.id from turo_out_msgs x
                     where x.status = 'queued'
                        or (x.status = 'failed' and coalesce(x.attempts, 0) < 4 and x.updated_at < now() - interval '2 minutes'
                            and coalesce(x.last_error, '') not like 'sender stopped%')
                     order by x.created_at limit 3)
    returning m.id, m.reservation_id, m.kind, m.body, coalesce(m.verify_snippet, '') as snippet)
  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into out from d;
  return out;
end $fn$;

create or replace function public.turo_out_done(p_token text, p_id uuid, p_ok boolean, p_verified boolean default false, p_error text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare m turo_out_msgs;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  update turo_out_msgs set status = case when p_ok then 'sent' else 'failed' end, verified = coalesce(p_verified, false),
         sent_at = case when p_ok then now() else sent_at end, last_error = case when p_ok then null else left(p_error, 300) end,
         updated_at = now()
   where id = p_id returning * into m;
  if m.id is not null and p_ok then
    perform bestly_raise('car.tire.send.' || m.reservation_id, 'resolved', 'info', 'Tire message is in the Turo chat', null, 'turo', null, true);
  end if;
  return jsonb_build_object('ok', m.id is not null);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Trip-start tire check + watchdog (cron car-tire-watch, every 5 minutes)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.car_tire_tick() returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare s car_tire_settings; ps car_protect_settings; fs tesla_fleet_settings; cs car_telemetry_settings; w car_watch; t turo_trips;
  tj jsonb; lo numeric; hi numeric; warn boolean; meas timestamptz; body text; m turo_out_msgs; out jsonb := '{}'::jsonb;
begin
  select * into s from car_tire_settings where id = 1;
  if not coalesce(s.enabled, true) then return jsonb_build_object('off', true); end if;
  select * into ps from car_protect_settings where id = 1;
  select * into fs from tesla_fleet_settings where id = 1;
  select * into w from car_watch where id = 1;

  -- a) Trip-start check: a fresh read in the 40 minutes before pickup, then the numbers go in the Turo chat once the trip starts.
  select * into t from turo_trips
   where (vin = fs.vin or vin is null) and coalesce(status, '') !~* 'cancel'
     and now() between starts_at - interval '40 minutes' and starts_at + interval '3 hours'
   order by starts_at limit 1;
  if s.pickup_check and t.reservation_id is not null
     and not exists (select 1 from turo_out_msgs where reservation_id = t.reservation_id and kind = 'tire_pickup') then
    if coalesce(w.health_at, 'epoch') < t.starts_at - interval '40 minutes' or w.health->'tires' is null then
      if not exists (select 1 from tesla_fleet_commands where action = 'health' and created_at > now() - interval '20 minutes') then
        insert into tesla_fleet_commands (action, auto, reservation_id) values ('health', true, t.reservation_id);
        out := out || jsonb_build_object('pickup', 'reading queued');
      end if;
    elsif now() >= t.starts_at then
      tj := w.health->'tires';
      select min(value::numeric), max(value::numeric) into lo, hi from jsonb_each_text(tj) where value ~ '^[0-9.]+$';
      select bool_or(value::boolean) into warn from jsonb_each_text(coalesce(w.health->'tire_warn', '{}')) where value in ('true','false');
      meas := case when (w.health->>'tpms_at') ~ '^[0-9]+$' then to_timestamp((w.health->>'tpms_at')::bigint) end;
      insert into car_tire_readings (at, vin, reservation_id, source, fl, fr, rl, rr, measured_at, hard_warn)
      values (w.health_at, fs.vin, t.reservation_id, 'pickup', (tj->>'fl')::numeric, (tj->>'fr')::numeric, (tj->>'rl')::numeric,
              (tj->>'rr')::numeric, meas, case when coalesce(warn, false) then 'tire_warn' end);
      if lo is not null and lo >= ps.tire_low_psi and hi - lo <= ps.tire_spread_psi and not coalesce(warn, false) then
        body := 'Trip-start tire check from your Tesla''s own sensors: front left ' || round((tj->>'fl')::numeric) || ', front right '
             || round((tj->>'fr')::numeric) || ', rear left ' || round((tj->>'rl')::numeric) || ', rear right ' || round((tj->>'rr')::numeric)
             || ' psi' || coalesce(', last measured ' || to_char(meas at time zone 'America/Los_Angeles', 'Dy Mon FMDD') || ' at ' || car_tire_pt(meas), '')
             || '. All four are at normal pressure. If the car ever shows a tire warning, please pull over when it''s safe, call Turo Roadside Assistance, 24/7: '
             || s.roadside_phone || ', and message me here before any repair.';
        insert into turo_out_msgs (reservation_id, kind, body, verify_snippet, status)
        values (t.reservation_id, 'tire_pickup', body, 'Trip-start tire check', 'queued') on conflict (reservation_id, kind) do nothing;
        perform car_tire_poke_reader();
        out := out || jsonb_build_object('pickup', 'posted');
      else
        insert into turo_out_msgs (reservation_id, kind, body, status, last_error)
        values (t.reservation_id, 'tire_pickup', '(not sent: tires not in range at pickup)', 'cancelled', 'tires not in range')
        on conflict (reservation_id, kind) do nothing;
        perform bestly_raise('car.tire.pickup.' || t.reservation_id, 'problem', 'error',
          'Tires not right at the start of ' || coalesce(t.guest_first, 'the') || '''s trip',
          'Front ' || coalesce(tj->>'fl', '?') || '/' || coalesce(tj->>'fr', '?') || ', rear ' || coalesce(tj->>'rl', '?') || '/' || coalesce(tj->>'rr', '?')
            || ' psi' || case when coalesce(warn, false) then ', and Tesla shows a tire warning' else '' end
            || '. Turo makes the host pay for a flat if a tire was improperly inflated at the start of the trip, so I did not post the tire check.',
          'turo', 'Get air in the tire (or message the guest) before they drive far.');
        out := out || jsonb_build_object('pickup', 'tires out of range');
      end if;
    end if;
  end if;

  -- b) Watchdog: a tire message that has not reached the Turo chat in 10 minutes.
  for m in select * from turo_out_msgs where kind like 'tire_%' and status in ('queued', 'sending', 'failed')
                                          and created_at < now() - interval '10 minutes' and created_at > now() - interval '2 days' loop
    perform car_tire_poke_reader();
    perform bestly_raise('car.tire.send.' || m.reservation_id, 'problem', case when m.kind = 'tire_hard' then 'error' else 'warning' end,
      'Tire message not in the Turo chat yet', 'The ' || replace(m.kind, 'tire_', '') || ' tire message for reservation ' || m.reservation_id
        || ' has been ' || m.status || ' for ' || round(extract(epoch from now() - m.created_at) / 60) || ' minutes' || coalesce(' (' || m.last_error || ')', '')
        || '. The Turo reader on bestly-pi sends it; it may be signed out of Turo.', 'turo',
      case when m.kind = 'tire_hard' then 'Paste it in the Turo chat yourself: ' || m.body end);
  end loop;

  -- c) Watchdog: the car drove in the last 2 hours but no tire data came in since the config push (the car may not support it).
  select * into cs from car_telemetry_settings where id = 1;
  if cs.enabled and cs.fields ? 'TpmsPressureFl' and cs.last_record_at > now() - interval '2 hours'
     and coalesce(cs.last_push_at, 'epoch') < now() - interval '2 hours'
     and not exists (select 1 from car_tire_readings where source = 'stream' and created_at > now() - interval '12 hours') then
    perform bestly_raise('car.tire.stream', 'problem', 'warning', 'The car is not sending tire pressure',
      'The car streamed its location in the last 2 hours but no tire readings came in. Live tire warnings are off until this is fixed.', 'turo', null);
    out := out || jsonb_build_object('stream', 'silent');
  elsif exists (select 1 from car_tire_readings where source = 'stream' and created_at > now() - interval '12 hours') then
    perform bestly_raise('car.tire.stream', 'resolved', 'info', 'Tire pressure is streaming again', null, 'turo', null, true);
  end if;
  return out;
end $fn$;

select cron.unschedule('car-tire-watch') where exists (select 1 from cron.job where jobname = 'car-tire-watch');
select cron.schedule('car-tire-watch', '*/5 * * * *', 'select public.car_tire_tick()');

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Grants, public-RPC allowlist, owner, team card
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function public.car_tire_evaluate(bigint), public.car_tire_tick(), public.car_tire_poke_reader(),
  public.car_tire_active_trip(text) from public, anon, authenticated;
grant execute on function public.car_tire_ingest(text, jsonb), public.turo_out_claim(text),
  public.turo_out_done(text, uuid, boolean, boolean, text) to anon, authenticated;

insert into public.security_public_rpcs (fn, why)
select x.fn, x.why from (values
  ('car_tire_ingest', 'car-telemetry-fwd on bestly-pi posts tire pressure + Tesla tire warnings with the publishable key; checks the ingest token hash'),
  ('turo_out_claim', 'turo-reader on bestly-pi claims Car Guard Turo-chat messages with the publishable key; checks tesla_worker_ok'),
  ('turo_out_done', 'turo-reader on bestly-pi reports Turo-chat sends with the publishable key; checks tesla_worker_ok')) as x(fn, why)
where not exists (select 1 from public.security_public_rpcs p where p.fn = x.fn);

insert into public.notification_owners (prefix, agent_slug, note)
select 'car.tire', 'car-guard', 'Tire watch: Tesla tire warnings during trips, trip-start tire check, Turo-chat sends (2026-10-29)'
where not exists (select 1 from public.notification_owners where prefix = 'car.tire');

update public.bestly_agents
   set pulse = jsonb_set(pulse, '{also}', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
                 from jsonb_array_elements_text(coalesce(pulse->'also', '[]'::jsonb) || '["car-tire-watch"]'::jsonb) x)),
       updated_at = now()
 where slug = 'car-guard';
