-- Car Guard tire watch, fix 1 (2026-10-29): in car_tire_evaluate and car_tire_tick the PL/pgSQL variables 'kind' and 'body'
-- had the same names as turo_out_msgs columns ("column reference kind is ambiguous"); found by the rolled-back dry run before
-- any real reading arrived. Renamed to v_kind / v_body. Follow-up to 20261030013000_car_tire_watch.sql.

create or replace function public.car_tire_evaluate(p_id bigint) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare r car_tire_readings; s car_tire_settings; ps car_protect_settings; t turo_trips; tj jsonb; lo numeric; hi numeric;
  hard boolean; soft boolean; tire text; psi numeric; who text; v_body text; msg_id uuid; v_kind text; c uuid; line text;
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
    v_kind := 'tire_hard';
    v_body := 'Important: your Tesla just reported very low pressure in ' || coalesce('the ' || car_tire_name(tire) || ' tire', 'a tire')
         || coalesce(' (' || round(psi) || ' psi at ' || car_tire_pt(r.at) || ')', ' (' || car_tire_pt(r.at) || ')')
         || '. When the car shows "PULL OVER SAFELY - Check for flat tire," please pull over when it''s safe and don''t keep driving on it, since that can destroy the tire and wheel. '
         || 'Call Turo Roadside Assistance, 24/7: ' || s.roadside_phone || '. '
         || 'Per Turo''s flat tire policy, please message me here before any repair or tire replacement, and keep all receipts.';
  elsif soft and not exists (select 1 from turo_out_msgs where reservation_id = t.reservation_id and kind = 'tire_hard') then
    v_kind := 'tire_soft';
    v_body := 'Heads up: your Tesla is showing low pressure in ' || coalesce('the ' || car_tire_name(tire) || ' tire', 'a tire')
         || coalesce(' (' || round(psi) || ' psi at ' || car_tire_pt(r.at) || ')', ' (' || car_tire_pt(r.at) || ')')
         || '. Please don''t keep driving on a low tire. If the warning stays on, pull over when it''s safe and call Turo Roadside Assistance, 24/7: '
         || s.roadside_phone || '. Per Turo''s flat tire policy, please message me here before any repair or tire replacement, and keep all receipts.';
  end if;

  if v_kind is not null then
    insert into turo_out_msgs (reservation_id, kind, body, verify_snippet, status)
    values (t.reservation_id, v_kind, v_body, 'Turo Roadside Assistance, 24/7', 'queued')
    on conflict (reservation_id, kind) do nothing
    returning id into msg_id;
    if msg_id is not null then
      perform car_tire_poke_reader();
      perform bestly_raise('car.tire.' || v_kind || '.' || t.reservation_id, 'problem', case when hard then 'error' else 'warning' end,
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
  return jsonb_build_object('trip', t.reservation_id, 'hard', hard, 'soft', soft, 'sent', v_kind, 'msg', msg_id);
end $fn$;

create or replace function public.car_tire_tick() returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare s car_tire_settings; ps car_protect_settings; fs tesla_fleet_settings; cs car_telemetry_settings; w car_watch; t turo_trips;
  tj jsonb; lo numeric; hi numeric; warn boolean; meas timestamptz; v_body text; m turo_out_msgs; out jsonb := '{}'::jsonb;
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
        v_body := 'Trip-start tire check from your Tesla''s own sensors: front left ' || round((tj->>'fl')::numeric) || ', front right '
             || round((tj->>'fr')::numeric) || ', rear left ' || round((tj->>'rl')::numeric) || ', rear right ' || round((tj->>'rr')::numeric)
             || ' psi' || coalesce(', last measured ' || to_char(meas at time zone 'America/Los_Angeles', 'Dy Mon FMDD') || ' at ' || car_tire_pt(meas), '')
             || '. All four are at normal pressure. If the car ever shows a tire warning, please pull over when it''s safe, call Turo Roadside Assistance, 24/7: '
             || s.roadside_phone || ', and message me here before any repair.';
        insert into turo_out_msgs (reservation_id, kind, body, verify_snippet, status)
        values (t.reservation_id, 'tire_pickup', v_body, 'Trip-start tire check', 'queued') on conflict (reservation_id, kind) do nothing;
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

revoke all on function public.car_tire_evaluate(bigint), public.car_tire_tick() from public, anon, authenticated;
