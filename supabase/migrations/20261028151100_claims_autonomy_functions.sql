-- Claims Closer autonomy build, part 2 of 2: functions. NOT APPLIED (branch claims-closer-autonomy-2026-10-28). Needs part 1 first.
-- Replaces five live functions (the exact originals are in supabase/undo/claims-closer-autonomy-2026-10-28.undo.sql):
--   claims_tick, claims_gate_sweep (unchanged here, kept in the undo for reference), claims_mail_seen, claims_watch, claims_turo_claim.
-- Everything else is new. No cron is created or changed: claims-closer-tick (every 2 min), claims-watch (10 min) and claims-guard-watch (5 min) already exist.

-- ================================================================================================================ small helpers
create or replace function public.claims_haversine_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)))
$$;

-- 12-hour Pacific text for anything a person reads, e.g. "Mon Oct 26 at 9:20 AM"
create or replace function public.claims_pt(p timestamptz) returns text language sql immutable as $$
  select to_char(p at time zone 'America/Los_Angeles', 'FMDy FMMon FMDD "at" FMHH12:MI AM')
$$;

-- The return gate with the watchdog hold left out of the answer. Same rule as claims_gate (reservation ended AND Complete trip tapped
-- or a compliant message already went out), nothing else. Used only to decide whether a "message reached the guest during the live trip" hold can clear.
create or replace function public.claims_gate_ignoring_hold(p_case uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare c claim_cases; te timestamptz; hc timestamptz; v_ended boolean; v_comp boolean; v_done boolean;
begin
  select * into c from claim_cases where id = p_case;
  if c.id is null then return jsonb_build_object('ok', false, 'reason', 'no case'); end if;
  te := greatest((select t.ends_at from turo_trips t where t.reservation_id = c.reservation_id), c.trip_end);
  select g.host_completed_at into hc from lax_guest_links g where g.reservation_id = c.reservation_id;
  v_ended := te is not null and now() >= te;
  v_comp := hc is not null;
  v_done := v_comp or (te is not null and exists (select 1 from claim_drafts d where d.case_id = c.id and d.status = 'sent' and d.kind <> 'escalation' and d.sent_at >= te));
  return jsonb_build_object('ok', v_ended and v_done, 'ended', v_ended, 'completed', v_comp, 'first_done', v_done, 'trip_end', te, 'completed_at', hc);
end $$;

-- ================================================================================================================ item 6: holds that clear themselves
-- Only the hold whose reason is exactly "a message reached the guest while the trip was still live" clears on its own, and only once the
-- reservation has ended and Complete trip is done. Dollar-figure, Turo-voice, review and "first message before Complete trip" holds stay held.
create or replace function public.claims_hold_autorelease()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record; g jsonb; v_n int := 0; v_still int := 0; s claims_autonomy_settings;
begin
  select * into s from claims_autonomy_settings where id;
  if not coalesce(s.hold_autorelease, true) then return jsonb_build_object('released', 0, 'off', true); end if;
  for r in select * from claim_cases
            where coalesce(outbound_hold, false) and status not in ('paid', 'closed') and not coalesce(history, false)
              and outbound_hold_reason = 'a message reached the guest while the trip was still live' loop
    g := claims_gate_ignoring_hold(r.id);
    if coalesce((g ->> 'ok')::boolean, false) then
      update claim_cases set outbound_hold = false, outbound_hold_reason = null, needs_work = true, work_reason = 'hold released: the trip is over and complete', updated_at = now() where id = r.id;
      insert into claim_events (case_id, reservation_id, kind, title, detail)
        values (r.id, r.reservation_id, 'note', 'Outbound hold released automatically: the trip is over and Complete trip is done',
                jsonb_build_object('auto', true, 'progress', true, 'was', r.outbound_hold_reason, 'held_at', r.outbound_hold_at));
      perform claims_notify('Released the hold on ' || coalesce(r.guest_first, 'the guest') || '''s messages',
        'The hold was for a message that reached the guest while the trip was live. The trip is over and complete now, so I cleared it.',
        'success', 'claims-hold-auto-' || r.id || '-' || coalesce(extract(epoch from r.outbound_hold_at)::bigint::text, '0'));
      v_n := v_n + 1;
    end if;
  end loop;
  -- every other hold (dollar figure, Turo voice, reviews, first message before Complete trip) stays held. It was reported when it was set; 24 hours on, remind Jared once
  -- why it is still held, so a hold can never sit unseen.
  for r in select * from claim_cases
            where coalesce(outbound_hold, false) and status not in ('paid', 'closed') and not coalesce(history, false)
              and coalesce(outbound_hold_reason, '') <> 'a message reached the guest while the trip was still live'
              and outbound_hold_at < now() - interval '24 hours' loop
    perform claims_notify(coalesce(r.guest_first, 'A') || '''s messages are still on hold',
      'Held since ' || claims_pt(r.outbound_hold_at) || ': ' || coalesce(r.outbound_hold_reason, 'no reason recorded') || '. I do not clear this kind of hold on my own. Review it on the Claims page and clear it if it is fine.',
      'warning', 'claims-hold-still-' || r.id || '-' || coalesce(extract(epoch from r.outbound_hold_at)::bigint::text, '0'));
    v_still := v_still + 1;
  end loop;
  return jsonb_build_object('released', v_n, 'still_held', v_still);
end $$;

-- ================================================================================================================ item 8: auto Complete trip
-- Where is the car right now? Reads turo_vehicle_state (Tesla Fleet / TezLab mirror) and car_drives. Anything unreadable is "unknown".
create or replace function public.claims_car_parked_where(p_vin text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare s claims_autonomy_settings; v turo_vehicle_state; v_dh double precision; v_dl double precision; v_where text; v_tel_at timestamptz; v_driving boolean := false; v_gear text; v_speed numeric;
begin
  select * into s from claims_autonomy_settings where id;
  select * into v from turo_vehicle_state where vin = p_vin;
  if v.vin is null then return jsonb_build_object('known', false, 'reason', 'no car reading'); end if;
  if v.observed_at is null or v.observed_at < now() - make_interval(mins => coalesce(s.auto_complete_fresh_min, 30)) then
    return jsonb_build_object('known', false, 'reason', 'car reading is stale', 'observed_at', v.observed_at);
  end if;
  if v.latitude is null or v.longitude is null then return jsonb_build_object('known', false, 'reason', 'car location unreadable', 'observed_at', v.observed_at); end if;
  -- driving: an open drive, or telemetry from the last 10 minutes that says not parked / moving
  if exists (select 1 from car_drives d where d.vin = p_vin and d.ended_at is null and d.started_at > now() - interval '12 hours') then v_driving := true; end if;
  begin
    v_tel_at := (v.raw -> 'telemetry' ->> 'at')::timestamptz;
    v_gear := v.raw -> 'telemetry' ->> 'gear';
    v_speed := (v.raw -> 'telemetry' ->> 'speed_mph')::numeric;
    if v_tel_at is not null and v_tel_at >= v.observed_at - interval '10 minutes' and (coalesce(v_gear, 'P') <> 'P' or coalesce(v_speed, 0) > 0) then v_driving := true; end if;
  exception when others then null; end;
  v_dh := claims_haversine_m(v.latitude, v.longitude, s.home_lat, s.home_lng);
  v_dl := claims_haversine_m(v.latitude, v.longitude, s.lax_lat, s.lax_lng);
  v_where := case when v_dh <= s.home_radius_m then 'home' when v_dl <= s.lax_radius_m then 'lax' else 'elsewhere' end;
  return jsonb_build_object('known', true, 'parked', not v_driving, 'driving', v_driving, 'where', v_where, 'dist_home_m', round(v_dh::numeric), 'dist_lax_m', round(v_dl::numeric),
    'charging_state', v.charging_state, 'observed_at', v.observed_at, 'lat', v.latitude, 'lng', v.longitude, 'car', v.display_name,
    'place', (select p.label from car_place p where p.vin = p_vin));
end $$;

-- Taps Complete trip for a trip that has a Claims Closer case, through the same update host_trip_complete makes (returned_at, settled_at,
-- host_completed_at), and records source = 'auto' plus the evidence. Rule: the Turo reservation has ended (turo_trips.ends_at, never earlier, even if the
-- guest returned early) AND the car is parked (not driving) at home (733 N Kings Rd) or the LAX Park My Share garage AND the reading is fresh.
-- Anything it cannot read means it does nothing; the 24-hour reminder to Jared stays as the fallback. p_dry = true only reports.
create or replace function public.claims_auto_complete_trips(p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s claims_autonomy_settings; r record; car jsonb; te timestamptz; v_vin text; v_out jsonb := '[]'::jsonb; v_ev jsonb; v_n int; v_reason text; v_done int := 0;
begin
  select * into s from claims_autonomy_settings where id;
  if not coalesce(s.auto_complete, false) then return jsonb_build_object('off', true, 'completed', 0, 'checked', '[]'::jsonb); end if;
  for r in select c.id case_id, c.reservation_id, c.guest_first, c.vin cvin, c.trip_end, t.ends_at, t.vin tvin, t.status tstatus, l.token, l.host_completed_at
             from claim_cases c join turo_trips t on t.reservation_id = c.reservation_id
             left join lax_guest_links l on l.reservation_id = c.reservation_id
            where c.status not in ('paid', 'closed') and not coalesce(c.history, false) loop
    if r.host_completed_at is not null then continue; end if;
    te := greatest(r.ends_at, r.trip_end);
    v_vin := coalesce(r.tvin, r.cvin);
    v_reason := null; car := null;
    if r.ends_at is null or te is null or now() < te then v_reason := 'reservation has not ended';
    elsif coalesce(r.tstatus, '') ~* 'cancel' then v_reason := 'trip was cancelled';
    elsif r.token is null then v_reason := 'no trip page to complete';
    elsif v_vin is null then v_reason := 'no car on the trip';
    elsif exists (select 1 from turo_trips o where o.vin = v_vin and o.reservation_id <> r.reservation_id and coalesce(o.status, '') !~* 'cancel' and o.starts_at <= now() and o.ends_at > now()) then
      v_reason := 'the car is on another trip right now';
    else
      car := claims_car_parked_where(v_vin);
      if not coalesce((car ->> 'known')::boolean, false) then v_reason := 'car location unknown: ' || coalesce(car ->> 'reason', 'unreadable');
      elsif not coalesce((car ->> 'parked')::boolean, false) then v_reason := 'car is driving';
      elsif (car ->> 'where') not in ('home', 'lax') then v_reason := 'car is parked somewhere else';
      end if;
    end if;
    if v_reason is not null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('reservation_id', r.reservation_id, 'guest', r.guest_first, 'decision', 'wait', 'reason', v_reason));
      continue;
    end if;
    v_ev := jsonb_build_object('source', 'auto', 'rule', 'reservation ended and the car is parked at home or the LAX garage', 'reservation_ended_at', te,
      'checked_at', now(), 'car', car);
    if not p_dry then
      update lax_guest_links set returned_at = coalesce(returned_at, now()), settled_at = coalesce(settled_at, now()), host_completed_at = coalesce(host_completed_at, now()),
        host_completed_source = 'auto', host_completed_evidence = v_ev
       where reservation_id = r.reservation_id and host_completed_at is null;
      get diagnostics v_n = row_count;
      if v_n > 0 then
        insert into claim_trip_complete_log (reservation_id, case_id, source, evidence) values (r.reservation_id, r.case_id, 'auto', v_ev);
        insert into claim_events (case_id, reservation_id, kind, title, detail)
          values (r.case_id, r.reservation_id, 'state', 'Marked the trip complete automatically: ' || coalesce(car ->> 'car', 'the car') || ' is parked at ' || case car ->> 'where' when 'home' then 'home' else 'the LAX garage' end,
                  jsonb_build_object('auto', true, 'progress', true, 'evidence', v_ev));
        update claim_cases set needs_work = true, work_reason = 'trip complete (automatic)', updated_at = now() where id = r.case_id;
        perform claims_notify('Marked ' || coalesce(r.guest_first, 'the guest') || '''s trip complete',
          'The reservation ended ' || claims_pt(te) || ' and ' || coalesce(car ->> 'car', 'the car') || ' is parked at ' || case car ->> 'where' when 'home' then 'home' else 'the LAX garage' end
          || ', so I tapped Complete trip for you. Messages on this claim can go out now.', 'success', 'claims-autocomplete-' || r.reservation_id);
        v_done := v_done + 1;
      end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('reservation_id', r.reservation_id, 'guest', r.guest_first, 'decision', case when p_dry then 'would_complete' else 'completed' end, 'evidence', v_ev));
  end loop;
  return jsonb_build_object('completed', v_done, 'checked', v_out);
end $$;

-- ================================================================================================================ item 7: stuck alert
create or replace function public.claims_waiting_on(p_case uuid)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare c claim_cases; g jsonb;
begin
  select * into c from claim_cases where id = p_case;
  if c.id is null then return 'nothing'; end if;
  g := claims_gate(p_case);
  if coalesce(c.outbound_hold, false) then return 'a hold on outbound messages (' || coalesce(c.outbound_hold_reason, 'no reason recorded') || ')'; end if;
  if coalesce((g ->> 'live')::boolean, false) then return 'the trip to end'; end if;
  if not coalesce((g ->> 'first_done')::boolean, false) then return 'Complete trip to be tapped'; end if;
  if c.path = 'turo_claim' and c.turo_incident_id is null then return 'the Turo claim link (the incident id is missing, so nothing syncs)'; end if;
  if c.estimate_amount is null then return 'a repair estimate'; end if;
  if c.repair_booking ->> 'state' in ('requested', 'calling') then return 'the repair booking'; end if;
  if exists (select 1 from claim_insurer_track t where t.case_id = c.id and t.state in ('claim_opening', 'claim_open', 'estimate_sent', 'awaiting_payment', 'stalled')) then return 'the guest''s insurer'; end if;
  if c.status in ('open', 'waiting_guest') then return 'the guest to reply'; end if;
  return 'payment';
end $$;

create or replace function public.claims_stuck_alert()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s claims_autonomy_settings; r record; v_n int := 0; v_hours numeric;
begin
  select * into s from claims_autonomy_settings where id;
  for r in select * from claim_cases
            where status not in ('paid', 'closed') and not coalesce(history, false)
              and coalesce(last_progress_at, opened_at) < now() - make_interval(hours => coalesce(s.stuck_hours, 48))
              and (stuck_alert_at is null or stuck_alert_at < now() - make_interval(hours => coalesce(s.stuck_hours, 48))) loop
    v_hours := round(extract(epoch from (now() - coalesce(r.last_progress_at, r.opened_at))) / 3600);
    perform claims_notify(coalesce(r.guest_first, 'A') || '''s claim has not moved in ' || v_hours || ' hours',
      'No new estimate, sent message, Turo change or state change since ' || claims_pt(coalesce(r.last_progress_at, r.opened_at)) || '. Waiting on ' || claims_waiting_on(r.id) || '.',
      'warning', 'claims-stuck-' || r.id || '-' || floor(extract(epoch from now()) / 3600)::bigint);
    update claim_cases set stuck_alert_at = now() where id = r.id;
    insert into claim_events (case_id, reservation_id, kind, title, detail) values (r.id, r.reservation_id, 'note', 'Stuck alert sent to Jared', jsonb_build_object('hours', v_hours, 'waiting_on', claims_waiting_on(r.id)));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('alerted', v_n);
end $$;

-- ================================================================================================================ item 1: the nudge ladder
-- A decision question still open after 24 h gets one nudge (signed Claims Closer); after 48 h it goes to Scout, who can answer it with claims_answer.
create or replace function public.claims_question_sweep()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s claims_autonomy_settings; r record; v_nudged int := 0; v_scout int := 0; v_retired int := 0; v_ref timestamptz; v_stale text;
begin
  select * into s from claims_autonomy_settings where id;
  -- retire what went stale: a question older than 7 days whose world moved on (case closed, estimate already in, shop thread closed, Turo's resolve-directly window closed)
  for r in select q.*, c.status cstatus, c.estimate_amount, c.chosen_estimate_id, c.escalate_by, c.path, c.reservation_id res,
                  (select e.status from claim_estimates e where e.id::text = q.meta ->> 'estimate_id') est_status,
                  exists (select 1 from claim_windows w where w.case_id = q.case_id and w.kind = 'resolve_directly' and w.status in ('lapsed', 'moot')) win_closed
             from claim_questions q join claim_cases c on c.id = q.case_id
            where q.handled_at is null and q.retired_at is null and q.kind = 'decision' and q.answered_at is null loop
    v_stale := case
      when r.cstatus in ('paid', 'closed') then 'the case is closed'
      when r.asked_at > now() - interval '7 days' then null
      when (r.key ~ '^(shop-asks-|estimate-)') and (r.estimate_amount is not null or r.chosen_estimate_id is not null) then 'the estimate is already in'
      when r.key ~ '^shop-asks-' and r.est_status is not null and r.est_status not in ('requested', 'replied', 'needs_visit') then 'that shop''s thread is already closed'
      when (r.key ~ '^(shop-asks-|estimate-)') and (r.win_closed or (r.path = 'resolve_directly' and r.escalate_by is not null and r.escalate_by < now())) then 'Turo''s resolve-directly window has closed'
      else null end;
    if v_stale is not null then
      update claim_questions set retired_at = now(), retired_reason = 'asked ' || to_char(r.asked_at at time zone 'America/Los_Angeles', 'FMMon FMDD') || ' and ' || v_stale, handled_at = now() where id = r.id;
      insert into claim_events (case_id, reservation_id, kind, title, detail) values (r.case_id, r.res, 'question', 'Retired an old question (' || v_stale || '); no action taken', jsonb_build_object('question_id', r.id));
      v_retired := v_retired + 1;
    end if;
  end loop;

  -- the nudge ladder: one nudge after 24 h (signed Claims Closer), Scout after 48 h
  for r in select q.*, c.guest_first, c.reservation_id res from claim_questions q join claim_cases c on c.id = q.case_id
            where q.answered_at is null and q.handled_at is null and q.retired_at is null and q.kind = 'decision' and c.status not in ('paid', 'closed') loop
    v_ref := greatest(r.asked_at, coalesce(r.snoozed_until, r.asked_at));
    if r.nudged_at is null and v_ref <= now() - make_interval(hours => coalesce(s.nudge_hours, 24)) then
      perform claims_notify('Still need your answer on ' || coalesce(r.guest_first, 'a') || '''s claim', left(r.question, 220) || ' Asked ' || claims_pt(v_ref) || '.', 'warning', 'claims-nudge-' || r.id);
      update claim_questions set nudged_at = now() where id = r.id;
      insert into claim_events (case_id, reservation_id, kind, title, detail) values (r.case_id, r.res, 'question', 'Nudged Jared once: ' || left(r.question, 120), jsonb_build_object('question_id', r.id));
      v_nudged := v_nudged + 1;
    end if;
    if r.scout_at is null and v_ref <= now() - make_interval(hours => coalesce(s.scout_hours, 48)) then
      perform scout_notify('Claims Closer needs a decision on ' || coalesce(r.guest_first, 'a') || '''s claim',
        'Claims Closer asked Jared ' || claims_pt(v_ref) || ' and has no answer after ' || coalesce(s.scout_hours, 48) || ' hours: ' || left(r.question, 300)
        || ' Answer it with claims_answer on question ' || r.id || ' (use a button value; free text is a note to Claims Closer and is never sent to anyone).', 'warning', true, 'https://bestly.tech/admin/claims', 'claims-scout-q-' || r.id);
      update claim_questions set scout_at = now() where id = r.id;
      insert into claim_events (case_id, reservation_id, kind, title, detail) values (r.case_id, r.res, 'question', 'Passed to Scout: ' || left(r.question, 120), jsonb_build_object('question_id', r.id));
      v_scout := v_scout + 1;
    end if;
  end loop;
  return jsonb_build_object('nudged', v_nudged, 'to_scout', v_scout, 'retired', v_retired);
end $$;

-- ================================================================================================================ item 10: reminders (day before + 2 hours before, 12-hour Pacific)
create or replace function public.claims_booking_reminders()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record; v_drop timestamptz; v_shop text; v_n int := 0;
begin
  for r in select c.id, c.guest_first, c.repair_booking rb, s.name shop from claim_cases c left join claim_shops s on s.id = c.chosen_shop_id
            where c.repair_booking ->> 'state' in ('booked', 'manual') and c.repair_booking ->> 'dropoff_at' is not null and c.status not in ('paid', 'closed') loop
    v_drop := (r.rb ->> 'dropoff_at')::timestamptz; v_shop := coalesce(r.shop, 'the shop');
    if v_drop <= now() then continue; end if;
    if v_drop <= now() + interval '2 hours' then
      if not coalesce((r.rb ->> 'reminded_2h')::boolean, false) then
        perform claims_notify('Repair drop-off in 2 hours', 'Take the Tesla to ' || v_shop || ' by ' || to_char(v_drop at time zone 'America/Los_Angeles', 'FMHH12:MI AM') || '. The estimate is already with them.', 'warning', 'claims-rem-2h-' || r.id);
        update claim_cases set repair_booking = repair_booking || '{"reminded_2h": true, "reminded_day_before": true}'::jsonb where id = r.id; v_n := v_n + 1;
      end if;
    elsif v_drop <= now() + interval '24 hours' then
      if not coalesce((r.rb ->> 'reminded_day_before')::boolean, false) then
        perform claims_notify('Drop the Tesla at ' || v_shop || ' tomorrow', 'Drop-off is ' || claims_pt(v_drop) || ' at ' || v_shop || '. Nothing else to do before then.', 'warning', 'claims-rem-day-' || r.id);
        update claim_cases set repair_booking = repair_booking || '{"reminded_day_before": true}'::jsonb where id = r.id; v_n := v_n + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('reminders', v_n);
end $$;

-- ================================================================================================================ items 2 and 5: windows and Turo links
create or replace function public.claims_link_turo_ids(p_case uuid, p_claim_no text, p_incident bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c claim_cases; v_set text[] := '{}';
begin
  select * into c from claim_cases where id = p_case for update;
  if c.id is null then return jsonb_build_object('ok', false); end if;
  if p_claim_no is not null and p_claim_no ~ '^\d{5,9}$' then
    if c.turo_claim_no is null then update claim_cases set turo_claim_no = p_claim_no where id = p_case; v_set := array_append(v_set, 'claim_no');
    elsif c.turo_claim_no <> p_claim_no then insert into claim_events (case_id, reservation_id, kind, title, detail) values (p_case, c.reservation_id, 'note', 'Turo mail shows a different claim number; kept the one on file', jsonb_build_object('on_file', c.turo_claim_no, 'mail', p_claim_no)); end if;
  end if;
  if p_incident is not null and p_incident > 0 then
    if c.turo_incident_id is null then update claim_cases set turo_incident_id = p_incident where id = p_case; v_set := array_append(v_set, 'incident_id');
    elsif c.turo_incident_id <> p_incident then insert into claim_events (case_id, reservation_id, kind, title, detail) values (p_case, c.reservation_id, 'note', 'Turo mail shows a different incident id; kept the one on file', jsonb_build_object('on_file', c.turo_incident_id, 'mail', p_incident)); end if;
  end if;
  if cardinality(v_set) > 0 then
    update claim_cases set needs_work = true, work_reason = 'linked to Turo claim', updated_at = now() where id = p_case;
    insert into claim_events (case_id, reservation_id, kind, title, detail) values (p_case, c.reservation_id, 'turo', 'Linked this case to the Turo claim (' || array_to_string(v_set, ', ') || ')',
      jsonb_build_object('claim_no', p_claim_no, 'incident_id', p_incident, 'progress', true));
    update turo_reader_state set poke_at = now() where id = 1;
  end if;
  return jsonb_build_object('ok', true, 'set', v_set);
end $$;

create or replace function public.claims_set_windows(p_case uuid, p_windows jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare w jsonb; v_n int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  for w in select * from jsonb_array_elements(coalesce(p_windows, '[]'::jsonb)) loop
    insert into claim_windows (case_id, kind, due_at, source, note, status)
      values (p_case, w ->> 'kind', (w ->> 'due_at')::timestamptz, coalesce(w ->> 'source', 'rule'), w ->> 'note', coalesce(w ->> 'status', 'open'))
    on conflict (case_id, kind) do update set
      due_at = excluded.due_at, source = excluded.source, note = coalesce(excluded.note, claim_windows.note),
      status = case when claim_windows.status in ('met', 'moot') then claim_windows.status when excluded.status <> 'open' then excluded.status
                    when abs(extract(epoch from (excluded.due_at - claim_windows.due_at))) > 3600 then 'open' else claim_windows.status end,
      updated_at = now();
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'windows', v_n);
end $$;

-- wake a case whose Turo window is close so the engine in claims-closer acts ahead of it (the engine stamps acted_at; this re-wakes at most every 6 h)
create or replace function public.claims_windows_due()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s claims_autonomy_settings; r record; v_n int := 0;
begin
  select * into s from claims_autonomy_settings where id;
  for r in select distinct w.case_id from claim_windows w join claim_cases c on c.id = w.case_id
            where w.status = 'open' and c.status not in ('paid', 'closed') and not coalesce(c.history, false)
              and w.due_at <= now() + make_interval(hours => coalesce(s.deadline_lead_hours, 72))
              and (w.acted_at is null or w.acted_at < now() - interval '6 hours') loop
    update claim_cases set needs_work = true, work_reason = 'a Turo deadline is close', updated_at = now() where id = r.case_id and not needs_work;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('woke', v_n);
end $$;

-- ================================================================================================================ item 11: money in
-- Called with the service key by the edge function (Mercury read) or by Hermes' matcher below. Records the payment once, adds it to the case,
-- and closes the case when everything owed is in. Alerts only when a decision is needed.
create or replace function public.claims_payment_seen(p_source text, p_amount numeric, p_ref text, p_at timestamptz default now(), p_evidence jsonb default '{}'::jsonb, p_case uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; c claim_cases; v_target numeric; v_rec numeric; v_closed boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') and not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'error', 'bad amount'); end if;
  insert into claim_payments (case_id, source, amount, received_at, reference, evidence, matched) values (p_case, p_source, p_amount, coalesce(p_at, now()), p_ref, coalesce(p_evidence, '{}'::jsonb), p_case is not null)
    on conflict (source, reference) do nothing returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if p_case is null then return jsonb_build_object('ok', true, 'matched', false, 'id', v_id); end if;
  select * into c from claim_cases where id = p_case for update;
  v_rec := coalesce(c.recovered_amount, 0) + p_amount;
  -- what the case should bring in: on a Turo-managed claim the repair cost minus Jared's damage responsibility, otherwise the whole estimate
  v_target := case when c.estimate_amount is null then null when c.path = 'turo_claim' then greatest(c.estimate_amount - coalesce(c.host_responsibility, 0), 0) else c.estimate_amount end;
  update claim_cases set recovered_amount = v_rec, updated_at = now() where id = p_case;
  update claim_payments set counted = true where id = v_id;
  insert into claim_events (case_id, reservation_id, kind, title, detail)
    values (p_case, c.reservation_id, 'payment', 'Payment received: $' || to_char(p_amount, 'FM999G990D00') || ' (' || replace(p_source, '_', ' ') || ')', jsonb_build_object('payment_id', v_id, 'source', p_source, 'reference', p_ref, 'progress', true));
  if v_target is not null and v_rec >= v_target - 0.01 then
    update claim_cases set status = 'paid', closed_at = now(), outcome = 'Paid in full: $' || to_char(v_rec, 'FM999G990D00') || ' received (' || replace(p_source, '_', ' ') || ').',
      needs_work = false, work_reason = null, updated_at = now() where id = p_case;
    insert into claim_events (case_id, reservation_id, kind, title, detail) values (p_case, c.reservation_id, 'closed', 'Closed: paid in full', jsonb_build_object('recovered', v_rec, 'target', v_target, 'progress', true));
    perform claims_notify(coalesce(c.guest_first, 'The') || '''s claim is paid and closed', '$' || to_char(v_rec, 'FM999G990D00') || ' recovered. Nothing else to do.', 'success', 'claims-closed-' || p_case);
    update claim_insurer_track set state = 'paid', updated_at = now() where case_id = p_case;
    v_closed := true;
  else
    update claim_cases set needs_work = true, work_reason = 'a payment arrived', updated_at = now() where id = p_case;
  end if;
  return jsonb_build_object('ok', true, 'matched', true, 'id', v_id, 'recovered', v_rec, 'target', v_target, 'closed', v_closed);
end $$;

-- Hermes (iPostal1 mail clerk) logs scanned mail in hermes_items. A check from a guest's insurer that names the claim or the guest is a payment.
create or replace function public.claims_match_hermes_checks()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record; t record; v_n int := 0; v_res jsonb;
begin
  for r in select * from hermes_items h where h.amount_cents > 0 and coalesce(h.is_test, false) = false and h.created_at > now() - interval '30 days'
              and (coalesce(h.mail_type, '') ~* '(check|cheque|payment|settlement)' or coalesce(h.summary, '') ~* '\mcheck\M') loop
    for t in select it.case_id, it.insurer_name, it.claim_no, c.guest_last from claim_insurer_track it join claim_cases c on c.id = it.case_id
              where c.status not in ('paid', 'closed') and it.insurer_name is not null loop
      if (coalesce(r.sender, '') || ' ' || coalesce(r.summary, '') || ' ' || coalesce(r.from_domain, '')) ilike '%' || split_part(t.insurer_name, ' ', 1) || '%'
         and ((t.claim_no is not null and (coalesce(r.summary, '') || coalesce(r.details::text, '')) ilike '%' || t.claim_no || '%')
              or (t.guest_last is not null and (coalesce(r.summary, '') || coalesce(r.details::text, '')) ilike '%' || t.guest_last || '%')) then
        v_res := claims_payment_seen('insurer_check', r.amount_cents / 100.0, 'hermes-' || r.id, r.received_at, jsonb_build_object('hermes_item', r.id, 'summary', left(r.summary, 200)), t.case_id);
        if coalesce((v_res ->> 'duplicate')::boolean, false) = false then v_n := v_n + 1; end if;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('matched', v_n);
end $$;

-- Mercury (read-only: tools/settlement-mercury ingests deposits). A credit the settlement matcher could not tie to a settlement claim lands in
-- settlement_unmatched_bank. It counts as a Claims Closer payment only when it clearly belongs to ONE open case:
--   insurer check/ACH: the counterparty names the case's insurer AND (the claim number or guest last name is in the description OR the amount is exactly the target)
--   Turo payout:       the counterparty says Turo AND the amount is exactly what Turo owes Jared on a Turo-managed claim (ordinary trip payouts never match)
create or replace function public.claims_match_mercury_deposits()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u record; t record; v_n int := 0; v_target numeric; v_hit uuid[]; v_src text; v_res jsonb; v_dollars numeric;
begin
  if to_regclass('public.settlement_unmatched_bank') is null then return jsonb_build_object('matched', 0, 'note', 'no bank feed'); end if;
  for u in select * from settlement_unmatched_bank b where not b.resolved and b.amount_cents > 0 and b.created_at > now() - interval '30 days' loop
    v_dollars := u.amount_cents / 100.0; v_hit := '{}'; v_src := null;
    for t in select c.id case_id, c.guest_last, c.path, c.estimate_amount, c.host_responsibility, c.recovered_amount, it.insurer_name, it.claim_no
               from claim_cases c left join claim_insurer_track it on it.case_id = c.id
              where c.status not in ('paid', 'closed') and not coalesce(c.history, false) and c.estimate_amount is not null loop
      v_target := case when t.path = 'turo_claim' then greatest(t.estimate_amount - coalesce(t.host_responsibility, 0), 0) else t.estimate_amount end;
      if t.insurer_name is not null and coalesce(u.counterparty, '') || ' ' || coalesce(u.description, '') ilike '%' || split_part(t.insurer_name, ' ', 1) || '%'
         and ((t.claim_no is not null and coalesce(u.description, '') ilike '%' || t.claim_no || '%')
              or (t.guest_last is not null and length(t.guest_last) > 2 and coalesce(u.description, '') ilike '%' || t.guest_last || '%')
              or abs(v_dollars - v_target) < 0.01) then
        v_hit := v_hit || t.case_id; v_src := 'mercury_deposit';
      elsif t.path = 'turo_claim' and coalesce(u.counterparty, '') || ' ' || coalesce(u.description, '') ilike '%turo%' and abs(v_dollars - v_target) < 0.01 then
        v_hit := v_hit || t.case_id; v_src := 'turo_payout';
      end if;
    end loop;
    if array_length(v_hit, 1) = 1 then
      v_res := claims_payment_seen(v_src, v_dollars, u.txn_id, u.posted_at, jsonb_build_object('unmatched_bank', u.id, 'counterparty', u.counterparty), v_hit[1]);
      update settlement_unmatched_bank set resolved = true where id = u.id;
      if coalesce((v_res ->> 'duplicate')::boolean, false) = false then v_n := v_n + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('matched', v_n);
end $$;

-- ================================================================================================================ item 4: Tesla (and any pasted) estimate, treated like a shop estimate
insert into public.claim_shops (slug, name, tesla_experience, photo_estimates, oem_capable, oem_only, active, notes)
values ('tesla-service', 'Tesla Service', true, false, true, true, true,
        'Estimate source only (Tesla app chat or email, no photo-request email). OEM: chosen only when it is the best option or a third party pays in full.')
on conflict (slug) do nothing;

create or replace function public.claims_add_estimate(p_case uuid, p_shop_slug text, p_amount numeric, p_oem boolean default null, p_source text default 'pasted', p_detail jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c claim_cases; sh claim_shops; v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') and not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into c from claim_cases where id = p_case;
  select * into sh from claim_shops where slug = p_shop_slug;
  if c.id is null or sh.id is null or p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'error', 'case, shop or amount missing'); end if;
  select id into v_id from claim_estimates where case_id = p_case and shop_id = sh.id and amount = p_amount;
  if v_id is not null then return jsonb_build_object('ok', true, 'duplicate', true, 'estimate_id', v_id); end if;
  insert into claim_estimates (case_id, shop_id, channel, ref, status, requested_at, replied_at, amount, oem, repair_vs_replace, line_items, notes)
    values (p_case, sh.id, 'web', 'TS-' || substr(md5(random()::text), 1, 5), 'received', now(), now(), p_amount, coalesce(p_oem, sh.oem_only), p_detail ->> 'repair_vs_replace',
            jsonb_build_object('items', coalesce(p_detail -> 'items', '[]'::jsonb), 'reply', left(coalesce(p_detail ->> 'text', ''), 2500), 'days', p_detail -> 'days', 'source', p_source), 'added by ' || p_source)
    returning id into v_id;
  insert into claim_events (case_id, reservation_id, kind, title, detail)
    values (p_case, c.reservation_id, 'estimate', sh.name || ' quoted $' || to_char(p_amount, 'FM999G990D00'), jsonb_build_object('estimate_id', v_id, 'total', p_amount, 'source', p_source, 'progress', true));
  update claim_cases set needs_work = true, work_reason = 'an estimate arrived', updated_at = now() where id = p_case;
  return jsonb_build_object('ok', true, 'estimate_id', v_id);
end $$;

-- a Tesla email about an estimate wakes every case still waiting for one; the edge function reads it (tesla.ts) and attaches it by VIN or the one open case
create or replace function public.claims_tesla_mail_trg() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(new.from_addr, '') ~* '@(service\.)?tesla\.com' and coalesce(new.subject, '') ~* '(estimate|repair|collision|invoice|quote)' then
    update claim_cases set needs_work = true, work_reason = 'a Tesla email about an estimate', updated_at = now()
     where status not in ('paid', 'closed') and not coalesce(history, false) and estimate_amount is null;
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists claims_tesla_mail_trg on public.bestly_mail;
create trigger claims_tesla_mail_trg after insert on public.bestly_mail for each row execute function public.claims_tesla_mail_trg();

-- ================================================================================================================ item 3 and 5: Turo mail changes case state
-- Replaces claims_mail_seen. New: kinds invoice_expired / claim_update / window_reminder; the invoice's own kind (damage vs incidental charges, read from the
-- mail body); the claim number and incident id parsed into claim_cases; a paid mail marks only the invoice it belongs to, and recovered_amount / status move
-- ONLY when the paid invoice is the damage invoice. Incidental (charging, tolls, recharging) invoices are bookkept and never touch the damage claim.
create or replace function public.claims_mail_seen(m bestly_mail)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_res bigint; v_subj text := regexp_replace(coalesce(m.subject, ''), '\s+', ' ', 'g'); v_body text := coalesce(m.body_text, '');
        c claim_cases; v_kind text; v_amt numeric; v_due text; v_ikind text; v_iid bigint; v_claim text; v_inc bigint; v_prog boolean; v_days int;
        v_idx int; v_n int; v_inv jsonb; v_pid uuid; v_rec numeric; v_target numeric;
begin
  if coalesce(m.from_addr, '') !~* 'turo\.com' then return; end if;
  v_res := claims_res_from_mail(v_subj, v_body);
  if v_res is null then return; end if;

  v_kind := case
    when v_subj ~* 'resolve directly process' then 'resolve_started'
    when v_subj ~* 'invoice (has )?(expired|cancell?ed)' or v_body ~* '(window to modify your reimbursement invoice[^.]*has passed|your invoice has been cancell?ed|invoice has expired)' then 'invoice_expired'
    when m.from_addr ~* 'claims\.turo\.com' and v_subj ~* 'update on your claim' then 'claim_update'
    when m.from_addr ~* 'claims\.turo\.com' and v_subj ~* '(claim|damage)' then 'claim_mail'
    when v_subj ~* 'days left to resolve directly' then 'window_reminder'
    when (v_subj || ' ' || v_body) ~* '(has been charged|has been paid|was paid|accepted the reimbursement invoice|payment received|paid invoice)' then 'invoice_paid'
    when v_subj ~* 'declin' and v_subj ~* 'invoice' then 'invoice_declined'
    when v_subj ~* 'reimbursement invoice' and v_body ~* 'until' then 'invoice_sent'
    when v_subj ~* 'reimbursement|invoice' and v_body ~* 'disput' then 'invoice_disputed'
    else null end;

  select * into c from claim_cases where reservation_id = v_res;
  if c.id is null then
    if v_kind in ('resolve_started', 'claim_mail') then
      perform claims_open_case(v_res, case when v_kind = 'resolve_started' then 'resolve_directly' else 'turo_claim' end, m.id, coalesce(m.sent_at, now()));
      select * into c from claim_cases where reservation_id = v_res;
    else
      return;
    end if;
  end if;
  if exists (select 1 from claim_events where mail_id = m.id and kind = 'mail') then return; end if;

  v_amt  := nullif(replace(substring(v_body from 'Total charge\s*-\s*\$([0-9.,]+)'), ',', ''), '')::numeric;
  v_due  := substring(v_body from 'until ([A-Z][a-z]+ \d{1,2} at \d{1,2}:\d{2} ?[AP]M)');
  v_iid  := nullif(substring(v_body from 'invoiceId=(\d+)'), '')::bigint;
  v_ikind := case when v_body ~* '(damage charges|\mdamage\s*-\s*\$|repair cost for the damage)' then 'damage'
                  when v_body ~* 'incidental charges' then 'incidental' else null end;
  v_claim := substring(v_body from '(?i)(?:incident|claim)\s*(?:number|id|#)\s*[:#]?\s*(\d{5,9})');
  v_inc   := nullif(substring(v_body from '(?i)(?:incidentId=|/incidents?/|/claims?/)(\d{5,9})'), '')::bigint;
  v_prog  := v_kind in ('claim_update', 'claim_mail', 'resolve_started', 'invoice_expired', 'invoice_declined', 'invoice_disputed', 'window_reminder')
             or (v_kind in ('invoice_sent', 'invoice_paid') and v_ikind = 'damage');

  insert into claim_events (case_id, reservation_id, kind, title, detail, mail_id)
    values (c.id, v_res, 'mail', left(v_subj, 200),
            jsonb_build_object('kind', v_kind, 'from', m.from_addr, 'excerpt', left(v_body, 600), 'invoice_kind', v_ikind, 'amount', v_amt, 'invoice_id', v_iid, 'progress', v_prog,
                               'auto_charged', v_subj ~* 'has not responded'), m.id);

  -- item 5: the Turo claim number / incident id out of any Turo claim mail
  if v_claim is not null or v_inc is not null then perform claims_link_turo_ids(c.id, v_claim, v_inc); end if;

  if v_kind = 'invoice_sent' then
    update claim_cases set invoices = invoices || jsonb_build_array(jsonb_build_object('amount', v_amt, 'due_text', v_due, 'mail_id', m.id, 'paid', false, 'kind', v_ikind, 'invoice_id', v_iid)), updated_at = now()
     where id = c.id;
    if v_ikind = 'damage' then
      update claim_cases set status = case when status in ('open', 'waiting_guest') then 'invoiced' else status end, needs_work = true, work_reason = 'damage invoice sent' where id = c.id;
    end if;
  elsif v_kind = 'invoice_paid' then
    -- which invoice? by Turo's id when the mail has one, else by amount and kind, else the one unpaid invoice; never "all of them"
    select (ord - 1)::int into v_idx from jsonb_array_elements(c.invoices) with ordinality as t(i, ord)
      where coalesce((i ->> 'paid')::boolean, false) = false
        and ((v_iid is not null and (i ->> 'invoice_id')::bigint = v_iid)
             or (v_amt is not null and (i ->> 'amount')::numeric = v_amt and (v_ikind is null or i ->> 'kind' is null or i ->> 'kind' = v_ikind)))
      order by ord desc limit 1;
    if v_idx is null and v_amt is null then
      select count(*) into v_n from jsonb_array_elements(c.invoices) i where coalesce((i ->> 'paid')::boolean, false) = false;
      if v_n = 1 then select (ord - 1)::int into v_idx from jsonb_array_elements(c.invoices) with ordinality as t(i, ord) where coalesce((i ->> 'paid')::boolean, false) = false limit 1; end if;
    end if;
    if v_idx is not null then
      v_inv := c.invoices -> v_idx;
      v_ikind := coalesce(v_ikind, v_inv ->> 'kind');
      v_amt := coalesce(v_amt, (v_inv ->> 'amount')::numeric);
      update claim_cases set invoices = jsonb_set(invoices, array[v_idx::text], (invoices -> v_idx) || jsonb_build_object('paid', true, 'paid_mail_id', m.id, 'kind', v_ikind)), updated_at = now() where id = c.id;
    elsif v_amt is not null then
      update claim_cases set invoices = invoices || jsonb_build_array(jsonb_build_object('amount', v_amt, 'mail_id', m.id, 'paid', true, 'kind', v_ikind)), updated_at = now() where id = c.id;
    end if;
    update claim_events set detail = detail || jsonb_build_object('invoice_kind', v_ikind, 'amount', v_amt, 'matched_invoice', v_idx is not null) where mail_id = m.id and kind = 'mail';
    if v_ikind = 'damage' and v_amt is not null then
      -- the money for the damage came in: record it and close if that is everything owed
      perform claims_payment_seen('guest_invoice', v_amt, 'turo-mail-' || m.id, coalesce(m.sent_at, now()), jsonb_build_object('mail_id', m.id, 'invoice_id', v_iid), c.id);
    else
      insert into claim_events (case_id, reservation_id, kind, title, detail)
        values (c.id, v_res, 'note', 'Paid invoice was for ' || coalesce(v_ikind, 'unknown') || ' charges' || coalesce(' ($' || v_amt || ')', '') || ', not the damage: claim recovery unchanged', jsonb_build_object('mail_id', m.id, 'amount', v_amt, 'invoice_kind', v_ikind));
    end if;
  elsif v_kind = 'invoice_expired' then
    insert into claim_windows (case_id, kind, due_at, source, note, status) values (c.id, 'invoice_expiry', coalesce(m.sent_at, now()), 'Turo mail: ' || left(v_subj, 80), 'invoice expired or was cancelled', 'lapsed')
      on conflict (case_id, kind) do update set status = 'lapsed', due_at = excluded.due_at, source = excluded.source, note = excluded.note, updated_at = now();
    update claim_cases set needs_work = true, work_reason = 'the Turo invoice expired', turo_next_action = coalesce(turo_next_action, 'Invoice has expired'), updated_at = now() where id = c.id;
  elsif v_kind = 'invoice_declined' or v_kind = 'invoice_disputed' then
    update claim_cases set needs_work = true, work_reason = 'guest ' || case v_kind when 'invoice_declined' then 'declined' else 'disputed' end || ' an invoice', updated_at = now() where id = c.id;
    if v_kind = 'invoice_disputed' then
      perform claims_notify(coalesce(c.guest_first, 'guest') || ' disputed an invoice', 'I am moving this to the next path before the Turo cutoff ' || claims_pt(c.escalate_by) || '.', 'warning', 'claims-dispute-' || m.id);
    end if;
  elsif v_kind = 'window_reminder' then
    v_days := nullif(substring(v_subj from '(\d+) days? left'), '')::int;
    if v_days is not null then
      insert into claim_windows (case_id, kind, due_at, source, note) values (c.id, 'resolve_directly', coalesce(m.sent_at, now()) + make_interval(days => v_days), 'Turo reminder: ' || left(v_subj, 80), 'days left read from the Turo reminder')
        on conflict (case_id, kind) do update set due_at = excluded.due_at, source = excluded.source, updated_at = now();
    end if;
    update claim_cases set needs_work = true, work_reason = 'Turo window reminder', updated_at = now() where id = c.id;
  else
    update claim_cases set needs_work = true, work_reason = coalesce(v_kind, 'new Turo mail'), updated_at = now() where id = c.id;
  end if;
end $$;

-- ================================================================================================================ item 12 + watchdog: self-healing
-- Re-runs a stalled tick, re-links open Turo claims that never got their incident id, and tells Scout (signed Claims Closer) when it cannot fix them.
create or replace function public.claims_watchdog()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_stalled int; v_tries int; r record; v_relinked int := 0; v_claim text; v_inc bigint; v_alerts int := 0;
begin
  -- 1. cases waiting 15+ min while the worker has not run: re-run it, up to 3 times an hour, then tell Scout
  select count(*) into v_stalled from claim_cases where status not in ('paid', 'closed') and not coalesce(history, false) and needs_work
    and updated_at < now() - interval '15 minutes' and coalesce(last_run_at, 'epoch') < now() - interval '15 minutes';
  if v_stalled > 0 then
    select count(*) into v_tries from claim_events where kind = 'selfheal' and title = 'Re-ran the Claims Closer worker' and at > now() - interval '1 hour';
    if v_tries < 3 then
      perform invoke_edge_function('claims-closer', '{"op":"run"}'::jsonb, 120000);
      insert into claim_events (kind, title, detail) values ('selfheal', 'Re-ran the Claims Closer worker', jsonb_build_object('stalled_cases', v_stalled, 'attempt', v_tries + 1));
    else
      perform scout_notify('Claims Closer could not restart itself',
        'Claims Closer re-ran its worker ' || v_tries || ' times in the last hour and ' || v_stalled || ' claim(s) are still waiting. The claims-closer edge function needs a look.', 'warning', true,
        'https://bestly.tech/admin/claims', 'claims-selfheal-stall-' || to_char(now() at time zone 'America/Los_Angeles', 'YYYYMMDDHH24'));
      v_alerts := v_alerts + 1;
    end if;
  end if;

  -- 2. an open Turo-claim case with no incident id older than 30 min: look for the ids in its Turo mail first, then poke the reader to find it
  for r in select * from claim_cases where status not in ('paid', 'closed') and not coalesce(history, false) and turo_incident_id is null and path = 'turo_claim' and opened_at < now() - interval '30 minutes' loop
    select substring(b.body_text from '(?i)(?:incident|claim)\s*(?:number|id|#)\s*[:#]?\s*(\d{5,9})'),
           nullif(substring(b.body_text from '(?i)(?:incidentId=|/incidents?/|/claims?/)(\d{5,9})'), '')::bigint
      into v_claim, v_inc
      from bestly_mail b where b.from_addr ~* 'turo\.com' and (b.body_text ilike '%reservation/' || r.reservation_id || '%' or b.subject ilike '%' || r.reservation_id || '%')
       and (b.body_text ~* '(incident|claim)\s*(number|id|#)\s*[:#]?\s*\d{5,9}' or b.body_text ~* '(incidentId=|/incidents?/|/claims?/)\d{5,9}') order by b.sent_at desc limit 1;
    if v_claim is not null or v_inc is not null then
      perform claims_link_turo_ids(r.id, v_claim, v_inc); v_relinked := v_relinked + 1;
    else
      update turo_reader_state set poke_at = now() where id = 1;
      if r.opened_at < now() - interval '6 hours' then
        perform scout_notify('Claims Closer cannot find the Turo claim for ' || coalesce(r.guest_first, 'a guest'),
          'Claims Closer has no Turo incident id for reservation ' || r.reservation_id || ' after 6 hours, so nothing syncs. It is asking the Pi reader to look; if this stays, the id needs to be added by hand.', 'warning', true,
          'https://bestly.tech/admin/claims', 'claims-selfheal-link-' || r.id || '-' || to_char(now() at time zone 'America/Los_Angeles', 'YYYYMMDD'));
        v_alerts := v_alerts + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('stalled', v_stalled, 'relinked', v_relinked, 'alerts', v_alerts);
exception when others then
  begin perform bestly_raise('claims.watchdog', 'problem', 'warning', 'Claims Closer watchdog failed', left(sqlerrm, 300), 'turo', null, false); exception when others then null; end;
  return jsonb_build_object('error', left(sqlerrm, 200));
end $$;

-- ================================================================================================================ the Pi reader only runs kinds it can do
-- 'escalate' and 'mark_insurer' stay queued (they are Jared's allowed Turo step, shown to him once) until the reader learns them, instead of failing at "does not do".
create or replace function public.claims_turo_claim(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare out jsonb;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  update claim_turo_actions set status = 'failed', error = 'reader stopped mid-action; check Turo before retrying', done_at = now()
    where status = 'sending' and claimed_at < now() - interval '10 minutes';
  with a as (
    update claim_turo_actions t set status = 'sending', claimed_at = now(), attempts = attempts + 1
    where t.id in (select x.id from claim_turo_actions x where x.status = 'queued' and x.attempts < 2 and x.kind = 'create_invoice' order by x.created_at limit 1)
    returning t.id, t.kind, t.payload, t.case_id)
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'payload', a.payload, 'case_id', a.case_id,
      'incident_id', c.turo_incident_id, 'reservation_id', c.reservation_id)), '[]'::jsonb) into out
    from a join claim_cases c on c.id = a.case_id;
  return out;
end $$;

-- for the Pi reader: open cases with no incident id (so it can find them in /api/claims/host and call claims_link_turo_ids)
create or replace function public.claims_unlinked_list(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('case_id', c.id, 'reservation_id', c.reservation_id, 'claim_no', c.turo_claim_no))
                     from claim_cases c where c.turo_incident_id is null and not coalesce(c.history, false) and c.status not in ('paid', 'closed') and c.path = 'turo_claim'), '[]'::jsonb);
end $$;

create or replace function public.claims_link_put(p_token text, p_case uuid, p_claim_no text, p_incident bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  return claims_link_turo_ids(p_case, p_claim_no, p_incident);
end $$;

-- the original claims_watch with the booking-reminder block moved to claims_booking_reminders (day before + 2 hours before) and the watchdog added
create or replace function public.claims_watch()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_stale int; v_signed boolean; v_silent int; r record; v_wd jsonb;
begin
  select count(*) into v_stale from claim_cases where turo_incident_id is not null and not history and status not in ('paid', 'closed')
    and coalesce(synced_at, 'epoch') < now() - interval '30 minutes';
  select coalesce(signed_in, false) into v_signed from turo_reader_state where id = 1;
  if v_stale > 0 then
    update turo_reader_state set poke_at = now() where id = 1;
    perform bestly_raise('claims.sync', 'problem', 'warning', 'Claims Closer cannot read Turo',
      v_stale || ' open claim(s) have not synced from Turo in 30+ minutes' || case when v_signed then ' (the reader is signed in, so the claims read itself is failing).' else ' (the Pi reader is signed out of Turo).' end, 'turo', null, false);
  else
    perform bestly_raise('claims.sync', 'resolved', 'info', 'Claims Closer can read Turo again', null, 'turo', null, true);
  end if;

  for r in select a.id, a.case_id, a.kind from claim_turo_actions a where a.status = 'sending' and a.claimed_at < now() - interval '10 minutes' loop
    update claim_turo_actions set status = 'failed', error = 'reader stopped mid-action; check Turo before retrying', done_at = now() where id = r.id;
    perform claims_ask(r.case_id, 'The ' || replace(r.kind, '_', ' ') || ' in Turo stopped halfway. Please check the claim in Turo, then tell me whether to try again.',
      '[{"value":"retry","label":"Try again"},{"value":"done","label":"It went through"}]'::jsonb, 'turo-stuck-' || r.id, 'decision');
  end loop;
  if exists (select 1 from claim_turo_actions where status = 'queued' and kind = 'create_invoice' and created_at < now() - interval '15 minutes') then
    update turo_reader_state set poke_at = now() where id = 1;
  end if;

  for r in select e.id, e.case_id from claim_estimates e where e.status = 'requested' and e.requested_at < now() - interval '72 hours' loop
    update claim_estimates set status = 'no_reply' where id = r.id;
    update claim_cases set needs_work = true, work_reason = 'a shop never replied', updated_at = now() where id = r.case_id;
  end loop;
  select count(*) into v_silent from claim_estimates where status = 'requested' and requested_at < now() - interval '24 hours';

  v_wd := claims_watchdog();
  return jsonb_build_object('stale', v_stale, 'silent_24h', v_silent, 'watchdog', v_wd);
end $$;

-- ================================================================================================================ the tick
create or replace function public.claims_autonomy_sweep()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v jsonb := '{}'::jsonb; r jsonb;
begin
  -- order matters: tap Complete trip first, then the hold that was waiting on it, then wake the cases that were held for the gate
  begin r := claims_auto_complete_trips(false); v := v || jsonb_build_object('auto_complete', r -> 'completed'); exception when others then v := v || jsonb_build_object('auto_complete_error', left(sqlerrm, 120)); end;
  begin r := claims_hold_autorelease(); v := v || jsonb_build_object('holds', r); exception when others then v := v || jsonb_build_object('holds_error', left(sqlerrm, 120)); end;
  begin r := claims_stuck_alert(); v := v || jsonb_build_object('stuck', r); exception when others then v := v || jsonb_build_object('stuck_error', left(sqlerrm, 120)); end;
  begin r := claims_question_sweep(); v := v || jsonb_build_object('questions', r); exception when others then v := v || jsonb_build_object('questions_error', left(sqlerrm, 120)); end;
  begin r := claims_booking_reminders(); v := v || jsonb_build_object('reminders', r); exception when others then v := v || jsonb_build_object('reminders_error', left(sqlerrm, 120)); end;
  begin r := claims_windows_due(); v := v || jsonb_build_object('windows', r); exception when others then v := v || jsonb_build_object('windows_error', left(sqlerrm, 120)); end;
  begin r := claims_match_hermes_checks(); v := v || jsonb_build_object('hermes', r); exception when others then v := v || jsonb_build_object('hermes_error', left(sqlerrm, 120)); end;
  begin r := claims_match_mercury_deposits(); v := v || jsonb_build_object('mercury', r); exception when others then v := v || jsonb_build_object('mercury_error', left(sqlerrm, 120)); end;
  return v;
end $$;

create or replace function public.claims_tick()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_now_la timestamp := now() at time zone 'America/Los_Angeles'; v_daily boolean; v_work int; v_stuck int; v_open int; v_sweep jsonb;
begin
  begin v_sweep := public.claims_autonomy_sweep(); exception when others then v_sweep := jsonb_build_object('error', left(sqlerrm, 120)); end;
  begin perform public.claims_gate_sweep(); exception when others then null; end;
  select count(*) into v_open from claim_cases where status not in ('paid', 'closed');
  v_daily := extract(hour from v_now_la) >= 9 and exists (select 1 from claim_cases where status not in ('paid','closed')
             and (last_daily_at is null or last_daily_at < v_now_la::date));
  select count(*) into v_work from claim_cases where status not in ('paid', 'closed')
    and (needs_work or (follow_up_at is not null and follow_up_at <= now()) or (next_check_at is not null and next_check_at <= now()));
  select count(*) into v_stuck from claim_cases where status not in ('paid', 'closed') and needs_work
    and updated_at < now() - interval '15 minutes' and coalesce(last_run_at, 'epoch') < now() - interval '15 minutes';

  if v_daily then
    perform invoke_edge_function('claims-closer', '{"op":"daily"}'::jsonb, 120000);
  elsif v_work > 0 then
    perform invoke_edge_function('claims-closer', '{"op":"tick"}'::jsonb, 120000);
  elsif v_stuck = 0 then
    perform agent_beat('claims-closer', true, case when v_open = 0 then 'No open claims' else v_open || ' open claim' || case when v_open = 1 then '' else 's' end || ', nothing new' end);
  end if;
  if v_stuck > 0 then
    perform agent_beat('claims-closer', false, v_stuck || ' claim(s) waiting 15+ min; the worker is not running');
    perform bestly_raise('claims.stuck', 'problem', 'warning', 'Claims Closer is not working its cases',
      'claims-closer edge function has not run for 15+ minutes while a case waits.', 'turo', null, false);
  else
    perform bestly_raise('claims.stuck', 'resolved', 'info', 'Claims Closer is working its cases', null, 'turo', null, true);
  end if;
  return jsonb_build_object('work', v_work, 'daily', v_daily, 'stuck', v_stuck, 'sweep', v_sweep);
end $$;

-- ================================================================================================================ backfills (data only; run when this migration is applied)
-- Cody (res 62622707): Turo incident 663253, claim 1108308 (bestly_memory claims/cody-62622707-and-kemper-2026-10-27)
select claims_link_turo_ids(id, '1108308', 663253) from claim_cases where reservation_id = 62622707;
-- label the two paid reimbursement invoices already on file: both are Supercharging charges, not damage
update claim_cases set invoices = (select coalesce(jsonb_agg(i || jsonb_build_object('kind', 'incidental')), '[]'::jsonb) from jsonb_array_elements(invoices) i)
 where reservation_id in (62622707, 59754331) and invoices <> '[]'::jsonb;
-- Willie's windows as Turo's own mail states them (20 days from trip end; the damage invoice was cancelled Oct 24)
insert into claim_windows (case_id, kind, due_at, source, note, status)
  select id, 'resolve_directly', escalate_by, 'Turo: 20 days from trip end to resolve directly', 'after this Turo cannot take over the claim', 'lapsed' from claim_cases where reservation_id = 59754331 and escalate_by < now()
  on conflict (case_id, kind) do nothing;
insert into claim_windows (case_id, kind, due_at, source, note, status)
  select id, 'invoice_expiry', '2026-10-24 07:30:18+00', 'Turo mail: Reimbursement invoice canceled', 'the 20-day window to modify the $500 damage invoice passed', 'lapsed' from claim_cases where reservation_id = 59754331
  on conflict (case_id, kind) do nothing;

-- ================================================================================================================ who may call what
-- Everything above is for cron, the edge function (service key) or the Claims page (admin). Only the Pi reader's token RPCs are public-key callable
-- (token checked inside by tesla_worker_ok) and those go on the Ares allowlist so the Auto-Fixer does not lock them.
revoke all on function public.claims_haversine_m(double precision, double precision, double precision, double precision) from anon, authenticated, public;
revoke all on function public.claims_pt(timestamptz) from anon, authenticated, public;
revoke all on function public.claims_gate_ignoring_hold(uuid) from anon, authenticated, public;
revoke all on function public.claims_hold_autorelease() from anon, authenticated, public;
revoke all on function public.claims_car_parked_where(text) from anon, authenticated, public;
revoke all on function public.claims_auto_complete_trips(boolean) from anon, authenticated, public;
revoke all on function public.claims_waiting_on(uuid) from anon, authenticated, public;
revoke all on function public.claims_stuck_alert() from anon, authenticated, public;
revoke all on function public.claims_question_sweep() from anon, authenticated, public;
revoke all on function public.claims_booking_reminders() from anon, authenticated, public;
revoke all on function public.claims_link_turo_ids(uuid, text, bigint) from anon, authenticated, public;
revoke all on function public.claims_set_windows(uuid, jsonb) from anon, authenticated, public;
revoke all on function public.claims_windows_due() from anon, authenticated, public;
revoke all on function public.claims_payment_seen(text, numeric, text, timestamptz, jsonb, uuid) from anon, authenticated, public;
revoke all on function public.claims_match_hermes_checks() from anon, authenticated, public;
revoke all on function public.claims_match_mercury_deposits() from anon, authenticated, public;
revoke all on function public.claims_add_estimate(uuid, text, numeric, boolean, text, jsonb) from anon, authenticated, public;
revoke all on function public.claims_watchdog() from anon, authenticated, public;
revoke all on function public.claims_autonomy_sweep() from anon, authenticated, public;
revoke all on function public.claims_autonomy_set(text, text) from anon, public;
grant execute on function public.claims_autonomy_set(text, text) to authenticated;   -- admin check inside

revoke all on function public.claims_unlinked_list(text) from anon, authenticated, public;
grant execute on function public.claims_unlinked_list(text) to anon;
revoke all on function public.claims_link_put(text, uuid, text, bigint) from anon, authenticated, public;
grant execute on function public.claims_link_put(text, uuid, text, bigint) to anon;
insert into public.security_public_rpcs (fn, why) values
  ('claims_unlinked_list', 'Pi Turo reader lists open claims with no incident id; worker token checked inside'),
  ('claims_link_put',      'Pi Turo reader saves the claim number and incident id it found; worker token checked inside')
on conflict (fn) do nothing;

-- ================================================================================================================ seeds from Jared's own notes (bestly_memory claims/cody-62622707-and-kemper-2026-10-27)
-- Cody's driver (an approved additional driver) carries Progressive policy 870703450. Recorded as the case's insurer so the insurer track can start;
-- it still sends nothing until it has an estimate and an adjuster contact, and every send still passes the hold and the return gate.
update claim_cases set insurer = jsonb_build_object('name', 'Progressive', 'policy_no', '870703450', 'policy_holder', 'Essence Bonner Harris'), needs_work = true, work_reason = 'insurer recorded'
 where reservation_id = 62622707 and coalesce(insurer, '{}'::jsonb) = '{}'::jsonb;
-- Kemper claim 26123598964 is not a Turo case. Jared's third request (Oct 27, 2:06 PM) set Fri Oct 31 as the reply deadline, then escalation to the supervisor.
-- No adjuster email is stored (none is in the notes and none is invented): at the deadline Claims Closer asks Jared for it and tells him the supervisor line.
insert into claim_outside_claims (label, insurer_name, claim_no, adjuster_name, reply_due_at, next_chase_at, notes)
values ('Kemper check for the Tesla Collision repair', 'Kemper', '26123598964', 'Sunshine Kennedy', '2026-11-01 00:00:00+00', '2026-11-01 00:00:00+00',
  '[{"note":"Third request sent Oct 27 2:06 PM from Jared; deadline Fri Oct 31, then escalate to supervisor Terrell Frasier, 800-353-6737 ext. 1512117. The $1,647.81 supplement check was mailed to Tesla; a $946.39 shortfall went to the appraiser."}]'::jsonb)
on conflict (insurer_name, claim_no) do nothing;

-- ================================================================================================================ the Claims page reads these (admin only)
create or replace function public.claims_autonomy_get()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s claims_autonomy_settings; v_blocked jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into s from claims_autonomy_settings where id;
  select coalesce(jsonb_agg(x order by x.at desc), '[]'::jsonb) into v_blocked from (
    select l.at, l.channel, l.purpose, l.code, l.reason, c.guest_first
      from claims_send_log l left join claim_cases c on c.id = l.case_id
     where l.decision = 'blocked' and l.at > now() - interval '7 days' order by l.at desc limit 8) x;
  return jsonb_build_object('insurer_contact_mode', s.insurer_contact_mode, 'booking_mode', s.booking_mode, 'min_accept_pct', s.min_accept_pct, 'auto_complete', s.auto_complete,
    'hold_autorelease', s.hold_autorelease, 'booking_buffer_hours', s.booking_buffer_hours, 'blocked', v_blocked);
end $$;
revoke all on function public.claims_autonomy_get() from anon, public;
grant execute on function public.claims_autonomy_get() to authenticated;
