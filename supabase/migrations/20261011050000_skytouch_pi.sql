-- SkyTouch moves off Claude scheduled tasks onto the Pi (Jared, 2026-10-10 6:48 PM): free, private, and PAUSED.
--
-- Old homes (both Claude scheduled tasks, both DISABLED and kept as the fallback until the new jobs are proven):
--   trig_01Fp91TUjwpmZ6afXKQLWMUZ  "SkyTouch text auto-responder"        (slug skytouch-triage)
--   trig_01KvqCmUx3AEbEYnpkTrNWfP  "SkyTouch morning availability check" (slug skytouch-morning)
-- New homes: Pi cron jobs skytouch_triage (hourly at :03) and skytouch_morning (daily 8:11 AM), no AI at all, so free and
-- nothing a client typed ever leaves the house. Code: tools/skytouch/. Page: /admin/skytouch.
--
-- Everything ships OFF: master_enabled and every per-job switch are false. A paused job only writes its heartbeat.
-- Sending to a client is the only outward act and only for the first intake reply (auto_first_reply, off by default);
-- everything else becomes a card for Jared. Texting Jared his own availability question is a separate switch (morning_text_jared).
--
-- The Pi has no Gmail or Calendar login today. The jobs say "skip: Gmail not connected yet" until Jared saves a Gmail app
-- password (and optionally his Google Calendar secret addresses) on /admin/skytouch. skytouch_connect writes them to Vault
-- write-only (names pi:skytouch:*, read by the Pi through pi_secret_get); the page only ever sees the saved-at time.

-- ------------------------------------------------------------------ tables (admin/service only: RLS on, no policies)
create table if not exists public.skytouch_settings (
  id boolean primary key default true check (id),
  master_enabled boolean not null default false,        -- the big pause switch
  triage_enabled boolean not null default false,        -- skytouch_triage (text front desk)
  morning_enabled boolean not null default false,       -- skytouch_morning (availability + calendar check)
  auto_first_reply boolean not null default false,      -- triage may SEND the first intake reply to a brand-new inquiry
  morning_text_jared boolean not null default false,    -- morning job may text Jared his own cell to ask availability
  stale_hours integer not null default 24 check (stale_hours between 2 and 72),
  updated_at timestamptz not null default now()
);
insert into public.skytouch_settings (id) values (true) on conflict (id) do nothing;
alter table public.skytouch_settings enable row level security;

create table if not exists public.skytouch_state (
  id boolean primary key default true check (id),
  availability_date date,                               -- the day Jared's last availability text applies to
  availability_text text,                               -- what he texted: hours, or "none"
  brief jsonb not null default '{}'::jsonb,             -- last morning brief (counts + lines for the page)
  counts jsonb not null default '{}'::jsonb,            -- last triage counts
  updated_at timestamptz not null default now()
);
insert into public.skytouch_state (id) values (true) on conflict (id) do nothing;
alter table public.skytouch_state enable row level security;

-- One card per thing Jared needs to look at. thread_key is the Gmail thread id (hex), never a name.
create table if not exists public.skytouch_cards (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('intake_draft', 'intake_sent', 'needs_approval', 'flagged', 'stale', 'calendar_gap', 'availability')),
  thread_key text not null,
  client_number text,                                   -- digits, as Google Voice shows it
  client_name text,
  ask text,                                             -- exactly what they asked for
  why text,                                             -- why the bot stopped here
  suggested_reply text,                                 -- a reply Jared can approve, edit or ignore
  fits_hours boolean,                                   -- null = could not tell
  jared_said text,                                      -- his own text that looks like an approval, shown, never acted on
  status text not null default 'open' check (status in ('open', 'sending', 'done', 'dismissed')),
  job text not null default 'skytouch_triage',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, thread_key)
);
create index if not exists skytouch_cards_open_idx on public.skytouch_cards (status, created_at desc);
alter table public.skytouch_cards enable row level security;

-- ------------------------------------------------------------------ helpers
create or replace function public.skytouch_effective(p_job text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select master_enabled and case p_job when 'skytouch_triage' then triage_enabled
                                                       when 'skytouch_morning' then morning_enabled else false end
                     from skytouch_settings where id), false)
$$;
revoke all on function public.skytouch_effective(text) from public, anon, authenticated;
grant execute on function public.skytouch_effective(text) to service_role;

-- Keeps the Team page and the Pi watchdog honest: a switched-off job is "paused" (Team Watch stays quiet) and its
-- pi_jobs row is disabled (no "went quiet" alert); switching it on makes both watch it again.
create or replace function public.skytouch_sync_watch()
returns void language plpgsql security definer set search_path = public as $$
declare j text; v_slug text; v_on boolean;
begin
  foreach j in array array['skytouch_triage', 'skytouch_morning'] loop
    v_slug := replace(j, 'skytouch_', 'skytouch-');
    v_on := skytouch_effective(j);
    update bestly_agents set status = case when v_on then 'active' else 'paused' end, updated_at = now() where bestly_agents.slug = v_slug;
    update pi_jobs set enabled = v_on where job = j;
  end loop;
end $$;
revoke all on function public.skytouch_sync_watch() from public, anon, authenticated;

-- ------------------------------------------------------------------ Pi side (service role only)
create or replace function public.skytouch_gate(p_job text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s skytouch_settings;
begin
  select * into s from skytouch_settings where id;
  return jsonb_build_object('master', s.master_enabled, 'job_on', skytouch_effective(p_job),
    'auto_first_reply', s.auto_first_reply, 'morning_text_jared', s.morning_text_jared, 'stale_hours', s.stale_hours);
end $$;

-- Saves a card. A new card that needs Jared's yes sends ONE plain notification signed by the front desk: counts only,
-- never a name or a message. Cards for a job that is switched off never notify.
create or replace function public.skytouch_card_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c skytouch_cards; v_new boolean := false; v_kind text := p->>'kind';
begin
  select * into c from skytouch_cards where kind = v_kind and thread_key = p->>'thread_key';
  if c.id is null then
    insert into skytouch_cards (kind, thread_key, client_number, client_name, ask, why, suggested_reply, fits_hours, jared_said, status, job)
    values (v_kind, p->>'thread_key', p->>'client_number', p->>'client_name', p->>'ask', p->>'why', p->>'suggested_reply',
            (p->>'fits_hours')::boolean, p->>'jared_said', coalesce(p->>'status', 'open'), coalesce(p->>'job', 'skytouch_triage'))
    returning * into c;
    v_new := true;
  elsif c.status = 'open' then
    update skytouch_cards set ask = coalesce(p->>'ask', ask), why = coalesce(p->>'why', why),
           suggested_reply = coalesce(p->>'suggested_reply', suggested_reply), fits_hours = coalesce((p->>'fits_hours')::boolean, fits_hours),
           jared_said = coalesce(p->>'jared_said', jared_said), updated_at = now()
     where id = c.id returning * into c;
  end if;
  if v_new and v_kind in ('needs_approval', 'intake_draft') and c.status = 'open' and skytouch_effective(c.job) then
    perform scout_notify('SkyTouch Front Desk: a client is waiting on you',
      'A new text needs your yes or no. Open SkyTouch to see it and the reply I suggest.', 'info', true, '/admin/skytouch',
      'skytouch.waiting.' || c.thread_key);
  end if;
  return jsonb_build_object('id', c.id, 'created', v_new, 'status', c.status);
end $$;

-- Atomic "may I send?" for the first intake reply: succeeds once per thread, ever. A crash between claim and send leaves the
-- card in 'sending' (never re-sent); the next run turns it into a flagged card for Jared to check.
create or replace function public.skytouch_intake_claim(p_thread_key text, p_number text, p_name text, p_ask text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not skytouch_effective('skytouch_triage') then return false; end if;
  if not (select auto_first_reply from skytouch_settings where id) then return false; end if;
  insert into skytouch_cards (kind, thread_key, client_number, client_name, ask, status, job)
  values ('intake_sent', p_thread_key, p_number, p_name, p_ask, 'sending', 'skytouch_triage')
  on conflict (kind, thread_key) do nothing returning id into v_id;
  return v_id is not null;
end $$;

create or replace function public.skytouch_intake_done(p_thread_key text, p_ok boolean, p_why text default null)
returns void language sql security definer set search_path = public as $$
  update skytouch_cards set status = case when p_ok then 'done' else 'open' end, why = coalesce(p_why, why), updated_at = now()
   where kind = 'intake_sent' and thread_key = p_thread_key and status = 'sending';
$$;

create or replace function public.skytouch_state_save(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update skytouch_state set
    availability_date = coalesce((p->>'availability_date')::date, availability_date),
    availability_text = case when p ? 'availability_text' then p->>'availability_text' else availability_text end,
    brief = case when p ? 'brief' then p->'brief' else brief end,
    counts = case when p ? 'counts' then p->'counts' else counts end,
    updated_at = now()
  where id;
end $$;

revoke all on function public.skytouch_gate(text), public.skytouch_card_save(jsonb), public.skytouch_intake_claim(text, text, text, text),
  public.skytouch_intake_done(text, boolean, text), public.skytouch_state_save(jsonb) from public, anon, authenticated;
grant execute on function public.skytouch_gate(text), public.skytouch_card_save(jsonb), public.skytouch_intake_claim(text, text, text, text),
  public.skytouch_intake_done(text, boolean, text), public.skytouch_state_save(jsonb) to service_role;

-- ------------------------------------------------------------------ admin side (signed-in admin only)
create or replace function public.skytouch_admin()
returns jsonb language plpgsql stable security definer set search_path = public, vault as $$
declare s skytouch_settings; st skytouch_state; v_gm timestamptz; v_cal timestamptz; v_now timestamp := (now() at time zone 'America/Los_Angeles');
  v_next_t timestamptz; v_next_m timestamptz; v_jobs jsonb;
begin
  if not team_is_admin() then raise exception 'Admins only'; end if;
  select * into s from skytouch_settings where id;
  select * into st from skytouch_state where id;
  select updated_at into v_gm from vault.secrets where name = 'pi:skytouch:gmail_app_password';
  select updated_at into v_cal from vault.secrets where name = 'pi:skytouch:calendar_urls';
  -- next ticks (the Pi clock is Pacific): triage at :03 every hour, morning at 8:11 AM
  v_next_t := (case when v_now < date_trunc('hour', v_now) + interval '3 minutes' then date_trunc('hour', v_now) + interval '3 minutes'
                    else date_trunc('hour', v_now) + interval '1 hour 3 minutes' end) at time zone 'America/Los_Angeles';
  v_next_m := (case when v_now < date_trunc('day', v_now) + interval '8 hours 11 minutes' then date_trunc('day', v_now) + interval '8 hours 11 minutes'
                    else date_trunc('day', v_now) + interval '1 day 8 hours 11 minutes' end) at time zone 'America/Los_Angeles';

  select jsonb_agg(jsonb_build_object(
      'job', x.job, 'label', x.label, 'runs_on', 'Pi', 'cost', 'Free, no AI', 'schedule', x.schedule, 'what', x.what,
      'on', skytouch_effective(x.job), 'next_tick', x.nxt,
      'last_run_at', pj.last_run_at, 'last_ok', pj.last_ok, 'last_summary', pj.last_summary,
      'replaces', x.replaces) order by x.ord)
    into v_jobs
    from (values
      (1, 'skytouch_triage', 'Text front desk', 'Every hour at :03',
       'Reads new client texts. Sends only the first hello to a brand-new inquiry (if you allow it); everything else becomes a card for you with a reply you can approve.',
       v_next_t, 'Claude task "SkyTouch text auto-responder"'),
      (2, 'skytouch_morning', 'Morning availability check', 'Daily at 8:11 AM',
       'Asks you for today''s hours (if you allow it), reads your calendars for the next 7 days, and lists bookings mentioned in texts that are not on a calendar yet.',
       v_next_m, 'Claude task "SkyTouch morning availability check"')
    ) as x(ord, job, label, schedule, what, nxt, replaces)
    left join pi_jobs pj on pj.job = x.job;

  return jsonb_build_object(
    'settings', to_jsonb(s) - 'id',
    'jobs', coalesce(v_jobs, '[]'::jsonb),
    'connection', jsonb_build_object('gmail_at', v_gm, 'calendar_at', v_cal, 'gmail_ready', v_gm is not null, 'calendar_ready', v_cal is not null),
    'availability', jsonb_build_object('date', st.availability_date, 'text', st.availability_text),
    'brief', st.brief, 'counts', st.counts,
    'cards', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc)
                         from (select * from skytouch_cards where status in ('open', 'sending') order by created_at desc limit 40) c), '[]'::jsonb),
    'now', now());
end $$;

create or replace function public.skytouch_set(
  p_master boolean default null, p_triage boolean default null, p_morning boolean default null,
  p_auto_first_reply boolean default null, p_morning_text_jared boolean default null, p_stale_hours integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'Admins only'; end if;
  if p_stale_hours is not null and (p_stale_hours < 2 or p_stale_hours > 72) then raise exception 'Stale window must be 2 to 72 hours'; end if;
  update skytouch_settings set
    master_enabled = coalesce(p_master, master_enabled), triage_enabled = coalesce(p_triage, triage_enabled),
    morning_enabled = coalesce(p_morning, morning_enabled), auto_first_reply = coalesce(p_auto_first_reply, auto_first_reply),
    morning_text_jared = coalesce(p_morning_text_jared, morning_text_jared), stale_hours = coalesce(p_stale_hours, stale_hours),
    updated_at = now()
  where id;
  perform skytouch_sync_watch();
  return skytouch_admin();
end $$;

-- Write-only, like chargepoint_connect: the page can save a login and read back only WHEN it was saved.
create or replace function public.skytouch_connect(p_gmail_app_password text default null, p_calendar_urls text default null)
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare v_pw text := regexp_replace(coalesce(p_gmail_app_password, ''), '\s', '', 'g'); v_urls text := trim(coalesce(p_calendar_urls, '')); v_line text; v_id uuid; v_clean text := '';
begin
  if not team_is_admin() then raise exception 'Admins only'; end if;
  if v_pw = '' and v_urls = '' then raise exception 'Add the app password or the calendar addresses'; end if;
  if v_pw <> '' then
    if v_pw !~ '^[a-z]{16}$' then raise exception 'A Gmail app password is 16 letters (Google shows it in four groups of four)'; end if;
    select id into v_id from vault.secrets where name = 'pi:skytouch:gmail_app_password';
    if v_id is null then perform vault.create_secret(v_pw, 'pi:skytouch:gmail_app_password', 'SkyTouch: Gmail app password for the Pi (2026-10-10)');
    else perform vault.update_secret(v_id, v_pw, 'pi:skytouch:gmail_app_password'); end if;
  end if;
  if v_urls <> '' then
    for v_line in select trim(x) from regexp_split_to_table(v_urls, E'[\\r\\n]+') x loop
      continue when v_line = '';
      if v_line !~ '^https://calendar\.google\.com/calendar/ical/[^\s]+\.ics$' then
        raise exception 'Each calendar address must be a Google "Secret address in iCal format" link ending in .ics';
      end if;
      v_clean := v_clean || v_line || E'\n';
    end loop;
    select id into v_id from vault.secrets where name = 'pi:skytouch:calendar_urls';
    if v_id is null then perform vault.create_secret(trim(v_clean), 'pi:skytouch:calendar_urls', 'SkyTouch: Google Calendar secret iCal addresses (2026-10-10)');
    else perform vault.update_secret(v_id, trim(v_clean), 'pi:skytouch:calendar_urls'); end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.skytouch_card_close(p_id uuid, p_status text default 'done')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('done', 'dismissed') then raise exception 'done or dismissed'; end if;
  update skytouch_cards set status = p_status, updated_at = now() where id = p_id and status in ('open', 'sending');
end $$;

revoke all on function public.skytouch_admin(), public.skytouch_set(boolean, boolean, boolean, boolean, boolean, integer),
  public.skytouch_connect(text, text), public.skytouch_card_close(uuid, text) from public, anon;
grant execute on function public.skytouch_admin(), public.skytouch_set(boolean, boolean, boolean, boolean, boolean, integer),
  public.skytouch_connect(text, text), public.skytouch_card_close(uuid, text) to authenticated;

-- ------------------------------------------------------------------ watchdog + team card (paused until Jared switches it on)
insert into public.pi_jobs (job, description, max_gap_min, enabled, replaced_claude_task) values
 ('skytouch_triage', 'SkyTouch Front Desk: reads client texts hourly, sends only the first hello when allowed, cards for everything else (no AI, paused)', 130, false, 'trig_01Fp91TUjwpmZ6afXKQLWMUZ'),
 ('skytouch_morning', 'SkyTouch Morning Check: availability ask + calendar gaps, daily 8:11 AM (no AI, paused)', 1500, false, 'trig_01KvqCmUx3AEbEYnpkTrNWfP')
on conflict (job) do update set description = excluded.description, max_gap_min = excluded.max_gap_min, replaced_claude_task = excluded.replaced_claude_task;

select public.team_onboard($j$[
 {"slug":"skytouch-triage","name":"SkyTouch Front Desk","role":"Front Desk Coordinator","reports_to":"jared","dept":"sales","runs_on":"pi","icon":"hand-heart",
  "schedule":"Hourly at :03 (paused)","admin_url":"/admin/skytouch","welcome":false,
  "what_it_does":"Sends the first reply to new massage clients. Everything else waits for you.",
  "pulse":{"src":"pi_job","key":"skytouch_triage","gap":130,"alert":true,"also":["skytouch_morning"]},
  "owns":["skytouch."]},
 {"slug":"skytouch-morning","name":"SkyTouch Morning Check","role":"Availability check","tool_of":"skytouch-triage","runs_on":"pi","icon":"sunrise",
  "schedule":"Daily 8:11 AM (paused)","admin_url":"/admin/skytouch",
  "what_it_does":"Checks your availability each morning for SkyTouch and lists bookings that are not on a calendar yet.",
  "pulse":{"src":"pi_job","key":"skytouch_morning","gap":1500,"alert":true}}
]$j$::jsonb);

insert into public.notification_owners (prefix, agent_slug, note)
values ('skytouch', 'skytouch-triage', 'SkyTouch: clients waiting on you, Gmail login problems')
on conflict (prefix) do update set agent_slug = excluded.agent_slug, note = excluded.note;

-- team_onboard marks a bot active; both start paused.
select public.skytouch_sync_watch();
