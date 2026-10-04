-- RoofGuard go-live kit (Spark, 2026-10-04). Still OFF: nothing here dials on its own.
--
--   Test mode       rg_settings.test_phone; "Call my phone" runs one real call to that number with a real
--                   lead's script, logged as is_test so it never touches the lead or the A/B scoreboard.
--   Callbacks       rg_leads.next_call_at: "call me Tuesday at 2" makes that lead due at that time
--                   (still inside its weekday 9-5 window), ahead of everyone else, without the 2-day gap.
--   Daily report    rg_daily_report() at about 5:20 PM Pacific on weekdays -> Scout bell (+ push if anything booked).
--   Auto-setup      rg_secret_status() (which keys exist, never their values), rg_secret_put() so the
--                   setup can store the webhook secret ElevenLabs hands back, rg_setup_state for progress.
--   Line types      rg_leads.line_type_checked_at; the lookup runs only when Jared presses the button.

alter table public.rg_settings add column if not exists test_phone text;
alter table public.rg_settings add column if not exists voice_id text default 'EXAVITQu4vr4xnSDxMaL'; -- ElevenLabs premade female voice "Sarah"; Jared can swap
alter table public.rg_settings add column if not exists llm text default 'gemini-2.5-flash';           -- fast enough for natural phone turn-taking
alter table public.rg_settings add column if not exists from_number text;                             -- the Twilio number she calls from
alter table public.rg_settings add column if not exists webhook_id text;
alter table public.rg_settings add column if not exists setup_log jsonb not null default '[]'::jsonb;

alter table public.rg_calls add column if not exists is_test boolean not null default false;
alter table public.rg_leads add column if not exists next_call_at timestamptz;
alter table public.rg_leads add column if not exists line_type_checked_at timestamptz;

-- Which RoofGuard keys are in Vault (true/false only). Admin page uses it for the go-live checklist.
create or replace function public.rg_secret_status()
returns jsonb language plpgsql stable security definer set search_path = public, vault as $$
begin
  if not (public.has_role(auth.uid(), 'admin') or auth.role() = 'service_role') then raise exception 'admin only'; end if;
  return (select jsonb_object_agg(n, exists (select 1 from vault.secrets s where s.name = n))
            from unnest(array['elevenlabs_api_key','elevenlabs_webhook_secret','twilio_account_sid','twilio_auth_token']) n);
end $$;
revoke execute on function public.rg_secret_status() from public, anon;
grant execute on function public.rg_secret_status() to authenticated, service_role;

-- Setup writes back the one secret it receives (the post-call webhook's signing secret). Allowlist of one.
create or replace function public.rg_secret_put(p_name text, p_value text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  if p_name <> 'elevenlabs_webhook_secret' then raise exception 'rg_secret_put: % not allowed', p_name; end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_name, 'RoofGuard caller: ElevenLabs post-call webhook signing secret');
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end $$;
revoke execute on function public.rg_secret_put(text, text) from public, anon, authenticated;
grant execute on function public.rg_secret_put(text, text) to service_role;

-- Dial list, now with due callbacks first and test mode excluded from normal dialing.
create or replace function public.rg_next_call_batch(p_limit int default 10)
returns table (lead_id uuid, company text, phone text, timezone text, contact_name text, contact_title text,
               pitch_angle text, category text, state text, attempt int)
language sql stable security definer set search_path = public as $$
  with s as (select * from rg_settings where id),
  today as (select count(*) n from rg_calls where queued_at > now() - interval '24 hours' and not is_test),
  ever as (select count(distinct lead_id) n from rg_calls where not is_test)
  select l.id, l.company, l.phone, l.timezone, l.contacts->0->>'name', l.contacts->0->>'title',
         l.pitch, l.category, l.state, l.call_attempts + 1
    from rg_leads l, s, today, ever
   where s.calling_enabled
     and l.phone is not null
     and l.line_type in ('landline','voip')
     and not l.dnc
     and not exists (select 1 from rg_dnc d where d.phone = l.phone)
     and l.call_status not in ('booked','not_interested','do_not_call','wrong_number','in_progress')
     and l.call_attempts < s.max_attempts
     -- a requested callback is due from 10 minutes before the time they gave; otherwise the business-day gap
     and case when l.next_call_at is not null then now() >= l.next_call_at - interval '10 minutes'
              else (l.last_called_at is null or rg_business_days_between(l.last_called_at, now(), l.timezone) >= s.min_gap_bdays) end
     and extract(isodow from (now() at time zone l.timezone)) < 6
     and extract(hour from (now() at time zone l.timezone)) >= s.window_start_hour
     and extract(hour from (now() at time zone l.timezone)) <  s.window_end_hour
     and not exists (select 1 from rg_holidays h where h.day = (now() at time zone l.timezone)::date)
     and today.n < s.daily_cap
     and (s.pilot_limit is null or ever.n < s.pilot_limit or exists (select 1 from rg_calls c where c.lead_id = l.id and not c.is_test))
   order by (l.next_call_at is not null) desc, l.next_call_at, l.priority desc
   limit greatest(0, least(p_limit, (select daily_cap from s) - (select n from today)));
$$;
revoke execute on function public.rg_next_call_batch(int) from public, anon, authenticated;

-- Post-call write path: test calls never touch the lead; callbacks set next_call_at.
create or replace function public.rg_log_call(
  p_conversation_id text, p_lead_id uuid, p_to_number text, p_status text, p_outcome text,
  p_summary text default null, p_duration_sec int default null, p_meeting_times text default null,
  p_meeting_email text default null, p_callback_at timestamptz default null, p_dm_name text default null,
  p_dm_title text default null, p_notes text default null, p_transcript jsonb default null, p_recording_url text default null,
  p_opener_key text default null, p_dm_reached boolean default null, p_kept_talking boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_call rg_calls;
  v_lead rg_leads;
  v_outcome text := coalesce(p_outcome, 'other');
  v_opener text := (select key from rg_openers where key = p_opener_key);
begin
  select * into v_lead from rg_leads where id = p_lead_id;
  if v_lead.id is null then raise exception 'rg_log_call: unknown lead %', p_lead_id; end if;

  update rg_calls set conversation_id = p_conversation_id, status = p_status, outcome = v_outcome, summary = p_summary,
         duration_sec = p_duration_sec, meeting_times = p_meeting_times, meeting_email = p_meeting_email,
         callback_at = p_callback_at, dm_name = p_dm_name, dm_title = p_dm_title, notes = p_notes,
         transcript = p_transcript, recording_url = p_recording_url, ended_at = now(),
         opener_key = coalesce(v_opener, opener_key), dm_reached = p_dm_reached, kept_talking = p_kept_talking
   where id = (select id from rg_calls where lead_id = p_lead_id and conversation_id is null
                 and status in ('queued','in_progress') order by queued_at desc limit 1)
  returning * into v_call;

  if v_call.id is null then
    insert into rg_calls (lead_id, attempt, to_number, conversation_id, status, outcome, summary, duration_sec,
                          meeting_times, meeting_email, callback_at, dm_name, dm_title, notes, transcript, recording_url,
                          ended_at, opener_key, dm_reached, kept_talking)
    values (p_lead_id, v_lead.call_attempts + 1, p_to_number, p_conversation_id, p_status, v_outcome, p_summary, p_duration_sec,
            p_meeting_times, p_meeting_email, p_callback_at, p_dm_name, p_dm_title, p_notes, p_transcript, p_recording_url,
            now(), v_opener, p_dm_reached, p_kept_talking)
    on conflict (conversation_id) do update set
      status = excluded.status, outcome = excluded.outcome, summary = excluded.summary, duration_sec = excluded.duration_sec,
      meeting_times = excluded.meeting_times, meeting_email = excluded.meeting_email, callback_at = excluded.callback_at,
      dm_name = excluded.dm_name, dm_title = excluded.dm_title, notes = excluded.notes, transcript = excluded.transcript,
      recording_url = excluded.recording_url, ended_at = now(), opener_key = coalesce(excluded.opener_key, rg_calls.opener_key),
      dm_reached = excluded.dm_reached, kept_talking = excluded.kept_talking
    returning * into v_call;
  end if;

  if v_call.is_test then
    perform scout_notify('RoofGuard test call finished', 'Outcome: ' || v_outcome || coalesce('. ' || p_summary, ''),
                         'info', true, '/admin/roofguard', 'roofguard-test-' || coalesce(p_conversation_id, v_call.id::text));
    return jsonb_build_object('ok', true, 'call_id', v_call.id, 'outcome', v_outcome, 'test', true);
  end if;

  update rg_leads set
    call_attempts  = greatest(call_attempts, v_call.attempt),
    last_called_at = now(),
    next_call_at   = case when v_outcome = 'callback_set' then p_callback_at else null end,
    call_status    = case v_outcome
                       when 'booked' then 'booked' when 'not_interested' then 'not_interested'
                       when 'do_not_call' then 'do_not_call' when 'wrong_number' then 'wrong_number'
                       when 'callback_set' then 'callback_set' else 'attempted' end,
    dnc            = dnc or v_outcome = 'do_not_call'
  where id = p_lead_id;

  if v_outcome = 'do_not_call' then
    insert into rg_dnc (phone, lead_id, reason) values (p_to_number, p_lead_id, 'requested on call')
    on conflict (phone) do nothing;
  end if;

  if v_outcome = 'booked' then
    perform scout_notify(
      'RoofGuard: meeting requested with ' || v_lead.company,
      coalesce(p_dm_name, 'Decision maker') || coalesce(', ' || p_dm_title, '') || ' wants a call with Eli. Times: '
        || coalesce(p_meeting_times, 'not given') || '. Email: ' || coalesce(p_meeting_email, 'not given') || '.',
      'info', true, '/admin/roofguard', 'roofguard-booked-' || coalesce(p_conversation_id, v_call.id::text));
  end if;

  return jsonb_build_object('ok', true, 'call_id', v_call.id, 'outcome', v_outcome, 'opener', v_call.opener_key);
end $$;

-- Opener scoreboard ignores test calls.
create or replace function public.rg_opener_scores()
returns table (key text, label text, active boolean, calls int, reached int, kept_talking int, booked int, book_rate numeric, score numeric)
language sql stable security definer set search_path = public as $$
  select o.key, o.label, o.active,
         count(c.id)::int,
         count(c.id) filter (where c.dm_reached)::int,
         count(c.id) filter (where c.dm_reached and c.kept_talking)::int,
         count(c.id) filter (where c.outcome = 'booked')::int,
         round(100.0 * count(c.id) filter (where c.outcome = 'booked') / nullif(count(c.id) filter (where c.dm_reached), 0), 1),
         (count(c.id) filter (where c.outcome = 'booked') + 1.0) / (count(c.id) filter (where c.dm_reached) + 2.0)
    from rg_openers o left join rg_calls c on c.opener_key = o.key and not c.is_test
   where o.audience = 'decision_maker'
   group by o.key, o.label, o.active
   order by o.key;
$$;

-- Admin buttons. Each kicks one action on the dialer function; the function itself checks keys and settings.
create or replace function public.rg_caller_action(p_action text)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_action not in ('setup', 'test_call', 'line_types') then raise exception 'unknown action %', p_action; end if;
  return invoke_edge_function('roofguard-caller', jsonb_build_object('action', p_action, 'by', auth.uid()), 150000);
end $$;
revoke execute on function public.rg_caller_action(text) from public, anon;
grant execute on function public.rg_caller_action(text) to authenticated;

-- Weekday evening report to Scout. Silent on days with no calls.
create or replace function public.rg_daily_report()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_body text;
begin
  select count(*) filter (where not is_test) calls,
         count(*) filter (where not is_test and dm_reached) reached,
         count(*) filter (where not is_test and outcome = 'booked') booked,
         count(*) filter (where not is_test and outcome = 'callback_set') callbacks,
         count(*) filter (where not is_test and outcome = 'voicemail_left') voicemails,
         count(*) filter (where not is_test and outcome = 'do_not_call') dnc
    into r from rg_calls where queued_at > now() - interval '24 hours';
  if r.calls = 0 then return jsonb_build_object('sent', false, 'reason', 'no calls today'); end if;
  v_body := format('%s calls, %s reached a decision maker, %s meetings booked, %s callbacks set, %s voicemails, %s asked not to be called.',
                   r.calls, r.reached, r.booked, r.callbacks, r.voicemails, r.dnc);
  perform scout_notify('RoofGuard today: ' || r.booked || ' booked', v_body, 'info', r.booked > 0, '/admin/roofguard',
                       'roofguard-daily-' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'));
  return jsonb_build_object('sent', true, 'body', v_body);
end $$;
revoke execute on function public.rg_daily_report() from public, anon, authenticated;

-- 00:20 UTC Tue-Sat = 5:20 PM Pacific (daylight time) / 4:20 PM (standard time), Mon-Fri.
select cron.schedule('roofguard-daily-report', '20 0 * * 2-6', $$ select public.rg_daily_report(); $$);

-- Admin summary: add key status and setup state.
create or replace function public.rg_call_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'settings',     (select to_jsonb(s) - 'id' from rg_settings s where id),
    'keys',         rg_secret_status(),
    'unverified',   (select count(*) from rg_leads where phone is not null and line_type = 'unverified'),
    'dialable',     (select count(*) from rg_leads where phone is not null and line_type in ('landline','voip') and not dnc),
    'mobile',       (select count(*) from rg_leads where line_type = 'mobile'),
    'calls_total',  (select count(*) from rg_calls where not is_test),
    'test_calls',   (select count(*) from rg_calls where is_test),
    'calls_24h',    (select count(*) from rg_calls where queued_at > now() - interval '24 hours' and not is_test),
    'by_outcome',   (select coalesce(jsonb_object_agg(outcome, n), '{}'::jsonb) from (select outcome, count(*) n from rg_calls where outcome is not null and not is_test group by 1) o),
    'booked',       (select count(*) from rg_leads where call_status = 'booked'),
    'callbacks_due',(select count(*) from rg_leads where next_call_at is not null and call_status = 'callback_set'),
    'dnc',          (select count(*) from rg_dnc),
    'openers',      (select coalesce(jsonb_agg(to_jsonb(o) || jsonb_build_object('script', r.script)), '[]'::jsonb)
                       from rg_opener_scores() o join rg_openers r on r.key = o.key),
    'open_issue',   (select to_jsonb(i) from (select key, title, body, opened_at from monitor_issues where key = 'roofguard.caller' and status = 'open') i)
  );
end $$;
