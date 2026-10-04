-- RoofGuard caller, Phase 2 plumbing, built OFF (Spark, 2026-10-04).
--
-- Nothing here can dial. rg_settings.calling_enabled defaults to false, and the dialer edge function
-- (roofguard-caller) also refuses to run until the ElevenLabs + Twilio credentials exist in Vault.
--
-- rg_settings        one row: on/off switch, calling window, attempt rules, daily cap, pilot limit, agent ids
-- rg_calls           one row per dial attempt, filled by the post-call webhook (outcome, summary, booking)
-- rg_dnc             do-not-call numbers; checked before every dial, a request is permanent
-- rg_holidays        US federal holidays (observed) 2026-2027; no calls on these days
-- rg_business_days_between()  business days between two timestamps (weekdays minus holidays)
-- rg_next_call_batch()        the leads allowed to be dialed right now, best priority first
-- rg_record_call()            the post-call webhook's single write path (call row + lead status + DNC + Scout)
-- rg_watch_calls()            watchdog: stuck calls, a stalled dialer, webhook silence; raises roofguard.caller

create table if not exists public.rg_settings (
  id                 boolean primary key default true check (id),
  calling_enabled    boolean not null default false,
  window_start_hour  int not null default 9  check (window_start_hour between 0 and 23),
  window_end_hour    int not null default 17 check (window_end_hour between 1 and 24),
  max_attempts       int not null default 3  check (max_attempts between 1 and 5),
  min_gap_bdays      int not null default 2  check (min_gap_bdays between 1 and 15),
  daily_cap          int not null default 20 check (daily_cap between 0 and 500),
  pilot_limit        int,             -- when set, total leads ever dialed stops here (the 20-call pilot)
  agent_id           text,            -- ElevenLabs agent id (not a secret)
  phone_number_id    text,            -- ElevenLabs agent phone number id (not a secret)
  callback_number    text,            -- number read out in voicemails
  updated_at         timestamptz not null default now(),
  updated_by         text
);
insert into public.rg_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.rg_calls (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid not null references public.rg_leads(id) on delete cascade,
  attempt            int not null default 1,
  to_number          text not null,
  provider           text not null default 'elevenlabs',
  batch_id           text,
  conversation_id    text unique,
  status             text not null default 'queued'
                     check (status in ('queued','in_progress','completed','failed','no_answer','canceled')),
  outcome            text check (outcome in ('booked','callback_set','dm_identified','voicemail_left','gatekeeper_blocked',
                                             'not_interested','wrong_number','do_not_call','no_answer','other')),
  summary            text,
  duration_sec       int,
  meeting_times      text,
  meeting_email      text,
  callback_at        timestamptz,
  dm_name            text,
  dm_title           text,
  notes              text,
  transcript         jsonb,
  recording_url      text,
  queued_at          timestamptz not null default now(),
  ended_at           timestamptz,
  updated_at         timestamptz not null default now()
);
create index if not exists rg_calls_lead_idx on public.rg_calls (lead_id, queued_at desc);
create index if not exists rg_calls_status_idx on public.rg_calls (status, queued_at);
create trigger rg_calls_touch before update on public.rg_calls for each row execute function public.rg_touch();

create table if not exists public.rg_dnc (
  phone       text primary key,          -- E.164
  lead_id     uuid references public.rg_leads(id) on delete set null,
  reason      text not null default 'requested',
  created_at  timestamptz not null default now()
);

create table if not exists public.rg_holidays (day date primary key, name text not null);
insert into public.rg_holidays (day, name) values
  ('2026-01-01','New Year''s Day'), ('2026-01-19','Martin Luther King Jr. Day'), ('2026-02-16','Presidents'' Day'),
  ('2026-05-25','Memorial Day'), ('2026-06-19','Juneteenth'), ('2026-07-03','Independence Day (observed)'),
  ('2026-09-07','Labor Day'), ('2026-10-12','Columbus Day'), ('2026-11-11','Veterans Day'),
  ('2026-11-26','Thanksgiving'), ('2026-11-27','Day after Thanksgiving'), ('2026-12-25','Christmas Day'),
  ('2027-01-01','New Year''s Day'), ('2027-01-18','Martin Luther King Jr. Day'), ('2027-02-15','Presidents'' Day'),
  ('2027-05-31','Memorial Day'), ('2027-06-18','Juneteenth (observed)'), ('2027-07-05','Independence Day (observed)'),
  ('2027-09-06','Labor Day'), ('2027-10-11','Columbus Day'), ('2027-11-11','Veterans Day'),
  ('2027-11-25','Thanksgiving'), ('2027-11-26','Day after Thanksgiving'), ('2027-12-24','Christmas Day (observed)'),
  ('2027-12-31','New Year''s Day (observed)')
on conflict (day) do nothing;

alter table public.rg_settings enable row level security;
alter table public.rg_calls    enable row level security;
alter table public.rg_dnc      enable row level security;
alter table public.rg_holidays enable row level security;
create policy rg_settings_admin on public.rg_settings for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy rg_calls_admin_read on public.rg_calls for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy rg_dnc_admin on public.rg_dnc for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy rg_holidays_admin_read on public.rg_holidays for select to authenticated using (public.has_role(auth.uid(), 'admin'));
grant select, update on public.rg_settings to authenticated;
grant select on public.rg_calls to authenticated;
grant select, insert, delete on public.rg_dnc to authenticated;
grant select on public.rg_holidays to authenticated;

-- Business days strictly after a's date up to and including b's date (weekdays that are not holidays).
create or replace function public.rg_business_days_between(a timestamptz, b timestamptz, tz text default 'America/Chicago')
returns int language sql stable set search_path = public as $$
  select count(*)::int
    from generate_series(((a at time zone tz)::date + 1), (b at time zone tz)::date, interval '1 day') d
   where extract(isodow from d) < 6 and not exists (select 1 from rg_holidays h where h.day = d::date);
$$;

-- The leads that may be dialed right now. Every rule lives here so the dialer cannot skip one.
create or replace function public.rg_next_call_batch(p_limit int default 10)
returns table (lead_id uuid, company text, phone text, timezone text, contact_name text, contact_title text,
               pitch_angle text, category text, state text, attempt int)
language sql stable security definer set search_path = public as $$
  with s as (select * from rg_settings where id),
  today as (select count(*) n from rg_calls where queued_at > now() - interval '24 hours'),
  ever as (select count(distinct lead_id) n from rg_calls)
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
     and (l.last_called_at is null or rg_business_days_between(l.last_called_at, now(), l.timezone) >= s.min_gap_bdays)
     -- calling window in the lead's own time zone, weekdays, no federal holidays
     and extract(isodow from (now() at time zone l.timezone)) < 6
     and extract(hour from (now() at time zone l.timezone)) >= s.window_start_hour
     and extract(hour from (now() at time zone l.timezone)) <  s.window_end_hour
     and not exists (select 1 from rg_holidays h where h.day = (now() at time zone l.timezone)::date)
     -- caps: daily, and the pilot's total-leads limit (repeat attempts on pilot leads still allowed)
     and today.n < s.daily_cap
     and (s.pilot_limit is null or ever.n < s.pilot_limit or exists (select 1 from rg_calls c where c.lead_id = l.id))
   order by (l.call_status = 'callback_set') desc, l.priority desc
   limit greatest(0, least(p_limit, (select daily_cap from s) - (select n from today)));
$$;
revoke execute on function public.rg_next_call_batch(int) from public, anon, authenticated;

-- Single write path for a finished call (called by the post-call webhook with the service key).
create or replace function public.rg_record_call(
  p_conversation_id text, p_lead_id uuid, p_to_number text, p_status text, p_outcome text,
  p_summary text default null, p_duration_sec int default null, p_meeting_times text default null,
  p_meeting_email text default null, p_callback_at timestamptz default null, p_dm_name text default null,
  p_dm_title text default null, p_notes text default null, p_transcript jsonb default null, p_recording_url text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_call rg_calls;
  v_lead rg_leads;
  v_outcome text := coalesce(p_outcome, 'other');
begin
  select * into v_lead from rg_leads where id = p_lead_id;
  if v_lead.id is null then raise exception 'rg_record_call: unknown lead %', p_lead_id; end if;

  insert into rg_calls (lead_id, attempt, to_number, conversation_id, status, outcome, summary, duration_sec,
                        meeting_times, meeting_email, callback_at, dm_name, dm_title, notes, transcript, recording_url, ended_at)
  values (p_lead_id, v_lead.call_attempts + 1, p_to_number, p_conversation_id, p_status, v_outcome, p_summary, p_duration_sec,
          p_meeting_times, p_meeting_email, p_callback_at, p_dm_name, p_dm_title, p_notes, p_transcript, p_recording_url, now())
  on conflict (conversation_id) do update set
    status = excluded.status, outcome = excluded.outcome, summary = excluded.summary, duration_sec = excluded.duration_sec,
    meeting_times = excluded.meeting_times, meeting_email = excluded.meeting_email, callback_at = excluded.callback_at,
    dm_name = excluded.dm_name, dm_title = excluded.dm_title, notes = excluded.notes, transcript = excluded.transcript,
    recording_url = excluded.recording_url, ended_at = now()
  returning * into v_call;

  update rg_leads set
    call_attempts  = case when v_call.attempt > call_attempts then v_call.attempt else call_attempts end,
    last_called_at = now(),
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

  -- A booked meeting goes to Jared's bell + phone right away; nothing is emailed as him automatically.
  if v_outcome = 'booked' then
    perform scout_notify(
      'RoofGuard: meeting requested with ' || v_lead.company,
      coalesce(p_dm_name, 'Decision maker') || coalesce(', ' || p_dm_title, '') || ' wants a call with Eli. Times: '
        || coalesce(p_meeting_times, 'not given') || '. Email: ' || coalesce(p_meeting_email, 'not given') || '.',
      'info', true, '/admin/roofguard', 'roofguard-booked-' || p_conversation_id);
  end if;

  return jsonb_build_object('ok', true, 'call_id', v_call.id, 'outcome', v_outcome);
end $$;
revoke execute on function public.rg_record_call(text, uuid, text, text, text, text, int, text, text, timestamptz, text, text, text, jsonb, text)
  from public, anon, authenticated;

-- Watchdog for the dialer. Quiet (and resolves any open issue) while calling is off.
create or replace function public.rg_watch_calls()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s rg_settings;
  v_stuck int;
  v_eligible int;
  v_last timestamptz;
begin
  select * into s from rg_settings where id;
  -- self-heal: a call the webhook never closed is marked failed after 30 min, and its lead freed
  with stuck as (
    update rg_calls set status = 'failed', notes = coalesce(notes || ' ', '') || '[watchdog: no webhook after 30 min]'
     where status in ('queued','in_progress') and queued_at < now() - interval '30 minutes'
    returning lead_id)
  select count(*) into v_stuck from stuck;
  update rg_leads set call_status = 'attempted'
   where call_status = 'in_progress' and id not in (select lead_id from rg_calls where status in ('queued','in_progress'));

  if not s.calling_enabled then
    perform bestly_raise('roofguard.caller', 'resolved', 'info', 'RoofGuard caller: off', null, 'roofguard');
    return jsonb_build_object('enabled', false, 'stuck_fixed', v_stuck);
  end if;

  select count(*) into v_eligible from rg_next_call_batch(50);
  select max(queued_at) into v_last from rg_calls;

  if v_eligible > 0 and (v_last is null or v_last < now() - interval '45 minutes') then
    perform bestly_raise('roofguard.caller', 'problem', 'warning', 'RoofGuard caller stalled',
      format('%s leads are ready to dial inside their calling window, but no call went out in 45 min.', v_eligible),
      'roofguard', null, false);
  elsif v_stuck >= 3 then
    perform bestly_raise('roofguard.caller', 'problem', 'warning', 'RoofGuard calls not reporting back',
      format('%s calls never got a post-call webhook. Watchdog closed them; check the webhook in ElevenLabs.', v_stuck),
      'roofguard', null, true);
  else
    perform bestly_raise('roofguard.caller', 'resolved', 'info', 'RoofGuard caller healthy again', null, 'roofguard');
  end if;
  return jsonb_build_object('enabled', true, 'eligible_now', v_eligible, 'stuck_fixed', v_stuck, 'last_call', v_last);
end $$;
revoke execute on function public.rg_watch_calls() from public, anon, authenticated;

-- Admin page summary of the calling side.
create or replace function public.rg_call_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'settings',     (select to_jsonb(s) - 'id' from rg_settings s where id),
    'unverified',   (select count(*) from rg_leads where phone is not null and line_type = 'unverified'),
    'dialable',     (select count(*) from rg_leads where phone is not null and line_type in ('landline','voip') and not dnc),
    'calls_total',  (select count(*) from rg_calls),
    'calls_24h',    (select count(*) from rg_calls where queued_at > now() - interval '24 hours'),
    'by_outcome',   (select coalesce(jsonb_object_agg(outcome, n), '{}'::jsonb) from (select outcome, count(*) n from rg_calls where outcome is not null group by 1) o),
    'booked',       (select count(*) from rg_leads where call_status = 'booked'),
    'dnc',          (select count(*) from rg_dnc),
    'open_issue',   (select to_jsonb(i) from (select key, title, body, opened_at from monitor_issues where key = 'roofguard.caller' and status = 'open') i)
  );
end $$;
revoke execute on function public.rg_call_stats() from public, anon;
grant execute on function public.rg_call_stats() to authenticated;

-- One watchdog cron for the dialer (cheap no-op while calling is off).
select cron.schedule('roofguard-watch-calls', '7-59/10 * * * *', $$ select public.rg_watch_calls(); $$);
