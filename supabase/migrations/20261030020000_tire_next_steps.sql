-- Car Guard tire watch, part 2 (2026-10-29, Jared): help with the next steps, not just the warning. On Craig's trip Turo Roadside
-- asked "if you know a place to get a tire it can get towed there" and nobody had an answer ready; Turo's flat tire policy says a
-- car that can't be fixed on the spot is towed to a garage the HOST chooses, and a replacement tire needs the host's OK.
-- Now the edge function tire-next-steps finds tire shops near the car (TomTom Search when the key allows it, else OpenStreetMap)
-- and the nearest Tesla Service, posts one "where to tow" message in the Turo chat (turo_out_msgs 'tire_next') and sends Jared the
-- same list. It runs on a Tesla hard tire warning (car_tire_evaluate) and when a guest writes about a flat or a tire in the Turo
-- chat during a trip (turo_inbox trigger), whichever comes first; once per trip.
-- Follow-up to 20261030013000_car_tire_watch.sql and 20261030014500_car_tire_watch_fix.sql.

alter table public.car_tire_settings
  add column if not exists tire_size text default '235/45R18',
  add column if not exists tesla_fallback text default 'Tesla Service, 11163 Santa Monica Blvd, Los Angeles, CA 90025';

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
      if v_kind = 'tire_hard' then   -- next steps: where to tow, tire size, approval rule (tire-next-steps)
        perform invoke_edge_function('tire-next-steps', jsonb_build_object('reservation_id', t.reservation_id, 'reason', 'Tesla hard tire warning'), 120000);
      end if;
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

-- What the edge function needs (service role only).
create or replace function public.car_tire_next_context(p_res bigint) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare t turo_trips; v turo_vehicle_state; s car_tire_settings; fs tesla_fleet_settings;
begin
  select * into t from turo_trips where reservation_id = p_res;
  if t.reservation_id is null then return jsonb_build_object('ok', false, 'error', 'no such trip'); end if;
  select * into fs from tesla_fleet_settings where id = 1;
  select * into v from turo_vehicle_state where vin = coalesce(t.vin, fs.vin);
  select * into s from car_tire_settings where id = 1;
  return jsonb_build_object('ok', true, 'lat', v.latitude, 'lon', v.longitude, 'at', v.observed_at, 'guest', t.guest_first,
    'already', exists (select 1 from turo_out_msgs where reservation_id = p_res and kind = 'tire_next'),
    'hard_sent', exists (select 1 from turo_out_msgs where reservation_id = p_res and kind = 'tire_hard'),
    'tire_size', s.tire_size, 'tesla_fallback', s.tesla_fallback, 'roadside', s.roadside_phone);
end $fn$;

-- Queue the message (or replace it on a forced refresh that has not gone out yet) and tell Jared.
create or replace function public.car_tire_next_put(p_res bigint, p_body text, p_force boolean default false, p_detail jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare id_ uuid; t turo_trips; shops text;
begin
  select * into t from turo_trips where reservation_id = p_res;
  insert into turo_out_msgs (reservation_id, kind, body, verify_snippet, status)
  values (p_res, 'tire_next', p_body, 'Next steps if Turo Roadside', 'queued')
  on conflict (reservation_id, kind) do update set body = excluded.body, status = 'queued', attempts = 0, last_error = null, updated_at = now()
    where p_force and turo_out_msgs.status in ('queued', 'failed', 'cancelled')
  returning id into id_;
  if id_ is null then return jsonb_build_object('ok', true, 'skip', 'already sent'); end if;
  perform car_tire_poke_reader();
  select string_agg(coalesce(x->>'name', '?') || coalesce(' (' || (x->>'mi') || ' mi' || coalesce(', ' || (x->>'phone'), '') || ')', ''), '; ')
    into shops from jsonb_array_elements(coalesce(p_detail->'shops', '[]'::jsonb)) x;
  perform bestly_raise('car.tire.next.' || p_res, 'problem', 'warning', 'Tow plan sent to ' || coalesce(t.guest_first, 'the guest'),
    'In the Turo chat I gave ' || coalesce(t.guest_first, 'the guest') || ' where to tow the car if Turo Roadside can''t fix the tire on the spot: '
      || coalesce(shops, 'no shops found near the car, so I asked them to message you first') || '. '
      || coalesce('Wheel or suspension damage: ' || (p_detail->'tesla'->>'name') || '. ', '')
      || 'Found with ' || coalesce(p_detail->>'src', '?') || '. Any new tire needs your OK first (brand and price in the chat).', 'turo',
    'If the car should go somewhere else, message ' || coalesce(t.guest_first, 'the guest') || ' in the Turo chat now.');
  return jsonb_build_object('ok', true, 'id', id_);
end $fn$;

-- A guest writing about a flat or a tire during a trip starts the same next steps (wins if the car's warning never came).
create or replace function public.car_tire_inbox_trg() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
begin
  begin
    if new.role = 'GUEST' and coalesce(new.body, '') ~* '(\m(flat|tires?|tyres?|blow ?out|blew out|rim)\M|pull over)'
       and coalesce(new.sent_at, now()) > now() - interval '2 hours'
       and coalesce((select enabled from car_tire_settings where id = 1), true)
       and exists (select 1 from turo_trips where reservation_id = new.reservation_id
                    and now() between starts_at and ends_at + interval '30 minutes' and coalesce(status, '') !~* 'cancel')
       and not exists (select 1 from turo_out_msgs where reservation_id = new.reservation_id and kind = 'tire_next') then
      perform invoke_edge_function('tire-next-steps', jsonb_build_object('reservation_id', new.reservation_id, 'reason', 'guest wrote: ' || left(new.body, 120)), 120000);
    end if;
  exception when others then
    perform bestly_raise('car.tire.inbox', 'problem', 'warning', 'Tire next steps did not start from the Turo chat', sqlerrm, 'turo', null);
  end;
  return new;
end $fn$;
drop trigger if exists car_tire_inbox on public.turo_inbox;
create trigger car_tire_inbox after insert on public.turo_inbox for each row execute function public.car_tire_inbox_trg();

revoke all on function public.car_tire_next_context(bigint), public.car_tire_next_put(bigint, text, boolean, jsonb),
  public.car_tire_inbox_trg(), public.car_tire_evaluate(bigint) from public, anon, authenticated;
grant execute on function public.car_tire_next_context(bigint), public.car_tire_next_put(bigint, text, boolean, jsonb) to service_role;

-- Craig's trip (62784054) was handled by hand on Oct 29 (towed to Pacific Coast Tires): mark the tire messages as done so a new
-- message from him or a late car warning doesn't send him a tow plan now.
insert into public.turo_out_msgs (reservation_id, kind, body, status, last_error)
select 62784054, k, '(handled by Jared in the Turo chat on Oct 29)', 'cancelled', 'handled by hand' from unnest(array['tire_hard','tire_soft','tire_next']) k
on conflict (reservation_id, kind) do nothing;
