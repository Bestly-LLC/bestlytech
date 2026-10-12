-- Leo's early-return check-in (2026-10-12). Additive only: policies are created if missing; the call session is channel 'phone' + purpose 'early_return'.
-- Jared's rule: a guest Tesla key follows the Turo reservation. If a guest brings the car back early, the car is still theirs until THEY change the
-- reservation in Turo, so nothing is ever revoked. When the car has been parked back at 733 N Kings Rd for 20 minutes and the trip still has 90+ minutes
-- to run, Leo asks once: "Are you finished with the car?" YES gets the steps to end the trip in the Turo app, NO gets a thank-you.
-- Channel: Leo CALLS the guest (ElevenLabs outbound from Leo's number); once texting is approved (leo_settings.sms_ready and sms_mode live) it TEXTS instead,
-- automatically. Never 9 PM to 8 AM Pacific. One ask per trip. No raw phone numbers are stored here (last four digits only).
-- Pieces: leo_early_return (one row per trip), leo_early_return_state (kill switch + detector health), the detector (cron leo-early-return, every 10 min),
-- the trip-voice ops early_return_go / early_return_settle / sms_in, the early_return_answer tool, and a leo_health_tick extension (retry once, then alert signed Leo).
-- No privacy_data_map row: the table holds no email or phone (to_last4 is a partial, like leo_sms_log).

create table if not exists public.leo_early_return (
  reservation_id bigint primary key,
  token text not null,                       -- the guest's trip token (lax_guest_links.token); how the answer tool finds the row
  detected_at timestamptz not null default now(),
  channel text check (channel in ('call', 'sms')),
  status text not null default 'pending' check (status in ('pending', 'asked', 'yes', 'no', 'unsure', 'no_answer', 'no_phone', 'failed', 'skipped')),
  attempts int not null default 0,
  asked_at timestamptz,
  answered_at timestamptz,
  conversation_id text,
  to_last4 text,
  unclear int not null default 0,            -- texts only: how many "Reply YES or NO" nudges we sent
  voicemail boolean not null default false,
  error text,
  retried_at timestamptz,
  alerted boolean not null default false,
  noted boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.leo_early_return enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leo_early_return' and policyname = 'leo_early_return_admin_read') then
    create policy leo_early_return_admin_read on public.leo_early_return for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));
  end if;
end $p$;
create index if not exists leo_early_return_status_idx on public.leo_early_return (status, updated_at);

create table if not exists public.leo_early_return_state (
  id int primary key check (id = 1),
  enabled boolean not null default false,     -- ships OFF; Jared/agent turns on after checks. kill switch: update leo_early_return_state set enabled = false
  detect_errors int not null default 0,
  last_ok_at timestamptz,
  last_error text
);
insert into public.leo_early_return_state (id) values (1) on conflict do nothing;
alter table public.leo_early_return_state enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leo_early_return_state' and policyname = 'leo_early_return_state_admin_read') then
    create policy leo_early_return_state_admin_read on public.leo_early_return_state for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));
  end if;
end $p$;

-- The early-return call is a phone session (channel 'phone') with purpose 'early_return'; trip-voice scopes it by purpose
-- (early_return_answer, notify_host, file_ticket, thin trip_status; no car, key or texts). Additive.
alter table public.trip_voice_sessions add column if not exists purpose text;

-- ---------- geometry ----------
create or replace function public.leo_er_m(a double precision, b double precision, c double precision, d double precision) returns double precision
language sql immutable parallel safe as $$
  select 2 * 6371000 * asin(least(1, sqrt(power(sin(radians(c - a) / 2), 2) + cos(radians(a)) * cos(radians(c)) * power(sin(radians(d - b) / 2), 2)))) $$;

-- Two spellings of home exist in the repo (733 N Kings Rd): take whichever is closer. 600 ft = 183 m.
create or replace function public.leo_er_home_m(p_lat double precision, p_lon double precision) returns double precision
language sql immutable parallel safe as $$
  select least(public.leo_er_m(p_lat, p_lon, 34.0838, -118.3708), public.leo_er_m(p_lat, p_lon, 34.084241, -118.371793)) $$;

-- ---------- detector ----------
-- One row per active real trip saying whether to ask and, if not, why not. Reads only; p_now lets tests pick the clock.
-- Parked = the newest car reading is fresh (35 min) and, walking back, every reading is within 600 ft of Kings Rd, not moving (speed 0 or null,
-- shift P or null) and within 150 ft of the newest one, for 20+ minutes. The trail has no shift or speed today, so position is what counts.
-- The car must also have been away (over half a mile) since the trip started, so a car still waiting at pickup never counts as "back".
create or replace function public.leo_early_return_eval(p_now timestamptz default now())
returns table(reservation_id bigint, token text, ok boolean, why text)
language plpgsql stable security definer set search_path = public as $$
declare
  t record; r record; v_hr int; v_why text; n int; lat0 double precision; lon0 double precision; at0 timestamptz; run_start timestamptz; away boolean;
begin
  v_hr := extract(hour from (p_now at time zone 'America/Los_Angeles'))::int;
  for t in
    select tt.reservation_id rid, tt.vin, tt.starts_at, tt.ends_at, tt.raw, g.token gtoken, g.returned_at, g.done_using_at
      from public.turo_trips tt join public.lax_guest_links g on g.reservation_id = tt.reservation_id
     where p_now >= tt.starts_at and p_now < tt.ends_at and coalesce(tt.status, '') !~* 'cancel'
  loop
    v_why := null; n := 0; run_start := null; lat0 := null; lon0 := null; at0 := null;
    if t.gtoken ilike 'demo%' or coalesce(t.raw ->> 'demo', '') = 'true' then v_why := 'demo trip';
    elsif v_hr < 8 or v_hr >= 21 then v_why := 'quiet hours (9 PM to 8 AM Pacific)';
    elsif t.ends_at - p_now < interval '90 minutes' then v_why := 'less than 90 minutes left on the trip';
    elsif exists (select 1 from public.leo_early_return e where e.reservation_id = t.rid) then v_why := 'already asked on this trip';
    elsif t.returned_at is not null or t.done_using_at is not null then v_why := 'trip already returned or marked done';
    elsif t.vin is null then v_why := 'no car on this trip';
    else
      for r in select c.at, c.lat, c.lon, c.speed_mph, c.shift from public.car_trail c
                where c.vin = t.vin and c.at <= p_now and c.at >= p_now - interval '8 hours' and c.lat is not null and c.lon is not null
                order by c.at desc
      loop
        n := n + 1;
        if n = 1 then
          if p_now - r.at > interval '35 minutes' then v_why := 'newest car location is stale'; exit; end if;
          lat0 := r.lat; lon0 := r.lon; at0 := r.at;
        end if;
        if public.leo_er_home_m(r.lat, r.lon) <= 183 and coalesce(r.speed_mph, 0) <= 0 and coalesce(upper(r.shift), 'P') = 'P'
           and public.leo_er_m(lat0, lon0, r.lat, r.lon) <= 46 then
          run_start := r.at;
        else
          if n = 1 then
            v_why := case when public.leo_er_home_m(r.lat, r.lon) > 183 then 'car is not parked near 733 N Kings Rd' else 'car is moving' end;
          end if;
          exit;
        end if;
      end loop;
      if v_why is null then
        if run_start is null then v_why := 'no recent car location';
        elsif at0 - run_start < interval '20 minutes' then v_why := 'parked for under 20 minutes';
        else
          select exists (select 1 from public.car_trail c where c.vin = t.vin and c.at >= t.starts_at and c.at < run_start
                            and c.lat is not null and c.lon is not null and public.leo_er_home_m(c.lat, c.lon) > 800) into away;
          if not away then v_why := 'car has not been away since the trip started'; end if;
        end if;
      end if;
    end if;
    reservation_id := t.rid; token := t.gtoken;
    ok := v_why is null;
    why := coalesce(v_why, 'parked near 733 N Kings Rd since ' || to_char(run_start at time zone 'America/Los_Angeles', 'FMHH12:MI AM'));
    return next;
  end loop;
end $$;

-- Cron job leo-early-return (every 10 min). Inserts the row (the "once per trip" lock) and hands the trip to trip-voice, which picks call or text.
-- Errors never escape: two in a row alert signed Leo from the detector itself; each next tick is the retry.
create or replace function public.leo_early_return_detect(p_dry boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e record; ids bigint[] := '{}'; en boolean;
begin
  select enabled into en from public.leo_early_return_state where id = 1;
  if not coalesce(en, false) then return jsonb_build_object('ok', true, 'skipped', 'switched off'); end if;
  begin
    for e in select * from public.leo_early_return_eval(now()) x where x.ok loop
      ids := ids || e.reservation_id;
      if not p_dry then
        insert into public.leo_early_return (reservation_id, token) values (e.reservation_id, e.token) on conflict do nothing;
        if found then
          perform public.invoke_edge_function('trip-voice', jsonb_build_object('op', 'early_return_go', 'reservation_id', e.reservation_id), 30000);
        end if;
      end if;
    end loop;
    update public.leo_early_return_state set detect_errors = 0, last_ok_at = now(), last_error = null where id = 1;
    perform public.bestly_raise('leo.early_return.detect', 'resolved', 'info', 'Leo: my early-return check runs again', 'The 10 minute check ran clean.', 'agents', null, true);
  exception when others then
    update public.leo_early_return_state set detect_errors = detect_errors + 1, last_error = left(sqlerrm, 300) where id = 1;
    if (select detect_errors from public.leo_early_return_state where id = 1) >= 2 then
      perform public.bestly_raise('leo.early_return.detect', 'problem', 'warning', 'Leo: my early-return check is failing',
        'The 10 minute check that spots a guest who returned early has failed twice in a row: ' || left(sqlerrm, 200) || '. No guest was contacted by mistake; early returns just are not being noticed until it is fixed.', 'agents', null, false);
    end if;
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'asked', to_jsonb(ids), 'dry', p_dry);
end $$;

-- ---------- the call's variables and its scoped session ----------
-- Same shape leo_phone_caller returns, plus purpose. Reuses a live early-return session for the trip so the call-start webhook and the outbound request agree.
create or replace function public.leo_early_return_vars(p_reservation_id bigint, p_dry boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.turo_trips; g public.lax_guest_links; k text;
begin
  select * into t from public.turo_trips where reservation_id = p_reservation_id;
  select * into g from public.lax_guest_links where reservation_id = p_reservation_id;
  if t.reservation_id is null or g.token is null then return null; end if;
  select s.key into k from public.trip_voice_sessions s
   where s.token = g.token and s.channel = 'phone' and s.purpose = 'early_return' and s.expires_at > now() + interval '30 minutes' order by s.created_at desc limit 1;
  if k is null then
    k := 'tv_' || encode(extensions.gen_random_bytes(24), 'hex');
    if not p_dry then
      insert into public.trip_voice_sessions (key, agent_slug, token, channel, purpose, expires_at) values (k, 'leo', g.token, 'phone', 'early_return', now() + interval '90 minutes');
    end if;
  end if;
  return jsonb_build_object('trip_key', k, 'call_mode', 'outbound', 'purpose', 'early_return', 'caller_type', 'guest',
    'guest_first_name', initcap(coalesce(nullif(trim(t.guest_first), ''), '')), 'trip_stage', 'active', 'pickup_place', 'home',
    'pickup_time_local', coalesce(t.local_start, ''),
    'return_time_local', to_char(t.ends_at at time zone 'America/Los_Angeles', 'FMDay, FMMonth FMDD "at" FMHH12:MI AM'),
    'car_name', 'Blue Steel', 'minutes_to_pickup', round(extract(epoch from t.starts_at - now()) / 60)::int, 'controls_state', 'unknown', 'greeting_offer', 'none');
end $$;

-- Jared's own test path: demo trip token, so the answer tool records nothing real. Used by trip-voice op early_return_test.
create or replace function public.leo_early_return_demo_vars(p_dry boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text := 'tv_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not p_dry then
    insert into public.trip_voice_sessions (key, agent_slug, token, channel, purpose, expires_at) values (k, 'leo', 'demo:demo-lax', 'phone', 'early_return', now() + interval '90 minutes');
  end if;
  return jsonb_build_object('trip_key', k, 'call_mode', 'outbound', 'purpose', 'early_return', 'caller_type', 'guest', 'guest_first_name', 'Jared',
    'trip_stage', 'active', 'pickup_place', 'home', 'pickup_time_local', '',
    'return_time_local', to_char((now() + interval '3 hours') at time zone 'America/Los_Angeles', 'FMDay, FMMonth FMDD "at" FMHH12:MI AM'),
    'car_name', 'Blue Steel (demo)', 'minutes_to_pickup', -120, 'controls_state', 'unknown', 'greeting_offer', 'none');
end $$;

-- leo-phone-init asks this at call start: is a placed early-return call waiting for this number? (matched by the trip's phone, never stored here)
create or replace function public.leo_early_return_pending_call(p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10); rid bigint;
begin
  if length(d) < 7 then return null; end if;
  select e.reservation_id into rid
    from public.leo_early_return e
    join public.turo_trips t on t.reservation_id = e.reservation_id
    left join public.lax_guest_links g on g.reservation_id = e.reservation_id
   where e.channel = 'call' and e.status = 'asked' and e.asked_at > now() - interval '10 minutes'
     and (right(regexp_replace(coalesce(t.guest_phone, ''), '\D', '', 'g'), 10) = d or right(regexp_replace(coalesce(g.sms_phone, ''), '\D', '', 'g'), 10) = d)
   order by e.asked_at desc limit 1;
  if rid is null then return null; end if;
  return public.leo_early_return_vars(rid);
end $$;

-- A text reply came in from this number: which early-return text is it answering?
create or replace function public.leo_early_return_match_sms(p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10); e public.leo_early_return;
begin
  if length(d) < 10 then return null; end if;
  select e2.* into e
    from public.leo_early_return e2
    join public.turo_trips t on t.reservation_id = e2.reservation_id
    left join public.lax_guest_links g on g.reservation_id = e2.reservation_id
   where e2.channel = 'sms' and e2.status in ('asked', 'no_answer') and e2.asked_at > now() - interval '24 hours'
     and (right(regexp_replace(coalesce(t.guest_phone, ''), '\D', '', 'g'), 10) = d or right(regexp_replace(coalesce(g.sms_phone, ''), '\D', '', 'g'), 10) = d)
   order by e2.asked_at desc limit 1;
  if e.reservation_id is null then return null; end if;
  return jsonb_build_object('reservation_id', e.reservation_id, 'token', e.token, 'unclear', e.unclear);
end $$;

-- ---------- the answer ----------
-- Recap-only note signed Leo. A direct admin_notifications row with severity 'success' is silent (admin_notifications_classify) and counts in the 7 PM recap
-- (autonomy_recap). It never goes through notify_route or bestly_raise, so it cannot interrupt Jared. Unique dedupe key per trip and outcome.
create or replace function public.leo_early_return_note(p_reservation_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare e public.leo_early_return; f text; ttl text; ends_txt text;
begin
  select * into e from public.leo_early_return where reservation_id = p_reservation_id;
  if e.reservation_id is null then return; end if;
  select coalesce(nullif(initcap(trim(t.guest_first)), ''), 'The guest'),
         to_char(t.ends_at at time zone 'America/Los_Angeles', 'FMDay FMMonth FMDD "at" FMHH12:MI AM')
    into f, ends_txt from public.turo_trips t where t.reservation_id = p_reservation_id;
  ttl := case e.status
    when 'yes' then 'Leo: ' || f || ' is finished early, told them how to end the trip in Turo'
    when 'no' then 'Leo: ' || f || ' is still on the trip'
    when 'unsure' then 'Leo: ' || f || ' was not sure if they are finished, so the trip stays as booked'
    when 'no_answer' then 'Leo: ' || f || ' did not answer' || case when e.voicemail then ', left a voicemail' when e.channel = 'sms' then ' to my text' else '' end
    when 'no_phone' then 'Leo: no phone number for ' || f || ', so I could not check if they are finished'
    else null end;
  if ttl is null then return; end if;
  insert into public.admin_notifications (kind, title, body, entity_key, severity, dedupe_key, agent_slug)
    values ('leo', ttl,
            'The car looked parked back at Kings Rd while the trip runs until ' || ends_txt || '. I did not touch the key: it stays on until the reservation ends or the guest changes it in Turo.',
            'leo:early_return:' || p_reservation_id, 'success', 'leo-early-return-' || p_reservation_id || '-' || e.status, 'leo')
    on conflict (dedupe_key) do nothing;
  update public.leo_early_return set noted = true where reservation_id = p_reservation_id;
end $$;

create or replace function public.leo_early_return_answer(p_token text, p_answer text, p_conversation text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.leo_early_return; a text := lower(coalesce(p_answer, ''));
begin
  if a not in ('yes', 'no', 'unsure') then return jsonb_build_object('ok', false, 'error', 'answer must be yes, no or unsure'); end if;
  if coalesce(p_token, '') like 'demo:%' then return jsonb_build_object('ok', true, 'demo', true, 'recorded', false, 'note', 'demo call: nothing was saved'); end if;
  select * into e from public.leo_early_return where token = p_token for update;
  if e.reservation_id is null then return jsonb_build_object('ok', false, 'error', 'no early-return check-in is open for this trip'); end if;
  if e.status in ('yes', 'no', 'unsure') then return jsonb_build_object('ok', true, 'recorded', true, 'already', e.status); end if;
  update public.leo_early_return
     set status = a, answered_at = now(), conversation_id = coalesce(conversation_id, nullif(p_conversation, '')), updated_at = now(), error = null
   where reservation_id = e.reservation_id;
  perform public.leo_early_return_note(e.reservation_id);
  return jsonb_build_object('ok', true, 'recorded', true);
end $$;

-- ---------- watchdog ----------
-- Called from leo_health_tick every 10 min. Settles calls and texts nobody answered (trip-voice early_return_settle), retries a stuck or failed ask ONCE,
-- and alerts signed Leo only when the retry did not fix it.
create or replace function public.leo_early_return_watch() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; retried int := 0; bad int := 0;
begin
  perform public.invoke_edge_function('trip-voice', '{"op":"early_return_settle"}'::jsonb, 30000);
  for r in
    select e.reservation_id from public.leo_early_return e join public.turo_trips t on t.reservation_id = e.reservation_id
     where e.retried_at is null and t.ends_at > now() + interval '45 minutes'
       and ((e.status = 'pending' and e.updated_at < now() - interval '12 minutes')
         or (e.status = 'failed' and e.attempts < 2 and e.updated_at < now() - interval '5 minutes'))
  loop
    update public.leo_early_return set retried_at = now(), status = 'pending', updated_at = now() where reservation_id = r.reservation_id;
    perform public.invoke_edge_function('trip-voice', jsonb_build_object('op', 'early_return_go', 'reservation_id', r.reservation_id), 30000);
    retried := retried + 1;
  end loop;
  -- Still broken after the one retry (or the trip ended first): tell Jared once per trip, signed Leo.
  for r in
    select e.reservation_id, e.status, e.error from public.leo_early_return e
     where not e.alerted and e.detected_at > now() - interval '48 hours'
       and ((e.status = 'failed' and (e.attempts >= 2 or e.retried_at is not null))
         or (e.status = 'pending' and e.retried_at is not null and e.updated_at < now() - interval '12 minutes'))
  loop
    update public.leo_early_return set alerted = true, status = 'failed', updated_at = now() where reservation_id = r.reservation_id;
    perform public.bestly_raise('leo.early_return', 'problem', 'warning', 'Leo: I could not check in with a guest who returned early',
      'The car looked parked back at Kings Rd with time left on the trip, but my call or text did not go through after one retry (' || coalesce(left(r.error, 120), 'no detail') || '). The key stays on until the reservation ends. Nothing was revoked.', 'agents', null, false);
    bad := bad + 1;
  end loop;
  if not exists (select 1 from public.leo_early_return where status in ('failed') and alerted and updated_at > now() - interval '24 hours') then
    perform public.bestly_raise('leo.early_return', 'resolved', 'info', 'Leo: early-return check-ins are going out again', 'No failed check-ins in the last day.', 'agents', null, true);
  end if;
  return jsonb_build_object('retried', retried, 'alerted', bad);
end $$;

-- ---------- grants: everything here is called by pg_cron (postgres) or an edge function (service role) ----------
do $$ declare f text; begin
  foreach f in array array[
    'leo_er_m(double precision,double precision,double precision,double precision)', 'leo_er_home_m(double precision,double precision)',
    'leo_early_return_eval(timestamptz)', 'leo_early_return_detect(boolean)', 'leo_early_return_vars(bigint,boolean)', 'leo_early_return_demo_vars(boolean)',
    'leo_early_return_pending_call(text)', 'leo_early_return_match_sms(text)', 'leo_early_return_note(bigint)',
    'leo_early_return_answer(text,text,text)', 'leo_early_return_watch()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---------- inbound-text secret (service only): the URL token Telnyx calls back with, plus the Telnyx public key if Jared ever pastes it ----------
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'leo_sms_in_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'leo_sms_in_token', 'URL token for Leo inbound text replies (early-return YES/NO)');
  end if;
end $$;
create or replace function public.leo_sms_in_secret(p_name text) returns text
language plpgsql stable security definer set search_path = public, vault as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Service role only'; end if;
  if p_name not in ('leo_sms_in_token', 'telnyx_public_key') then raise exception 'leo_sms_in_secret: % is not an inbound-text secret', p_name; end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1);
end $$;
revoke all on function public.leo_sms_in_secret(text) from public, anon, authenticated;
grant execute on function public.leo_sms_in_secret(text) to service_role;

