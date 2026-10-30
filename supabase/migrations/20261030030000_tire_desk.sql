-- Flat Tire Desk (Car Guard + Ava, 2026-10-29, Jared: "how can we automate this for myself to make it easy on me").
-- On Craig's trip Jared found a tire shop by hand while Turo Roadside waited ("if you know a place to get a tire it can get
-- towed there"). Now, when a tire fails during a trip, the desk does the legwork and Jared only taps:
--   1. tire_desk_open: Jared gets one push right away (where the car is, what it shows, what the guest said).
--   2. tire-next-steps op 'step' (cron tire-desk, every minute) finds tire shops near the car (TomTom when the key allows it,
--      else OpenStreetMap through pg_net), then Ava calls up to 3 of them: is a 235/45R18 in stock, price installed, can they
--      take a tow-in now. Free AI reads each call into a short answer; Jared gets a ranked shortlist push.
--   3. /admin/tires: Jared taps a shop -> the tow plan goes to the guest in the Turo chat (turo_out_msgs 'tire_next').
--      The shop's quote -> Jared taps Approve -> logged on the Claims Closer case and confirmed in the Turo chat ('tire_approve'),
--      which is Turo's rule (a replacement tire needs the host's OK, equal or better quality).
-- Replaces the automatic tow plan from 20261030020000: the guest only gets a tow plan Jared picked. Car Guard's instant
-- "pull over and call Turo Roadside" message (tire_hard) still goes out by itself.

create table if not exists public.tire_incidents (
  id             uuid primary key default gen_random_uuid(),
  reservation_id bigint not null,
  guest_first    text,
  reason         text,
  status         text not null default 'finding' check (status in ('finding','calling','collecting','ready','picked','approved','closed')),
  lat double precision, lon double precision, car_at timestamptz,
  shops          jsonb not null default '[]'::jsonb,   -- [{name, phone, address, mi, open_now, hours, src, call_id, result{...}}]  (business numbers)
  tesla          jsonb,                               -- nearest Tesla Service, for wheel / suspension damage
  net            jsonb not null default '{}'::jsonb,  -- pg_net request ids while looking shops up
  src            text,
  picked         jsonb,                               -- the shop Jared tapped
  approved       jsonb,                               -- {note, at}
  calls_at       timestamptz,
  log            jsonb not null default '[]'::jsonb,
  opened_at      timestamptz not null default now(),
  closed_at      timestamptz,
  updated_at     timestamptz not null default now()
);
create unique index if not exists tire_incidents_one_open on public.tire_incidents (reservation_id) where status <> 'closed';
alter table public.tire_incidents enable row level security;
revoke all on public.tire_incidents from anon, authenticated;
drop policy if exists tire_incidents_admin_read on public.tire_incidents;
create policy tire_incidents_admin_read on public.tire_incidents for select to authenticated using (has_role(auth.uid(), 'admin'));
grant select on public.tire_incidents to authenticated;

insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason, enabled)
select 'tire_incidents', 'shops', 'phone', 'keep', 'Tire shop business phone numbers found for a flat tire; no personal data.', true
where not exists (select 1 from public.privacy_data_map where table_name = 'tire_incidents' and column_name = 'shops');

create or replace function public.tire_desk_log(p_id uuid, p_text text) returns void language sql security definer set search_path to 'public' as $$
  update tire_incidents set log = (jsonb_build_array(jsonb_build_object('at', now(), 'text', p_text)) || log) - 40, updated_at = now() where id = p_id;
$$;

-- Open (or return) the incident for a trip and push Jared right away.
create or replace function public.tire_desk_open(p_res bigint, p_reason text) returns uuid
language plpgsql security definer set search_path to 'public' as $fn$
declare t turo_trips; v turo_vehicle_state; fs tesla_fleet_settings; id_ uuid; last_guest text;
begin
  select id into id_ from tire_incidents where reservation_id = p_res and status <> 'closed';
  if id_ is not null then return id_; end if;
  if not coalesce((select enabled from car_tire_settings where id = 1), true) then return null; end if;
  select * into t from turo_trips where reservation_id = p_res;
  select * into fs from tesla_fleet_settings where id = 1;
  select * into v from turo_vehicle_state where vin = coalesce(t.vin, fs.vin);
  insert into tire_incidents (reservation_id, guest_first, reason, lat, lon, car_at)
  values (p_res, t.guest_first, left(p_reason, 400), v.latitude, v.longitude, v.observed_at) returning id into id_;
  perform tire_desk_log(id_, 'Opened: ' || left(p_reason, 200));
  select left(body, 160) into last_guest from turo_inbox where reservation_id = p_res and role = 'GUEST' order by sent_at desc limit 1;
  perform scout_notify('Car Guard: tire trouble on ' || coalesce(t.guest_first, 'a guest') || '''s trip',
    left(p_reason, 220) || coalesce(' Guest''s last message: "' || last_guest || '"', '')
      || coalesce(' Car at https://maps.apple.com/?q=' || round(v.latitude::numeric, 5) || ',' || round(v.longitude::numeric, 5), '')
      || '. I''m finding tire shops near the car and Ava is calling them; your shortlist comes in about 10 minutes.',
    'warning', true, '/admin/tires', 'tire-open-' || p_res);
  perform invoke_edge_function('tire-next-steps', jsonb_build_object('op', 'step', 'id', id_), 150000);
  return id_;
end $fn$;

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
      if v_kind = 'tire_hard' then   -- Flat Tire Desk: Ava calls shops, Jared taps one (2026-10-29)
        perform tire_desk_open(t.reservation_id, 'Tesla hard tire warning: ' || line);
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

-- A guest writing about a flat or a tire during a trip opens the desk (wins if the car's warning never came).
create or replace function public.car_tire_inbox_trg() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
begin
  begin
    if new.role = 'GUEST' and coalesce(new.body, '') ~* '(\m(flat|tires?|tyres?|blow ?out|blew out|rim)\M|pull over)'
       and coalesce(new.sent_at, now()) > now() - interval '2 hours'
       and coalesce((select enabled from car_tire_settings where id = 1), true)
       and exists (select 1 from turo_trips where reservation_id = new.reservation_id
                    and now() between starts_at and ends_at + interval '30 minutes' and coalesce(status, '') !~* 'cancel')
       and not exists (select 1 from turo_out_msgs where reservation_id = new.reservation_id and kind = 'tire_next')
       and not exists (select 1 from tire_incidents where reservation_id = new.reservation_id) then
      perform tire_desk_open(new.reservation_id, 'Guest wrote in the Turo chat: "' || left(new.body, 160) || '"');
    end if;
  exception when others then
    perform bestly_raise('car.tire.inbox', 'problem', 'warning', 'Flat Tire Desk did not start from the Turo chat', sqlerrm, 'turo', null);
  end;
  return new;
end $fn$;

-- Cron: move every open incident one step (the edge function does the work; nothing here waits).
create or replace function public.tire_desk_tick() returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare r record; n int := 0;
begin
  for r in select id, status, updated_at from tire_incidents where status in ('finding', 'calling', 'collecting') loop
    perform invoke_edge_function('tire-next-steps', jsonb_build_object('op', 'step', 'id', r.id), 150000);
    n := n + 1;
    -- watchdog: stuck in a working step for 30 minutes
    if r.updated_at < now() - interval '30 minutes' then
      perform bestly_raise('car.tire.desk.' || r.id, 'problem', 'warning', 'Flat Tire Desk is stuck',
        'Incident ' || r.id || ' has been "' || r.status || '" for 30 minutes. Open /admin/tires.', 'turo', null);
    end if;
  end loop;
  update tire_incidents set status = 'closed', closed_at = now(), updated_at = now()
   where status in ('ready', 'picked', 'approved') and opened_at < now() - interval '4 days';
  return jsonb_build_object('stepped', n);
end $fn$;
select cron.unschedule('tire-desk') where exists (select 1 from cron.job where jobname = 'tire-desk');
select cron.schedule('tire-desk', '* * * * *', 'select public.tire_desk_tick()');

-- ---------------- Jared's taps (/admin/tires) ----------------
create or replace function public.tire_desk_admin() returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'incidents', coalesce((select jsonb_agg(to_jsonb(i) order by i.opened_at desc) from (
        select i.*, (select jsonb_object_agg(kind, jsonb_build_object('status', status, 'sent_at', sent_at)) from turo_out_msgs m
                      where m.reservation_id = i.reservation_id and m.kind like 'tire_%') as msgs
          from tire_incidents i where i.opened_at > now() - interval '30 days' order by i.opened_at desc limit 20) i), '[]'::jsonb),
    'trip', (select jsonb_build_object('reservation_id', t.reservation_id, 'guest_first', t.guest_first) from car_tire_active_trip(null) t where t.reservation_id is not null),
    'tire_size', (select tire_size from car_tire_settings where id = 1));
end $fn$;

-- Jared starts it by hand (e.g. the guest called him instead of writing).
create or replace function public.tire_desk_start(p_res bigint) returns uuid
language plpgsql security definer set search_path to 'public' as $fn$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return tire_desk_open(p_res, 'Started by Jared');
end $fn$;

-- Jared taps a shop: the tow plan goes to the guest in the Turo chat.
create or replace function public.tire_desk_pick(p_id uuid, p_idx int) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare i tire_incidents; s car_tire_settings; sh jsonb; r jsonb; body text; hard boolean;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into i from tire_incidents where id = p_id for update;
  if i.id is null then raise exception 'no such incident'; end if;
  sh := i.shops -> p_idx;
  if sh is null then raise exception 'no such shop'; end if;
  select * into s from car_tire_settings where id = 1;
  r := sh->'result';
  hard := exists (select 1 from turo_out_msgs where reservation_id = i.reservation_id and kind = 'tire_hard' and status = 'sent');
  body := case when hard then '' else 'If you haven''t yet, call Turo Roadside Assistance, 24/7: ' || s.roadside_phone || '. ' end
       || 'Please have Turo Roadside tow the car to ' || (sh->>'name') || coalesce(', ' || (sh->>'address'), '') || coalesce(' (' || (sh->>'phone') || ')', '') || '. '
       || case when r->>'in_stock' = 'yes' then 'They told us they have the ' || coalesce(s.tire_size, '') || ' tire in stock'
                 || coalesce(' (' || nullif(r->>'brand', '') || ')', '') || '. '
               else 'The tire size is ' || coalesce(s.tire_size, '') || '. ' end
       || 'Before they put a new tire on, have the shop send me the brand and price here so I can approve it, per Turo''s flat tire policy, and keep all receipts. '
       || 'If the wheel or suspension looks damaged, not just the tire, tell me here before anything else is done.';
  insert into turo_out_msgs (reservation_id, kind, body, verify_snippet, status)
  values (i.reservation_id, 'tire_next', body, 'Please have Turo Roadside tow the car to', 'queued')
  on conflict (reservation_id, kind) do update set body = excluded.body, status = 'queued', attempts = 0, last_error = null, updated_at = now()
    where turo_out_msgs.status in ('queued', 'failed', 'cancelled');
  update tire_incidents set status = 'picked', picked = sh || jsonb_build_object('idx', p_idx, 'at', now()), updated_at = now() where id = p_id;
  perform tire_desk_log(p_id, 'Jared picked ' || (sh->>'name') || '; tow plan queued for the Turo chat');
  perform car_tire_poke_reader();
  return jsonb_build_object('ok', true, 'queued', found);
end $fn$;

-- Jared approves the shop's tire quote: logged on the claim and confirmed in the Turo chat.
create or replace function public.tire_desk_approve(p_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare i tire_incidents; c uuid; note text := btrim(coalesce(p_note, ''));
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if length(note) < 3 then raise exception 'Say what you approved (brand and price).'; end if;
  select * into i from tire_incidents where id = p_id for update;
  if i.id is null then raise exception 'no such incident'; end if;
  insert into turo_out_msgs (reservation_id, kind, body, verify_snippet, status)
  values (i.reservation_id, 'tire_approve', 'Approved: ' || left(note, 200) || '. Go ahead with the tire. Please keep the receipt and add a photo of it to the trip in the Turo app.',
          'Go ahead with the tire', 'queued')
  on conflict (reservation_id, kind) do update set body = excluded.body, status = 'queued', attempts = 0, last_error = null, updated_at = now()
    where turo_out_msgs.status in ('queued', 'failed', 'cancelled');
  update tire_incidents set status = 'approved', approved = jsonb_build_object('note', left(note, 200), 'at', now()), updated_at = now() where id = p_id;
  perform tire_desk_log(p_id, 'Jared approved: ' || left(note, 200));
  select id into c from claim_cases where reservation_id = i.reservation_id;
  if c is not null then
    update claim_cases set facts = coalesce(facts || ' ', '') || 'Replacement tire approved by the host in the Turo chat on '
           || to_char(now() at time zone 'America/Los_Angeles', 'Mon FMDD at FMHH12:MI AM') || ': ' || left(note, 200)
           || coalesce(' at ' || (i.picked->>'name'), '') || '.', updated_at = now() where id = c;
    insert into claim_events (case_id, reservation_id, kind, title) values (c, i.reservation_id, 'note', 'Tire approved: ' || left(note, 160));
  end if;
  perform car_tire_poke_reader();
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.tire_desk_close(p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update tire_incidents set status = 'closed', closed_at = now(), updated_at = now() where id = p_id;
  perform tire_desk_log(p_id, 'Closed by Jared');
  return jsonb_build_object('ok', true);
end $fn$;

-- Edge function side (service role): move from one status to the next only if nobody else already did (no double calls).
create or replace function public.tire_desk_claim(p_id uuid, p_from text, p_to text) returns boolean
language plpgsql security definer set search_path to 'public' as $fn$
begin
  update tire_incidents set status = p_to, updated_at = now() where id = p_id and status = p_from;
  return found;
end $fn$;

-- Edge function side (service role): save a step's work.
create or replace function public.tire_desk_save(p_id uuid, p_patch jsonb, p_log text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
begin
  update tire_incidents set
    status = coalesce(p_patch->>'status', status), shops = coalesce(p_patch->'shops', shops), tesla = coalesce(p_patch->'tesla', tesla),
    net = coalesce(p_patch->'net', net), src = coalesce(p_patch->>'src', src),
    calls_at = coalesce((p_patch->>'calls_at')::timestamptz, calls_at), updated_at = now()
  where id = p_id;
  if p_log is not null then perform tire_desk_log(p_id, p_log); end if;
  return jsonb_build_object('ok', true);
end $fn$;

revoke all on function public.tire_desk_log(uuid, text), public.tire_desk_open(bigint, text), public.tire_desk_tick(),
  public.tire_desk_save(uuid, jsonb, text), public.car_tire_inbox_trg(), public.car_tire_evaluate(bigint) from public, anon, authenticated;
revoke all on function public.tire_desk_claim(uuid, text, text) from public, anon, authenticated;
grant execute on function public.tire_desk_save(uuid, jsonb, text), public.tire_desk_claim(uuid, text, text) to service_role;
grant execute on function public.tire_desk_admin(), public.tire_desk_start(bigint), public.tire_desk_pick(uuid, int),
  public.tire_desk_approve(uuid, text), public.tire_desk_close(uuid) to authenticated;

insert into public.notification_owners (prefix, agent_slug, note)
select 'car.tire.desk', 'car-guard', 'Flat Tire Desk (2026-10-29)'
where not exists (select 1 from public.notification_owners where prefix = 'car.tire.desk');
update public.bestly_agents
   set pulse = jsonb_set(pulse, '{also}', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
                 from jsonb_array_elements_text(coalesce(pulse->'also', '[]'::jsonb) || '["tire-desk"]'::jsonb) x)),
       updated_at = now()
 where slug = 'car-guard';
