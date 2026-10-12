-- Leo server-side gaps (2026-10-12), found on real calls:
--  1. A held key (license + check-in not confirmed yet) was reported as status "ready, link is on the page", so Leo told a guest the
--     link was ready and ran key_fix resend. lax_agent_diag / lax_agent_act drifted into the DB without a migration; this recreates both
--     (live definitions captured 2026-10-12) with the held rule in one helper, lax_key_held().
--  2. Phone callers got trip_key "none" so every tool failed. leo_phone_caller now mints a SCOPED session: matched guest = "phone"
--     (trip_status / notify_host / file_ticket / reminder_email only), anyone else = "phone_unknown" (file_ticket + notify_host only),
--     Jared's own cell = "phone_test" (demo trip, full tools). Scope is enforced in trip-voice, not in the prompt.
--  3. leo_tool_log: one row per tool call (no personal data) so the watchdog can see error rates.
--  4. leo_health_tick + cron leo-health (every 10 min): client-diag spikes, tool error rate, trip_key wiring. Signed Leo alerts via bestly_raise.
-- All service-role only; nothing here is callable with the public key.

-- ---------- sessions get a channel ----------
alter table public.trip_voice_sessions add column if not exists channel text not null default 'page';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'trip_voice_sessions_channel_check') then
    alter table public.trip_voice_sessions add constraint trip_voice_sessions_channel_check check (channel in ('page', 'phone', 'phone_unknown', 'phone_test'));
  end if;
end $$;

-- ---------- tool-call log (no names, phones, emails or tokens) ----------
create table if not exists public.leo_tool_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  tool text not null,
  channel text not null default 'page',
  demo boolean not null default false,
  ok boolean not null,
  code text not null default 'ok'   -- ok | refused | error | no_trip | session
);
alter table public.leo_tool_log enable row level security;
revoke all on public.leo_tool_log from anon, authenticated;
create index if not exists leo_tool_log_at on public.leo_tool_log (at desc);

-- ---------- the held rule, in one place ----------
-- Returns null when the guest's key link is (or may be) visible; otherwise why it is hidden and what to tell the guest.
create or replace function public.lax_key_held(p_reservation bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t turo_trips; k tesla_guest_keys;
begin
  select * into t from turo_trips where reservation_id = p_reservation;
  select * into k from tesla_guest_keys where reservation_id = p_reservation;
  if t.reservation_id is null or not tesla_key_kind_ok(t.airport_code, t.starts_at) then return null; end if;
  if coalesce(k.status, '') in ('accepted', 'removing', 'removed', 'off') or public.guest_key_released(p_reservation) then return null; end if;
  return jsonb_build_object(
    'why', 'The key link stays hidden until the host confirms the driver''s license and finishes the car check-in (photos, staging). Nothing to fix and do not resend or make the key: it appears on the page by itself the moment the host confirms.',
    'waiting_on_license', k.license_ok_at is null, 'waiting_on_host_checkin', k.checkin_ok_at is null,
    'tell_guest', case when k.license_ok_at is null
      then 'If you have not uploaded your driver''s license in the Turo app yet, do it now (Turo app, your trip, driver''s license). Your host checks it and gets the car ready, then your key shows up on your trip page by itself.'
      else 'Your host is getting the car ready. Your key shows up on your trip page by itself as soon as it is.' end);
end $$;
revoke all on function public.lax_key_held(bigint) from public, anon, authenticated;
grant execute on function public.lax_key_held(bigint) to service_role;

-- ---------- lax_agent_diag: held keys read as "held" and expose no link fields ----------
create or replace function public.lax_agent_diag(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l lax_guest_links; t turo_trips; k tesla_guest_keys; ks tesla_key_settings; fs tesla_fleet_settings; v turo_vehicle_state; ctl jsonb; jobs jsonb; xd jsonb; kh jsonb;
begin
  select * into l from lax_guest_links where token = p_token;
  if l.reservation_id is null then return jsonb_build_object('error', 'trip not found'); end if;
  select * into t from turo_trips where reservation_id = l.reservation_id;
  select * into k from tesla_guest_keys where reservation_id = l.reservation_id;
  select * into ks from tesla_key_settings where id = 1;
  select * into fs from tesla_fleet_settings where id = 1;
  select * into v from turo_vehicle_state order by updated_at desc limit 1;
  ctl := lax_trip_controls(l.reservation_id);
  kh := public.lax_key_held(l.reservation_id);
  select coalesce(jsonb_agg(jsonb_build_object('action', c.action, 'status', c.status, 'at', lax_ask_fmt(c.created_at), 'via', c.via,
           'error', c.result->>'error', 'extra_driver', c.args->>'extra') order by c.id desc), '[]'::jsonb)
    into jobs from (select * from tesla_fleet_commands where reservation_id = l.reservation_id order by id desc limit 6) c;
  select coalesce(jsonb_agg(jsonb_build_object('name', d.name, 'status', d.status, 'approved_by', d.approved_by, 'error', d.last_error)), '[]'::jsonb)
    into xd from trip_extra_drivers d where d.reservation_id = l.reservation_id and d.status <> 'cancelled';
  return jsonb_build_object(
    'now', lax_ask_fmt(now()),
    'trip', jsonb_build_object('kind', lax_trip_kind(t.airport_code), 'pickup', lax_ask_fmt(t.starts_at), 'return', lax_ask_fmt(t.ends_at),
        'phase', case when now() < t.starts_at - interval '2 hours' then 'before key window' when now() < t.starts_at then 'key window, before pickup'
                      when now() < t.ends_at then 'on trip' else 'ended' end,
        'minutes_to_pickup', round(extract(epoch from (t.starts_at - now())) / 60), 'minutes_to_return', round(extract(epoch from (t.ends_at - now())) / 60)),
    'key', case when not (tesla_key_kind_ok(t.airport_code, t.starts_at)) then jsonb_build_object('status', 'not used on this trip')
      when kh is not null then jsonb_build_object('status', 'held', 'meaning', kh->>'why', 'held', kh)
      else jsonb_build_object('status', coalesce(k.status, 'scheduled'),
        'meaning', case coalesce(k.status,'scheduled') when 'scheduled' then 'not made yet; auto-made ' || lax_ask_fmt(t.starts_at - ks.lead_time)
          when 'creating' then 'being made right now' when 'ready' then 'invite link is on the page; guest must tap it and accept in the Tesla app'
          when 'accepted' then 'guest accepted; the car should be in their Tesla app' when 'expired' then 'invite expired (24h); a new one is made automatically'
          when 'failed' then 'last attempt failed' when 'removing' then 'being removed (or reset)' when 'removed' then 'access removed' else k.status end,
        'invite_made', lax_ask_fmt(k.ready_at), 'invite_expires', lax_ask_fmt(k.invite_expires_at), 'accepted_at', lax_ask_fmt(k.accepted_at),
        'tesla_account_name', k.driver_name, 'last_error', k.last_error, 'resends', k.resends) end,
    'extra_drivers', xd,
    'car', jsonb_build_object('battery', v.battery_pct, 'inside_f', v.inside_temp, 'connection', v.connection_state, 'locked', v.locked,
        'reading_age_min', round(extract(epoch from (now() - v.observed_at)) / 60)),
    'buttons', jsonb_build_object('climate', ctl->>'state', 'opens_at', lax_ask_fmt((ctl->>'opens_at')::timestamptz)),
    'systems', jsonb_build_object('tezlab_connected', tezlab_ready(), 'mac_helper_online', fs.worker_seen_at > now() - interval '10 minutes',
        'mac_helper_last_seen', lax_ask_fmt(fs.worker_seen_at), 'last_tesla_error', fs.last_error),
    'supercharging', case when now() >= t.starts_at then (select jsonb_build_object(
        'total_usd', c->'total', 'stops', c->'count', 'kwh', c->'kwh', 'idle_fees_usd', c->'idle',
        'amounts_are', case when (c->>'final')::boolean then 'final, from Tesla billing' else 'estimates from the car log (Tesla final bill comes after the trip)' end,
        'updated', lax_ask_fmt((c->>'updated_at')::timestamptz),
        'stops_list', (select jsonb_agg(jsonb_build_object('when', lax_ask_fmt((x->>'at')::timestamptz), 'where', x->>'place', 'usd', round(coalesce((x->>'cost')::numeric,0) + coalesce((x->>'idle')::numeric,0), 2), 'kwh', x->'kwh'))
                       from jsonb_array_elements(c->'sessions') x),
        'how_it_works', 'Supercharging bills to the car''s Tesla account; the host sends the total through Turo as a reimbursement request after the trip. The page shows each stop and has a Download receipt (PDF) button.')
      from (select trip_charges_for(t.reservation_id) c) q) else jsonb_build_object('note', 'trip has not started; no charging yet') end,
    'recent_jobs', jobs);
end $$;

-- ---------- lax_agent_act: check_key / resend_key / make_key_now refuse while the key is held ----------
create or replace function public.lax_agent_act(p_token text, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l lax_guest_links; t turo_trips; k tesla_guest_keys; ks tesla_key_settings; n int; r jsonb; jid bigint; kh jsonb;
begin
  select * into l from lax_guest_links where token = p_token;
  if l.reservation_id is null then return jsonb_build_object('ok', false, 'error', 'trip not found'); end if;
  select * into t from turo_trips where reservation_id = l.reservation_id;
  select * into k from tesla_guest_keys where reservation_id = l.reservation_id;
  select * into ks from tesla_key_settings where id = 1;
  -- At most 8 agent actions per trip per hour.
  select count(*) into n from lax_guest_events where reservation_id = l.reservation_id and kind = 'agent' and at > now() - interval '1 hour';
  if n >= 8 then return jsonb_build_object('ok', false, 'error', 'too many fixes tried in the last hour; tell the guest the host has been alerted'); end if;

  -- A held key has no link on the page yet: nothing to check, resend or make. Say why, touch nothing.
  if p_action in ('check_key', 'resend_key', 'make_key_now') then
    kh := public.lax_key_held(l.reservation_id);
    if kh is not null then
      return jsonb_build_object('ok', false, 'held', true, 'error', kh->>'why', 'tell_guest', kh->>'tell_guest');
    end if;
  end if;

  if p_action = 'check_key' then
    if k.status not in ('ready','accepted') then return jsonb_build_object('ok', false, 'error', 'no invite out to check (status ' || coalesce(k.status,'scheduled') || ')'); end if;
    if not tesla_key_enqueue(l.reservation_id, 'key_check', jsonb_build_object('invite_id', k.invite_id, 'baseline', coalesce(k.baseline_drivers, '[]'::jsonb)))
      then return jsonb_build_object('ok', false, 'error', 'a key job is already running; wait a moment'); end if;
    select max(id) into jid from tesla_fleet_commands where reservation_id = l.reservation_id;
    r := jsonb_build_object('ok', true, 'job', jid, 'note', 'asked Tesla which drivers are on the car');

  elsif p_action = 'resend_key' then
    if now() > t.ends_at or now() < t.starts_at - ks.lead_time then return jsonb_build_object('ok', false, 'error', 'outside the key window (' || lax_ask_fmt(t.starts_at - ks.lead_time) || ' to trip end)'); end if;
    -- Don't undo a key that just worked, or replace a link the guest hasn't had time to tap.
    if k.status = 'accepted' and k.accepted_at > now() - interval '20 minutes' then
      return jsonb_build_object('ok', false, 'error', 'the key was accepted ' || round(extract(epoch from now() - k.accepted_at) / 60) || ' min ago and is working on Tesla''s side. Do NOT resend. Tell the guest: fully close and reopen the Tesla app (or pull down to refresh) and make sure they are signed in to the same Tesla account they accepted with; the car can take a few minutes to appear.');
    end if;
    if k.status = 'ready' and k.ready_at > now() - interval '5 minutes' then
      return jsonb_build_object('ok', false, 'error', 'a fresh key link was made ' || round(extract(epoch from now() - k.ready_at) / 60) || ' min ago. Do NOT resend; tell the guest to tap Add the car to my Tesla app on their page, signed in to the Tesla account they will drive with.');
    end if;
    select count(*) into n from lax_guest_events where reservation_id = l.reservation_id and kind = 'agent' and detail->>'action' = 'resend_key' and at > now() - interval '6 hours';
    if n >= 2 then return jsonb_build_object('ok', false, 'error', 'already resent twice in 6 hours; escalate to the host'); end if;
    r := tesla_key_admin(l.reservation_id, 'resend');
    select max(id) into jid from tesla_fleet_commands where reservation_id = l.reservation_id;
    r := jsonb_build_object('ok', true, 'job', jid, 'note', 'old invite cancelled; a fresh key link appears on the page in about 30 seconds');

  elsif p_action = 'make_key_now' then
    if coalesce(k.status,'scheduled') not in ('scheduled','failed','expired') then return jsonb_build_object('ok', false, 'error', 'key is ' || k.status || ', nothing to make'); end if;
    if now() < t.starts_at - interval '3 hours' or now() > t.ends_at then return jsonb_build_object('ok', false, 'error', 'too early: keys can be made from ' || lax_ask_fmt(t.starts_at - interval '3 hours')); end if;
    r := tesla_key_admin(l.reservation_id, 'make');
    select max(id) into jid from tesla_fleet_commands where reservation_id = l.reservation_id;
    r := jsonb_build_object('ok', true, 'job', jid, 'note', 'making the key now');

  elsif p_action = 'refresh_car' then
    insert into tesla_fleet_commands (reservation_id, action, auto) values (l.reservation_id, 'refresh', true) returning id into jid;
    r := jsonb_build_object('ok', true, 'job', jid, 'note', 'asked the car for a fresh reading');

  elsif p_action = 'notify_host' then
    perform scout_notify(coalesce(t.guest_first, 'Guest') || ' needs you (trip helper)', left(coalesce(p_note, 'The trip helper could not fix it.'), 400),
      'critical', true, '/admin/turo/lax-pass#keys', 'agent.host.' || l.reservation_id || '.' || to_char(now(), 'YYYYMMDDHH24'));
    r := jsonb_build_object('ok', true, 'note', 'host alerted on his phone');
  else
    return jsonb_build_object('ok', false, 'error', 'unknown action');
  end if;

  insert into lax_guest_events (reservation_id, kind, detail) values (l.reservation_id, 'agent', jsonb_build_object('action', p_action, 'note', left(p_note, 300), 'result', r));
  if p_action in ('resend_key','make_key_now') then
    perform scout_notify('Trip helper fixed something for ' || coalesce(t.guest_first, 'a guest'),
      'It ran "' || replace(p_action, '_', ' ') || '"' || coalesce(' because: ' || left(p_note, 200), '') || '.', 'info', false, '/admin/turo/lax-pass#keys',
      'agent.fix.' || l.reservation_id || '.' || p_action || '.' || to_char(now(), 'YYYYMMDDHH24'));
  end if;
  return r;
end $$;

-- ---------- phone line: scoped sessions for every caller ----------
-- Caller ID can be spoofed, so a phone session is never as strong as the trip page's own link. trip-voice enforces:
--   phone          trip_status (no key link), notify_host, file_ticket, reminder_email, info
--   phone_unknown  file_ticket + notify_host only
--   phone_test     Jared's own cell: demo trip, pretend car, every tool
-- Matching: full E.164 digits OR last 10 digits (so +82 / other international numbers work), against the trip's Turo phone or the
-- number the guest gave for texts. Cancelled trips never match.
create or replace function public.leo_phone_caller(p_caller text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  f text := regexp_replace(coalesce(p_caller,''), '\D', '', 'g');
  d text := right(regexp_replace(coalesce(p_caller,''), '\D', '', 'g'), 10);
  t public.turo_trips;
  gl public.lax_guest_links;
  stage text := 'none';
  place text := 'unknown';
  k text := 'tv_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  if auth.role() <> 'service_role' then raise exception 'Service role only'; end if;
  if d = '8165007236' then
    insert into public.trip_voice_sessions(key, agent_slug, token, channel, expires_at) values (k, 'leo', 'demo:demo-lax', 'phone_test', now() + interval '90 minutes');
    return jsonb_build_object('trip_key', k, 'call_mode', 'phone', 'caller_type', 'test_guest', 'guest_first_name', 'Jared',
      'trip_stage', 'active', 'pickup_place', 'lax', 'pickup_time_local', '', 'return_time_local', '', 'car_name', 'Blue Steel (demo)',
      'minutes_to_pickup', -120, 'controls_state', 'on');
  end if;
  if length(f) >= 7 then
    select g.* into gl
      from public.lax_guest_links g join public.turo_trips tt on tt.reservation_id = g.reservation_id
     where coalesce(tt.status,'') !~* 'cancel'
       and tt.ends_at > now() - interval '2 days'
       and tt.starts_at < now() + interval '7 days'
       and (   regexp_replace(coalesce(tt.guest_phone,''), '\D', '', 'g') = f
            or right(regexp_replace(coalesce(tt.guest_phone,''), '\D', '', 'g'), 10) = d
            or regexp_replace(coalesce(g.sms_phone,''), '\D', '', 'g') = f
            or right(regexp_replace(coalesce(g.sms_phone,''), '\D', '', 'g'), 10) = d)
     order by abs(extract(epoch from (tt.starts_at - now()))) limit 1;
    if gl.reservation_id is not null then select * into t from public.turo_trips where reservation_id = gl.reservation_id; end if;
  end if;
  if t.reservation_id is null or gl.token is null then
    insert into public.trip_voice_sessions(key, agent_slug, token, channel, expires_at) values (k, 'leo', 'phone:unknown', 'phone_unknown', now() + interval '90 minutes');
    return jsonb_build_object('trip_key', k, 'call_mode', 'phone', 'caller_type', 'unknown', 'guest_first_name', '',
      'trip_stage', 'none', 'pickup_place', 'unknown', 'car_name', 'Blue Steel');
  end if;
  insert into public.trip_voice_sessions(key, agent_slug, token, channel, expires_at) values (k, 'leo', gl.token, 'phone', now() + interval '90 minutes');
  stage := case when now() < t.starts_at then 'upcoming' when now() <= t.ends_at or coalesce(t.in_progress,false) then 'active' else 'ended' end;
  place := case when t.airport_code is not null then 'lax'
                when coalesce(t.pickup_address,'') ~* '(kings|90069)' then 'home'
                else 'delivery' end;
  return jsonb_build_object('trip_key', k, 'call_mode', 'phone', 'caller_type', 'guest',
    'guest_first_name', coalesce(t.guest_first,''), 'trip_stage', stage, 'pickup_place', place,
    'pickup_time_local', coalesce(t.local_start,''), 'return_time_local', coalesce(t.local_end,''), 'car_name', 'Blue Steel',
    'starts_at', t.starts_at, 'ends_at', t.ends_at,
    'minutes_to_pickup', round(extract(epoch from t.starts_at - now())/60)::int, 'controls_state', 'unknown');
end $$;
revoke all on function public.leo_phone_caller(text) from public, anon, authenticated;
grant execute on function public.leo_phone_caller(text) to service_role;

-- ---------- watchdog: leo-health, every 10 minutes, free (pg_cron, no AI) ----------
-- Raises signed Leo alerts (notification owner prefix "leo." -> Leo). Warnings are held for the 7 PM recap by notify_route; the only thing
-- that interrupts is "guests are blocked and it has been down over an hour", worded as the "still down" kind of news it truly is.
-- Heals what it can: the call-start webhook is re-checked (leo-phone-watch) and the demo-car self-test are re-run. Old sessions and tool-log rows are trimmed by trip-voice's hourly selftest.
-- Enum drift of Leo's ElevenLabs client tools is NOT checked: nothing in the repo or DB stores the expected enums (Switchboard's agent-watch
-- only re-attaches tool_ids), so there is nothing to compare against.
create or replace function public.leo_health_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  diag_n int; diag_recent int; diag_kinds text;
  calls int; errs int; errs_recent int; no_trip int; sess_fail int; open_fail int;
  tools_bad boolean; blocked boolean; diag_bad boolean; opened timestamptz; why text; healed boolean := false;
begin
  -- 1. Leo's screen failing on real devices (demo pages excluded)
  select count(*), count(*) filter (where at > now() - interval '10 minutes'), string_agg(distinct kind, ', ')
    into diag_n, diag_recent, diag_kinds
    from public.leo_client_diag
   where at > now() - interval '30 minutes' and kind in ('start', 'sdk', 'csp', 'audio_locked', 'page_action') and coalesce(token, '') not like 'demo%';
  diag_bad := diag_n >= 5 and diag_recent >= 1;
  if diag_bad then
    perform public.bestly_raise('leo.health.screen', 'problem', 'warning', 'Leo: guests are hitting trouble starting a voice chat',
      diag_n || ' failures (' || diag_kinds || ') from guests'' phones and browsers in the last 30 minutes. They can still type to me or message the host.', 'agents', null, false);
  else
    perform public.bestly_raise('leo.health.screen', 'resolved', 'info', 'Leo: voice chat starts normally again', 'No new failures from guests'' devices.', 'agents', null, true);
  end if;

  -- 2. Tool calls: errors, missing trip keys, failed session checks (real guests and callers only)
  select count(*) filter (where code in ('ok', 'refused', 'error')),
         count(*) filter (where code = 'error'),
         count(*) filter (where code = 'error' and at > now() - interval '10 minutes'),
         count(*) filter (where code = 'no_trip'),
         count(*) filter (where code = 'session'),
         count(*) filter (where tool = 'session_open' and code = 'error')
    into calls, errs, errs_recent, no_trip, sess_fail, open_fail
    from public.leo_tool_log where at > now() - interval '30 minutes' and not demo and channel <> 'phone_test';
  tools_bad := (calls >= 5 and errs::numeric / calls >= 0.4 and errs_recent >= 1) or (errs >= 3 and errs_recent >= 1)
            or (no_trip >= 3) or (sess_fail >= 3) or (open_fail >= 2);
  blocked := (calls >= 5 and errs = calls) or no_trip >= 3 or sess_fail >= 3 or open_fail >= 2;
  if tools_bad then
    why := case when no_trip >= 3 then no_trip || ' tool calls arrived without a trip key (the call-start wiring may have drifted)'
                when sess_fail >= 3 then sess_fail || ' tool calls could not be verified against a live call'
                when open_fail >= 2 then 'the voice platform refused ' || open_fail || ' guest sessions'
                else errs || ' of ' || calls || ' tool calls failed' end;
    select opened_at into opened from public.monitor_issues where key = 'leo.health.tools' and status = 'open';
    if blocked and opened is not null and opened < now() - interval '60 minutes' then
      perform public.bestly_raise('leo.health.tools', 'problem', 'error', 'Leo: voice chat still down for guests',
        'Guests have been blocked for over an hour: ' || why || '. I already re-checked my phone line and demo car; this needs a person.', 'agents', 'Open Leo in the admin and check the tool log', false);
    else
      perform public.bestly_raise('leo.health.tools', 'problem', 'warning', 'Leo: my tools are failing for some guests',
        why || ' in the last 30 minutes. ' || case when blocked then 'Guests are blocked, so I am retrying my own checks.' else 'Most guests still get through.' end, 'agents', null, false);
    end if;
    -- self-heal, at most every 30 minutes: re-check the call-start webhook and run the demo-car self-test (it also resets the demo car)
    if not exists (select 1 from public.monitor_events where key = 'leo.health.tools' and title like '%self-heal%' and created_at > now() - interval '30 minutes') then
      begin
        perform public.leo_phone_watch_tick();
        perform public.invoke_edge_function('trip-voice', '{"op":"selftest"}'::jsonb, 30000);
        insert into public.monitor_events (key, kind, severity, title, body, pushed)
          values ('leo.health.tools', 'problem', 'info', 'Leo: self-heal ran', 'Re-checked the phone webhook and ran the demo-car self-test.', false);
        healed := true;
      exception when others then null;
      end;
    end if;
  else
    perform public.bestly_raise('leo.health.tools', 'resolved', 'info', 'Leo: my tools are working again', 'Tool calls are succeeding.', 'agents', null, true);
  end if;

  return jsonb_build_object('ok', not (diag_bad or tools_bad), 'screen_failures_30m', diag_n, 'tool_calls_30m', calls, 'tool_errors_30m', errs,
    'no_trip_30m', no_trip, 'session_fail_30m', sess_fail, 'blocked', blocked, 'self_heal_ran', healed);
end $$;
revoke all on function public.leo_health_tick() from public, anon, authenticated;
grant execute on function public.leo_health_tick() to service_role;

select cron.schedule('leo-health', '*/10 * * * *', $c$select public.leo_health_tick()$c$);

-- Team card: update Leo's existing card (same slug), add the new job to his pulse and what he does.
select public.team_onboard($j$[
 {"slug":"leo","name":"Leo","role":"Turo trip helper (voice)","reports_to":"jared","dept":"turo","runs_on":"cloud","icon":"phone-call","welcome":false,
  "schedule":"answers calls; Switchboard checks his line every 10 min; health watchdog every 10 min; demo car self-test hourly at :23","admin_url":"/admin/agents/leo","sort":62,
  "what_it_does":"Talks with Turo guests by voice from the Talk to Leo button on their trip page and by phone: checks their Tesla key and sends a fresh one (never while the key is held for the license and check-in), checks extra drivers, runs the car buttons (climate, lock, Supercharger navigation), answers Supercharging and return-charge questions, opens things on their trip page, alerts Jared when a guest needs him, and files tickets. On the phone he can only look up the trip, take a message and set up the reminder email, because caller ID can be faked; car and key actions need the trip page link. Every 10 minutes he checks that guests can start a voice chat and that his tools are succeeding, retries his own phone webhook and demo-car test if not, and tells you (signed Leo) only if guests stay blocked for over an hour. Every hour at :23 he runs his own test on the demo car and checks that unlock is still refused on real trips. Switchboard watches his line and tools.",
  "pulse":{"src":"at","table":"agent_health","col":"checked_at","ok":"ok","sum":"case when ok then 'Line OK' else 'Line problem' end","where":"agent_slug = 'leo'","gap":30,"alert":true,"on_demand":true,
           "also":["agent-watch","leo-phone-watch","leo-demo-parity","leo-client-diag-trim","leo-health"]},
  "owns":["leo","leo.","agent.line.leo"]}
]$j$::jsonb);
