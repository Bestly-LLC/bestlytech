-- Ava's morning brief (docs/ava-next-opusplan.md section 4, 2026-10-05).
-- One Scout push at 8:00 AM Pacific (a setting), signed "Ava (assistant): your morning". Plain SQL text, no AI.
-- Covers: messages waiting, call-backs owed or set for today, today's calendar, what the reply guard says needs Jared,
-- yesterday's spend, and one RoofGuard line. Nothing at all to say means no push.
--
-- The calendar part comes from the ava-assistant action "today" (the same CalDAV code Find times uses). It writes the day's events into
-- ava_brief_cache; this job asks for them 10 minutes early and composes the text from the cache. If the calendar can't be read the
-- brief still goes out, with a line that says so.
-- Watchdog: ava_brief_watch() alerts once if the brief has not gone out 15 minutes after its time. It runs from this job and also from
-- the ava-assistant health check (every 10 minutes), so a dead schedule still gets caught.

alter table public.ava_settings
  add column if not exists brief_enabled boolean not null default true,
  add column if not exists brief_minute int not null default 480 check (brief_minute between 300 and 660),   -- minutes after midnight, Pacific; 5:00 AM to 11:00 AM
  add column if not exists brief_fetch_at timestamptz;

create table if not exists public.ava_brief_cache (
  day date primary key,
  events jsonb not null default '[]'::jsonb,       -- [{t: iso time, title, kind: 'event'|'pickup'|'return'}]
  ok boolean not null default true,
  error text,
  fetched_at timestamptz not null default now()
);
alter table public.ava_brief_cache enable row level security;
create policy "admin ava_brief_cache" on public.ava_brief_cache for select to authenticated using (public.has_role(auth.uid(), 'admin'));
grant select on public.ava_brief_cache to authenticated;

create table if not exists public.ava_brief_log (
  day date primary key,
  status text not null check (status in ('sent', 'skipped', 'failed')),
  body text,
  note text,
  at timestamptz not null default now()
);
alter table public.ava_brief_log enable row level security;
create policy "admin ava_brief_log" on public.ava_brief_log for select to authenticated using (public.has_role(auth.uid(), 'admin'));
grant select on public.ava_brief_log to authenticated;

-- the text for one day (p_day is the Pacific date the brief is FOR)
create or replace function public.ava_brief_compose(p_day date) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  tz constant text := 'America/Los_Angeles';
  d0 timestamptz := (p_day::timestamp at time zone tz);
  d1 timestamptz := ((p_day + 1)::timestamp at time zone tz);
  y0 timestamptz := ((p_day - 1)::timestamp at time zone tz);
  a ava_settings; c ava_brief_cache; rs rg_settings;
  lines text[] := '{}'; has boolean := false;
  n int; names text; owed int; today_cb text; v_ev text; need int; nums text; spent numeric; rg_calls_y int; rg_booked_y int;
begin
  select * into a from ava_settings limit 1;

  -- messages waiting
  select count(*) into n from ava_calls where message is not null and read_at is null and deleted_at is null;
  if n > 0 then
    select string_agg(nm, ', ') into names from (
      select coalesce(nullif(btrim(x.caller_name), ''), k.name, regexp_replace(coalesce(x.phone, ''), '^\+1(\d{3})(\d{3})(\d{4})$', '(\1) \2-\3'), 'Unknown caller') nm
        from ava_calls x left join ava_contacts k on k.id = x.contact_id
       where x.message is not null and x.read_at is null and x.deleted_at is null
       order by x.urgent desc, x.created_at desc limit 2) t;
    lines := lines || format('Messages: %s waiting%s.', n, case when names is not null then ' (' || names || case when n > 2 then ' and ' || (n - 2) || ' more' else '' end || ')' else '' end);
    has := true;
  end if;

  -- call-backs owed (proposed, or an open call-back button with no follow-up row) and the ones set for today
  select count(*) into owed from ava_followups f where f.source = 'ava' and f.status = 'proposed';
  owed := owed + (select count(*) from ava_actions x where x.source = 'ava' and x.kind = 'call_back' and x.status = 'open'
                    and not exists (select 1 from ava_followups f where f.call_id = x.call_id));
  select string_agg(to_char(due_at at time zone tz, 'FMHH12:MI AM') || ' ' || coalesce(nullif(btrim(name), ''), 'call back'), ', ' order by due_at) into today_cb
    from ava_followups where source = 'ava' and status = 'approved' and due_at >= d0 and due_at < d1;
  if owed > 0 or today_cb is not null then
    lines := lines || ('Call-backs: ' || concat_ws('; ', case when owed > 0 then owed || ' owed' end, case when today_cb is not null then 'set for today: ' || today_cb end) || '.');
    has := true;
  end if;

  -- today's calendar: the cache from the calendar read, plus Turo Watch pickups and returns
  select * into c from ava_brief_cache where day = p_day;
  with ev as (
    select (e->>'t')::timestamptz t, left(coalesce(e->>'title', ''), 60) title, coalesce(e->>'kind', 'event') kind from jsonb_array_elements(coalesce(c.events, '[]')) e
    union all
    select starts_at, coalesce(nullif(btrim(guest_first), ''), 'guest'), 'pickup' from turo_trips where status = 'BOOKED' and starts_at >= d0 and starts_at < d1
    union all
    select ends_at, coalesce(nullif(btrim(guest_first), ''), 'guest'), 'return' from turo_trips where status = 'BOOKED' and ends_at >= d0 and ends_at < d1
  ), dedup as (
    select distinct on (kind, date_trunc('hour', t) + (extract(minute from t)::int / 30) * interval '30 minutes', case when kind = 'event' then title else '' end) t, title, kind
      from ev order by kind, date_trunc('hour', t) + (extract(minute from t)::int / 30) * interval '30 minutes', case when kind = 'event' then title else '' end, t
  ), top as (
    select * from dedup order by t limit 5
  )
  select string_agg(to_char(t at time zone tz, 'FMHH12:MI AM') || ' ' || case kind when 'pickup' then 'Turo pickup (' || title || ')' when 'return' then 'Turo return (' || title || ')' else title end, '; ' order by t),
         (select count(*) from dedup)::int
    into v_ev, n from top;
  if v_ev is not null then
    lines := lines || ('Today: ' || v_ev || case when n > 5 then '; plus ' || (n - 5) || ' more' else '' end || '.');
    has := true;
  elsif c.day is not null and not c.ok then
    lines := lines || 'Calendar: I could not read it this morning.';
    has := true;
  end if;

  -- reply guard: what is still waiting on Jared
  perform ava_incident_sync();
  select count(*), string_agg('#' || call_no, ', ' order by created_at desc) into need, nums
    from (select call_no, created_at from ava_reply_incidents where reviewed_at is null and action_state = 'needs_you' order by created_at desc limit 3) t;
  select count(*) into need from ava_reply_incidents where reviewed_at is null and action_state = 'needs_you';
  if need > 0 then
    lines := lines || format('Reply guard: %s need%s you (calls %s).', need, case when need = 1 then 's' else '' end, nums);
    has := true;
  end if;

  -- yesterday's spend
  select coalesce(sum(coalesce(x.duration_sec, 0) / 60.0 * a.cost_voice_per_min + ceil(coalesce(x.duration_sec, 0) / 60.0) * a.cost_phone_per_min + coalesce(x.llm_cost, 0)), 0) into spent
    from ava_calls x where x.created_at >= y0 and x.created_at < d0;
  if spent >= 0.01 then
    lines := lines || ('Spend yesterday: $' || to_char(spent, 'FM999990.00') || '.');
    has := true;
  end if;

  -- RoofGuard, one line
  select * into rs from rg_settings where id;
  select count(*), count(*) filter (where outcome = 'booked') into rg_calls_y, rg_booked_y
    from rg_calls where moved_to_ava_at is null and not coalesce(is_test, false) and coalesce(direction, 'outbound') = 'outbound' and queued_at >= y0 and queued_at < d0;
  if not coalesce(rs.calling_enabled, false) then
    lines := lines || ('RoofGuard: calling is paused (pilot on hold)' || case when rg_calls_y > 0 then '; yesterday ' || rg_calls_y || ' calls, ' || rg_booked_y || ' booked' else '' end || '.');
    has := has or rg_calls_y > 0;
  else
    lines := lines || ('RoofGuard: ' || rg_calls_y || ' calls yesterday, ' || rg_booked_y || ' booked. Today: up to ' || rs.daily_cap || ' calls.');
    has := true;
  end if;

  return jsonb_build_object('title', 'Ava (assistant): your morning', 'body', array_to_string(lines, E'\n'), 'empty', not has,
                            'calendar', case when c.day is null then 'missing' when c.ok then 'cached' else 'failed' end);
end $$;
revoke all on function public.ava_brief_compose(date) from public, anon, authenticated;

-- alert once if the brief is late (15 minutes after its time) or failed
create or replace function public.ava_brief_watch() returns text
language plpgsql security definer set search_path to 'public' as $$
declare tz constant text := 'America/Los_Angeles'; a ava_settings; v_now timestamp := now() at time zone tz; v_day date := (now() at time zone tz)::date;
        v_min int := extract(hour from v_now)::int * 60 + extract(minute from v_now)::int; l ava_brief_log;
begin
  select * into a from ava_settings limit 1;
  if not coalesce(a.brief_enabled, true) then return 'off'; end if;
  select * into l from ava_brief_log where day = v_day;
  if (l.day is null or l.status = 'failed') and v_min >= a.brief_minute + 15 then
    perform scout_notify('Ava (assistant): your morning brief did not go out',
      'It was due at ' || to_char(time '00:00' + make_interval(mins => a.brief_minute), 'FMHH12:MI AM') || ' Pacific'
        || case when l.note is not null then ' (' || left(l.note, 160) || ')' else '' end
        || '. She keeps trying every 5 minutes; if it stays quiet, open /admin/ava.',
      'warning', true, 'https://bestly.tech/admin/ava', 'ava-brief-late-' || v_day);
    return 'alerted';
  end if;
  return 'ok';
end $$;
revoke all on function public.ava_brief_watch() from public, anon, authenticated;
grant execute on function public.ava_brief_watch() to service_role;

-- every 5 minutes from 5 AM to noon Pacific
create or replace function public.ava_brief_tick() returns text
language plpgsql security definer set search_path to 'public' as $$
declare tz constant text := 'America/Los_Angeles'; a ava_settings; v_now timestamp := now() at time zone tz; v_day date := (now() at time zone tz)::date;
        v_min int := extract(hour from v_now)::int * 60 + extract(minute from v_now)::int; c ava_brief_cache; r jsonb;
begin
  select * into a from ava_settings limit 1;
  if not coalesce(a.brief_enabled, true) then return 'off'; end if;
  if exists (select 1 from ava_brief_log where day = v_day and status in ('sent', 'skipped')) then return 'done'; end if;
  if v_min < a.brief_minute - 10 then return 'early'; end if;

  select * into c from ava_brief_cache where day = v_day;
  if c.day is null or c.fetched_at < now() - interval '45 minutes' then
    if v_min < a.brief_minute + 10 then
      -- ask for today's calendar (at most every 4 minutes); the next tick composes from it
      if a.brief_fetch_at is null or a.brief_fetch_at < now() - interval '4 minutes' then
        update ava_settings set brief_fetch_at = now() where id;
        perform invoke_edge_function('ava-assistant', '{"action":"today","day_offset":0}'::jsonb, 60000);
      end if;
      return 'fetching';
    end if;
    -- ten minutes late with no calendar: send without it
  end if;
  if v_min < a.brief_minute then return 'ready'; end if;

  begin
    r := ava_brief_compose(v_day);
    if (r->>'empty')::boolean then
      insert into ava_brief_log (day, status, note) values (v_day, 'skipped', 'nothing to say') on conflict (day) do update set status = excluded.status, note = excluded.note, at = now();
      return 'skipped';
    end if;
    perform scout_notify(r->>'title', r->>'body', 'info', true, 'https://bestly.tech/admin/ava', 'ava-brief-' || v_day);
    insert into ava_brief_log (day, status, body) values (v_day, 'sent', r->>'body') on conflict (day) do update set status = excluded.status, body = excluded.body, note = null, at = now();
    return 'sent';
  exception when others then
    insert into ava_brief_log (day, status, note) values (v_day, 'failed', left(sqlerrm, 300)) on conflict (day) do update set status = excluded.status, note = excluded.note, at = now();
    perform ava_brief_watch();
    return 'failed';
  end;
end $$;
revoke all on function public.ava_brief_tick() from public, anon, authenticated;

-- the preview in Settings: what tomorrow's brief would say, from the calendar cache for tomorrow (the page fills it first)
create or replace function public.admin_ava_brief_preview() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_day date := ((now() at time zone 'America/Los_Angeles')::date + 1); r jsonb;
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then raise exception 'Admins only'; end if;
  r := ava_brief_compose(v_day);
  return r || jsonb_build_object('day', v_day,
    'last', (select jsonb_build_object('day', l.day, 'status', l.status, 'at', l.at) from ava_brief_log l order by l.day desc limit 1));
end $$;
revoke all on function public.admin_ava_brief_preview() from public, anon;
grant execute on function public.admin_ava_brief_preview() to authenticated;

select cron.schedule('ava-morning-brief', '*/5 12-20 * * *', $$select public.ava_brief_tick();$$);

-- Ava's team card (same slug, updated in place): the brief belongs to her, so her schedule list names it and her alerts cover it
select public.team_onboard($j$[
 {"slug":"ava","name":"Ava","role":"Personal Assistant","reports_to":"jared","dept":"desk","runs_on":"cloud","icon":"hand-helping","welcome":false,
  "schedule":"answers (816) 429-9495 any time; morning brief at 8:00 AM Pacific","admin_url":"/admin/ava","sort":5,
  "what_it_does":"Answers your personal line, (816) 429-9495, and the calls you miss on your own cell, casually, with a quick recording notice on her second line. Takes messages, makes calls for you, and can connect a call to your cell. After each call she suggests the next step as a button on the message: Find times, Call back, Reply by call, Mark done. Find times reads your iCloud and Nextcloud calendars (free or busy only, never the details; a Turo trip blocks only an hour around pickup and return) and lists up to six open slots inside your hours. Nothing dials until you tap a slot and confirm; then she calls the person back, offers that time with two backups, and when they agree she adds it to the calendar you marked. Checks the calendar logins from ava-watch (alerts: Ava (assistant): can't read your calendar, and Ava (assistant): I can sign in to iCloud but can't see your calendars; both grey out Find times) and reports bookings (Ava (assistant): booked your ... for ...). Sends one morning brief at 8:00 AM Pacific (Ava (assistant): your morning): messages waiting, call-backs owed, today's calendar, what the reply guard says needs you, yesterday's spend, one RoofGuard line; plain text, no AI, silent when there is nothing to say; alerts if it is more than 15 minutes late. The reply guard shows each issue with its next step: fixed automatically, the Coach is on it, the Coach learned it, or needs you (Teach the Coach, Ask Scout to fix). Plays along with spam callers for up to two minutes and tracks each company for Do Not Call claims.",
  "pulse":{"src":"at","table":"ava_line_health","col":"checked_at","ok":"ok","sum":"case when ok then 'Line OK' else 'Line problem' end","where":"source = 'ava'","gap":30,"alert":true,"also":["ava-watch","ava-followups","ava-morning-brief"]},
  "owns":["ava","ava-brief"]}
]$j$::jsonb);
