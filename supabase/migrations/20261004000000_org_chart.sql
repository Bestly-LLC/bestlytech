-- 2026-10-03 Org chart ("Team" page, /admin/team). Plan: docs/org-chart-opusplan.md
-- One roster (bestly_agents) + one heartbeat (agent_beat) + one read (admin_org_chart) + a watchdog that
-- hands silent bots to the Fix Ladder / Scout (team.silent.<slug>) and a ping the Pi can call to watch the watcher.
-- Each bot is read where it ALREADY logs (pulse jsonb); agent_beat is only for bots with no log of their own.
--
-- pulse jsonb:
--   src      at | pi_job | cron | beat | pi_any | cron_family | none
--   gap      minutes allowed between check-ins (yellow after gap, red after 2x gap)
--   on_demand  true = only works when asked; silence is never red
--   alert    true = team_watch raises team.silent.<slug> (only for bots with no watchdog of their own)
--   issues   monitor_issues key prefixes shown on the card
--   at:   table, col, where?, ok? (sql bool expr), sum? (sql text expr)
--   pi_job: key      cron: job      cron_family: like      beat: (none)

-- ------------------------------------------------------------------ tables
create table if not exists public.bestly_agents (
  slug          text primary key,
  name          text not null,
  role          text not null,
  what_it_does  text not null,
  dept          text not null default 'unassigned',
  reports_to    text references public.bestly_agents(slug) on delete set null,
  kind          text not null default 'agent' check (kind in ('human','agent','job','open_role')),
  status        text not null default 'active' check (status in ('active','paused','planned','retired','new')),
  runs_on       text,
  schedule      text,
  admin_url     text,
  icon          text,
  pulse         jsonb,
  private       boolean not null default false,
  sort          int not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.bestly_agents enable row level security;
revoke all on public.bestly_agents from anon, authenticated;

create table if not exists public.agent_beats (
  slug    text primary key references public.bestly_agents(slug) on delete cascade,
  at      timestamptz not null default now(),
  ok      boolean not null default true,
  summary text
);
alter table public.agent_beats enable row level security;
revoke all on public.agent_beats from anon, authenticated;

create table if not exists public.team_watch_state (
  id         int primary key default 1 check (id = 1),
  checked_at timestamptz,
  red        int,
  raised     int,
  resolved   int,
  discovered int,
  error      text
);
insert into public.team_watch_state (id) values (1) on conflict do nothing;
alter table public.team_watch_state enable row level security;
revoke all on public.team_watch_state from anon, authenticated;

-- ------------------------------------------------------------------ auth helper
create or replace function public.team_is_admin() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select current_user in ('postgres','supabase_admin')
      or coalesce(auth.role(), '') = 'service_role'
      or coalesce(public.has_role(auth.uid(), 'admin'::app_role), false)
$$;
revoke all on function public.team_is_admin() from public, anon;

-- ------------------------------------------------------------------ heartbeat any bot can send
create or replace function public.agent_beat(p_slug text, p_ok boolean default true, p_summary text default null, p_token text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_slug text := lower(trim(p_slug)); v_new boolean := false;
begin
  if not (team_is_admin() or (p_token is not null and p_token = get_home_hub_agent_key())) then
    raise exception 'not allowed';
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9][a-z0-9-]{1,48}$' then raise exception 'bad slug'; end if;
  if not exists (select 1 from bestly_agents where slug = v_slug) then
    insert into bestly_agents (slug, name, role, what_it_does, dept, status, kind, pulse)
    values (v_slug, initcap(replace(v_slug, '-', ' ')), 'New hire', coalesce(left(p_summary, 200), 'Checked in for the first time.'),
            'unassigned', 'new', 'agent', '{"src":"beat","gap":1500}'::jsonb);
    v_new := true;
  end if;
  insert into agent_beats (slug, at, ok, summary) values (v_slug, now(), coalesce(p_ok, true), left(p_summary, 500))
  on conflict (slug) do update set at = now(), ok = excluded.ok, summary = excluded.summary;
  return jsonb_build_object('ok', true, 'new_hire', v_new);
end $$;
revoke all on function public.agent_beat(text, boolean, text, text) from public, anon;
grant execute on function public.agent_beat(text, boolean, text, text) to anon, authenticated, service_role;  -- key-gated inside

-- ------------------------------------------------------------------ pulse reader (one pass for everyone)
create or replace function public.team_pulses()
returns table (slug text, last_at timestamptz, last_ok boolean, summary text)
language plpgsql security definer set search_path to 'public', 'cron' as $$
declare
  a record; p jsonb; v_cron jsonb; r record;
  v_at timestamptz; v_ok boolean; v_sum text;
begin
  -- latest run per cron job in the last 3 days, read once (job_run_details has no jobid index)
  select coalesce(jsonb_object_agg(j.jobname, jsonb_build_object('at', d.end_time, 'start', d.start_time, 'ok', d.status = 'succeeded', 'msg', left(d.return_message, 160))), '{}')
    into v_cron
    from cron.job j
    join lateral (select x.end_time, x.start_time, x.status, x.return_message
                    from (select distinct on (jobid) jobid, end_time, start_time, status, return_message
                            from cron.job_run_details where start_time > now() - interval '3 days'
                           order by jobid, start_time desc) x where x.jobid = j.jobid) d on true;

  for a in select * from bestly_agents where status <> 'retired' and pulse is not null loop
    p := a.pulse; v_at := null; v_ok := null; v_sum := null;
    begin
      case p->>'src'
        when 'at' then
          execute format('select %I::timestamptz, (%s)::boolean, (%s)::text from %I where %s order by %I desc nulls last limit 1',
                         p->>'col', coalesce(p->>'ok', 'true'), coalesce(p->>'sum', 'null'), p->>'table',
                         coalesce(p->>'where', 'true'), p->>'col')
            into v_at, v_ok, v_sum;
        when 'pi_job' then
          select coalesce(j.last_run_at, j.last_ok_at), j.last_ok, j.last_summary into v_at, v_ok, v_sum
            from pi_jobs j where j.job = p->>'key';
        when 'pi_any' then
          select max(last_run_at), bool_and(coalesce(consecutive_failures, 0) = 0),
                 count(*) filter (where enabled) || ' jobs, ' || count(*) filter (where enabled and coalesce(consecutive_failures,0) > 0) || ' failing'
            into v_at, v_ok, v_sum from pi_jobs where enabled;
        when 'cron' then
          v_at := coalesce((v_cron->(p->>'job')->>'at')::timestamptz, (v_cron->(p->>'job')->>'start')::timestamptz);
          v_ok := (v_cron->(p->>'job')->>'ok')::boolean;
          v_sum := case when v_ok is false then 'Last run failed: ' || coalesce(v_cron->(p->>'job')->>'msg', '') end;
        when 'cron_family' then
          select max(coalesce((e.value->>'at')::timestamptz, (e.value->>'start')::timestamptz)),
                 bool_and((e.value->>'ok')::boolean),
                 count(*) || ' checks, ' || count(*) filter (where not (e.value->>'ok')::boolean) || ' failing'
            into v_at, v_ok, v_sum
            from jsonb_each(v_cron) e where e.key like (p->>'like');
        when 'beat' then
          select b.at, b.ok, b.summary into v_at, v_ok, v_sum from agent_beats b where b.slug = a.slug;
        else null;
      end case;
    exception when others then
      v_at := null; v_ok := false; v_sum := 'Could not read its check-in: ' || left(sqlerrm, 120);
    end;
    -- a Claude scheduled task can also send agent_beat on top of its table pulse: take the newer
    if p->>'src' <> 'beat' then
      select b.at as bat, b.ok as bok, coalesce(b.summary, v_sum) as bsum into r from agent_beats b
       where b.slug = a.slug and (v_at is null or b.at > v_at);
      if found then v_at := r.bat; v_ok := r.bok; v_sum := r.bsum; end if;
    end if;
    slug := a.slug; last_at := v_at; last_ok := v_ok; summary := v_sum;
    return next;
  end loop;
end $$;
revoke all on function public.team_pulses() from public, anon, authenticated;

-- raw health (ignores team.silent so the watchdog can't latch itself)
create or replace function public.team_health(p_status text, p_pulse jsonb, p_at timestamptz, p_ok boolean)
returns text language sql stable as $$
  select case
    when p_status in ('paused','planned','retired') then p_status
    when p_pulse is null or p_pulse->>'src' in ('none') then 'unknown'
    when p_at is null then 'unknown'
    when coalesce((p_pulse->>'on_demand')::boolean, false) then case when p_ok is false then 'yellow' else 'green' end
    when now() - p_at > make_interval(mins => 2 * coalesce((p_pulse->>'gap')::int, 60)) then 'red'
    when now() - p_at > make_interval(mins => coalesce((p_pulse->>'gap')::int, 60)) then 'yellow'
    when p_ok is false then 'yellow'
    else 'green' end
$$;

-- ------------------------------------------------------------------ the chart
create or replace function public.admin_org_chart()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_rows jsonb; v_issues jsonb;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'title', title, 'severity', severity,
           'fix_stage', fix_stage, 'opened_at', opened_at, 'needs_jared', needs_jared)), '[]')
    into v_issues from monitor_issues where status = 'open';

  with p as (select * from team_pulses()),
  rows as (
    select a.*, p.last_at, p.last_ok, p.summary,
           team_health(a.status, a.pulse, p.last_at, p.last_ok) raw_health,
           (select coalesce(jsonb_agg(i), '[]') from jsonb_array_elements(v_issues) i
             where i->>'key' = 'team.silent.' || a.slug
                or exists (select 1 from jsonb_array_elements_text(coalesce(a.pulse->'issues', '[]')) pre
                            where i->>'key' like pre || '%')) issues
      from bestly_agents a left join p on p.slug = a.slug
     where a.status <> 'retired')
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', slug, 'name', name, 'role', role, 'what_it_does', what_it_does, 'dept', dept,
           'reports_to', reports_to, 'kind', kind, 'status', status, 'runs_on', runs_on, 'schedule', schedule,
           'admin_url', admin_url, 'icon', icon, 'private', private, 'sort', sort,
           'last_at', last_at, 'last_ok', last_ok, 'summary', summary,
           'gap_min', (pulse->>'gap')::int, 'on_demand', coalesce((pulse->>'on_demand')::boolean, false),
           'watched', coalesce((pulse->>'alert')::boolean, false), 'source', pulse->>'src',
           'issues', issues,
           'health', case
              when raw_health in ('paused','planned') then raw_health
              when exists (select 1 from jsonb_array_elements(issues) i where i->>'key' = 'team.silent.' || slug) then 'red'
              when raw_health = 'green' and jsonb_array_length(issues) > 0 then 'yellow'
              else raw_health end
         ) order by sort, name), '[]')
    into v_rows from rows;

  return jsonb_build_object('agents', v_rows,
    'checked_at', (select checked_at from team_watch_state where id = 1),
    'now', now());
end $$;
revoke all on function public.admin_org_chart() from public, anon;
grant execute on function public.admin_org_chart() to authenticated, service_role;

-- red dot for the sidebar: cheap (open team alerts only), called every minute
create or replace function public.admin_team_red_count() returns int
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not team_is_admin() then return 0; end if;
  return (select count(*) from monitor_issues where status = 'open' and (key like 'team.silent.%' or key = 'team.watch.stale'));
end $$;
revoke all on function public.admin_team_red_count() from public, anon;
grant execute on function public.admin_team_red_count() to authenticated, service_role;

-- ------------------------------------------------------------------ edits from the page
create or replace function public.admin_agent_set(p_slug text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v bestly_agents; v_boss text; v_hop int := 0;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  select * into v from bestly_agents where slug = p_slug for update;
  if v.slug is null then raise exception 'no such bot'; end if;
  if p_patch ? 'status' and p_patch->>'status' not in ('active','paused','planned','retired') then raise exception 'bad status'; end if;
  if p_patch ? 'dept' and p_patch->>'dept' not in ('top','scout','ops','studio','turo','sales','mail','home','desk','unassigned') then
    raise exception 'bad department';
  end if;
  if p_patch ? 'reports_to' and nullif(p_patch->>'reports_to', '') is not null then
    v_boss := p_patch->>'reports_to';
    while v_boss is not null and v_hop < 20 loop
      if v_boss = p_slug then raise exception 'that would make it report to itself'; end if;
      select reports_to into v_boss from bestly_agents where slug = v_boss;
      v_hop := v_hop + 1;
    end loop;
  end if;
  update bestly_agents set
    name         = coalesce(nullif(trim(p_patch->>'name'), ''), name),
    role         = coalesce(nullif(trim(p_patch->>'role'), ''), role),
    what_it_does = coalesce(nullif(trim(p_patch->>'what_it_does'), ''), what_it_does),
    dept         = coalesce(p_patch->>'dept', dept),
    reports_to   = case when p_patch ? 'reports_to' then nullif(p_patch->>'reports_to', '') else reports_to end,
    status       = case when p_patch ? 'status' then p_patch->>'status'
                        when status = 'new' and p_patch ? 'dept' then 'active' else status end,
    admin_url    = case when p_patch ? 'admin_url' then nullif(p_patch->>'admin_url', '') else admin_url end,
    private      = coalesce((p_patch->>'private')::boolean, private),
    sort         = coalesce((p_patch->>'sort')::int, sort),
    updated_at   = now()
  where slug = p_slug returning * into v;
  return to_jsonb(v);
end $$;
revoke all on function public.admin_agent_set(text, jsonb) from public, anon;
grant execute on function public.admin_agent_set(text, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------------ discovery: new bots introduce themselves
create or replace function public.team_discover() returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int := 0; c int;
begin
  insert into bestly_agents (slug, name, role, what_it_does, dept, status, runs_on, pulse)
  select 'pi-' || replace(j.job, '_', '-'), initcap(replace(j.job, '_', ' ')), 'New hire',
         coalesce(j.description, 'A scheduled job on the Pi.'), 'unassigned', 'new', 'pi',
         jsonb_build_object('src', 'pi_job', 'key', j.job, 'gap', coalesce(j.max_gap_min, 60))
    from pi_jobs j
   where j.enabled
     and not exists (select 1 from bestly_agents a
                      where (a.pulse->>'src' = 'pi_job' and a.pulse->>'key' = j.job)
                         or coalesce(a.pulse->'also', '[]') ? j.job)
  on conflict (slug) do nothing;
  get diagnostics c = row_count; n := n + c;

  insert into bestly_agents (slug, name, role, what_it_does, dept, status, runs_on, pulse)
  select 'hub-' || s.agent, initcap(replace(s.agent, '-', ' ')), 'New hire', 'An agent on the Pi that checks in with Home Hub.',
         'unassigned', 'new', 'pi',
         jsonb_build_object('src', 'at', 'table', 'home_hub_agent_state', 'col', 'last_seen_at',
                            'where', format('agent = %L', s.agent), 'gap', 15)
    from home_hub_agent_state s
   where not exists (select 1 from bestly_agents a where a.pulse->>'table' = 'home_hub_agent_state'
                       and a.pulse->>'where' = format('agent = %L', s.agent))
  on conflict (slug) do nothing;
  get diagnostics c = row_count; n := n + c;

  insert into bestly_agents (slug, name, role, what_it_does, dept, status, runs_on, pulse)
  select 'mac-' || m.name, initcap(replace(m.name, '-', ' ')), 'New hire', 'A Mac that runs jobs you approve.',
         'unassigned', 'new', 'mac',
         jsonb_build_object('src', 'at', 'table', 'mac_agents', 'col', 'last_seen_at',
                            'where', format('name = %L', m.name), 'gap', 60)
    from mac_agents m
   where not exists (select 1 from bestly_agents a where a.pulse->>'table' = 'mac_agents'
                       and a.pulse->>'where' = format('name = %L', m.name))
  on conflict (slug) do nothing;
  get diagnostics c = row_count; n := n + c;

  update team_watch_state set discovered = n where id = 1;
  return n;
end $$;
revoke all on function public.team_discover() from public, anon, authenticated;

-- ------------------------------------------------------------------ the watchdog
create or replace function public.team_watch() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  a record; v_red int := 0; v_raised int := 0; v_resolved int := 0; v_when text; v_key text;
begin
  for a in
    select b.*, p.last_at, p.last_ok, p.summary, team_health(b.status, b.pulse, p.last_at, p.last_ok) h
      from bestly_agents b left join team_pulses() p on p.slug = b.slug
     where b.status in ('active','new') and coalesce((b.pulse->>'alert')::boolean, false)
  loop
    v_key := 'team.silent.' || a.slug;
    if a.h = 'red' then
      v_red := v_red + 1;
      v_when := coalesce(to_char(a.last_at at time zone 'America/Los_Angeles', 'FMHH12:MI AM "on" Mon FMDD'), 'never');
      perform bestly_raise(v_key, 'problem', 'warning',
        a.name || ' has gone quiet',
        format('%s (%s) last checked in at %s. It should check in about every %s minutes. It runs on %s%s.%s',
               a.name, a.what_it_does, v_when, coalesce(a.pulse->>'gap', '60'), coalesce(a.runs_on, 'unknown'),
               coalesce(' (' || a.schedule || ')', ''),
               coalesce(E'\nLast thing it said: ' || a.summary, '')),
        'team', null, false);
      v_raised := v_raised + 1;
    elsif a.h in ('green','yellow') and exists (select 1 from monitor_issues where key = v_key and status = 'open') then
      perform bestly_raise(v_key, 'resolved', 'info', a.name || ' is checking in again');
      v_resolved := v_resolved + 1;
    end if;
  end loop;

  -- paused / retired bots never keep an alert open
  for a in select b.slug, b.name from bestly_agents b
            where b.status in ('paused','planned','retired')
              and exists (select 1 from monitor_issues m where m.key = 'team.silent.' || b.slug and m.status = 'open') loop
    perform bestly_raise('team.silent.' || a.slug, 'resolved', 'info', a.name || ' is paused');
  end loop;

  update team_watch_state set checked_at = now(), red = v_red, raised = v_raised, resolved = v_resolved, error = null where id = 1;
  return jsonb_build_object('red', v_red, 'raised', v_raised, 'resolved', v_resolved);
end $$;
revoke all on function public.team_watch() from public, anon, authenticated;

-- watching the watcher: the Pi (or anything with the Home Hub key) calls this; it recovers a stale watch itself
create or replace function public.team_watch_ping(p_token text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_at timestamptz; v_ran boolean := false; v_res jsonb;
begin
  if not (team_is_admin() or (p_token is not null and p_token = get_home_hub_agent_key())) then raise exception 'not allowed'; end if;
  select checked_at into v_at from team_watch_state where id = 1;
  if v_at is null or v_at < now() - interval '30 minutes' then
    perform bestly_raise('team.watch.stale', 'problem', 'warning', 'The Team page watchdog stopped running',
      format('The check that watches every bot last ran %s. The Pi just ran it by hand, so alerts keep working, '
             'but the database schedule (cron job org-chart-watch) needs a look.',
             coalesce(to_char(v_at at time zone 'America/Los_Angeles', 'FMHH12:MI AM "on" Mon FMDD'), 'never')),
      'team', null, true);
    execute 'select public.team_watch()' into v_res;
    v_ran := true;
  else
    perform bestly_raise('team.watch.stale', 'resolved', 'info', null);
  end if;
  perform agent_beat('team-watch-ping', true, case when v_ran then 'Watchdog was stale; ran it by hand' else 'Watchdog is on time' end);
  return jsonb_build_object('ok', true, 'checked_at', v_at, 'recovered', v_ran, 'result', v_res);
end $$;
revoke all on function public.team_watch_ping(text) from public, anon;
grant execute on function public.team_watch_ping(text) to authenticated, service_role, anon;  -- anon allowed: key-gated inside

-- ------------------------------------------------------------------ seed: the team as of 2026-10-03
insert into public.bestly_agents (slug, name, role, what_it_does, dept, reports_to, kind, status, runs_on, schedule, admin_url, icon, private, sort, pulse) values
-- top
('jared','Jared Best','Founder & CEO','Runs Bestly. Says yes to anything that can''t be undone.','top',null,'human','active',null,null,null,'crown',false,0,null),
('scout','Scout','Chief of Staff','The assistant in the corner of the admin. Finds problems, writes the fix, and waits for your tap. Free AI first; paid only when the Paid AI switch is on.','top','jared','agent','active','cloud','when you ask','/admin','binoculars',false,1,
 '{"src":"at","table":"admin_chat_messages","col":"created_at","where":"role = ''assistant''","on_demand":true,"issues":["scout.","ai."]}'),

-- Scout's team
('scout-autopilot','Scout Autopilot','Night shift','Works open problems in the background. It can look and suggest, but can''t do anything risky without you.','scout','scout','agent','active','pi','every 10 min',null,'moon',false,10,
 '{"src":"pi_job","key":"autopilot_loop","gap":90}'),
('scout-daily','Scout Daily','Planner','Picks your Today''s 3 and the one thing on the wall.','scout','scout','agent','active','cloud','every hour','/admin','calendar-check',false,11,
 '{"src":"cron","job":"scout-daily-tick","gap":70}'),
('scout-learner','Scout Learner','Coach','Reads what went wrong and writes lessons so Scout doesn''t repeat mistakes.','scout','scout','agent','active','cloud','every hour','/admin/playbook','graduation-cap',false,12,
 '{"src":"cron","job":"scout-reflect","gap":70}'),
('hey-scout','Hey Scout','Voice','Hears "Hey Scout" on the desk mic and answers out loud on the HomePod.','scout','scout','agent','active','pi','always on','/admin/wall','mic',false,13,
 '{"src":"at","table":"wall_voice_status","col":"at","ok":"coalesce((status->>''mic_ok'')::boolean, true)","sum":"case when (status->>''mic_ok'')::boolean is false then ''Mic problem: '' || coalesce(status->>''mic_err'', ''unknown'') end","gap":30,"alert":true}'),
('scout-notetaker','Scout Notetaker','Note taker','Joins your Talk calls, records them, names who spoke, and writes the transcript.','scout','scout','agent','active','mac_mini','always on','/admin/meetings','notebook-pen',false,14,
 '{"src":"at","table":"meeting_recorder_state","col":"last_seen_at","sum":"''Recorder is '' || coalesce(status, ''?'')","gap":20,"issues":["recorder"]}'),
('clips-worker','Clips Worker','Note taker''s helper','Turns audio you AirDrop or upload into transcripts.','scout','scout-notetaker','agent','active','mac_mini','when a clip arrives','/admin/meetings','audio-lines',false,15,
 '{"src":"at","table":"voice_clips","col":"created_at","ok":"status <> ''failed''","sum":"title || '' ('' || status || '')''","on_demand":true}'),
('partner-scout','Partner Scout','Eli''s assistant','Scout inside the partner portal. Eli only sees Centering YOU.','scout','scout','agent','active','pi','always on','/admin/partners','handshake',false,16,
 '{"src":"at","table":"partner_ai_status","col":"seen_at","sum":"''Model '' || coalesce(model, ''?'')","gap":20,"issues":["partner"]}'),
('todo-checker','To-do Checker','Closer','Checks whether a to-do is really done. Closes the proven ones every night at 10 PM.','scout','scout','agent','active','cloud','every hour','/admin','list-checks',false,17,
 '{"src":"cron","job":"todo-check-tick","gap":70}'),

-- Ops & Security
('fix-ladder','Fix Ladder','Head of Ops','Every problem climbs a ladder: fix itself, then free AI, then Scout, then you.','ops','scout','agent','active','cloud','every 10 min',null,'ladder',false,20,
 '{"src":"cron","job":"fix-ladder","gap":20}'),
('system-monitor','System Monitor','Alarm','Checks the sites, database and services, and opens a problem when something breaks.','ops','fix-ladder','agent','active','cloud','every 5 min',null,'activity',false,21,
 '{"src":"cron","job":"bestly-monitor","gap":10}'),
('watchdogs','Watchdogs','Lookouts','About 40 small checks, one per system (car, wall, Studio, keys…). Each one shouts when its system goes quiet.','ops','fix-ladder','agent','active','cloud','every 5 to 60 min',null,'dog',false,22,
 '{"src":"cron_family","like":"%watch%","gap":20}'),
('free-ai-fixer','Free-AI Fixer','Mechanic','Writes the cause and the fix for each problem using a free AI model.','ops','fix-ladder','agent','active','mac_mini','when a problem opens',null,'wrench',false,23,
 '{"src":"at","table":"fix_ai_jobs","col":"created_at","ok":"status <> ''failed''","sum":"''Last job: '' || status","on_demand":true}'),
('security-auditor','Security Auditor','Security guard','Checks every live site and app for security holes at 1 AM. Looks only, never changes anything.','ops','fix-ladder','agent','active','claude','nightly 1 AM','/admin/security','shield-check',false,24,
 '{"src":"at","table":"security_audit_runs","col":"finished_at","sum":"open_red || '' red, '' || open_yellow || '' yellow open''","gap":1560,"alert":true}'),
('studio-watch','Studio Watch','Lookout','Opens Studio every 5 minutes to make sure it loads.','ops','fix-ladder','agent','active','pi','every 5 min',null,'eye',false,25,
 '{"src":"pi_job","key":"studio_watch","gap":30}'),
('db-watch','Database Watch','Lookout','Spots the database freezing and sheds load before it falls over.','ops','fix-ladder','agent','active','cloud','every 5 min',null,'database',false,26,
 '{"src":"at","table":"db_watch_state","col":"last_ok_at","gap":15}'),
('ai-watch','AI Provider Watch','Lookout','Pauses a free AI provider that keeps failing and turns it back on when it recovers.','ops','fix-ladder','agent','active','cloud','every 10 min',null,'cpu',false,27,
 '{"src":"at","table":"freellm_watch_state","col":"updated_at","ok":"coalesce(fails, 0) = 0","sum":"case when coalesce(fails,0) > 0 then fails || '' failures in a row'' end","gap":25,"issues":["ai.free"]}'),
('pi-runner','Pi Job Runner','Hands','Runs the scheduled jobs on the Pi and reports each run.','ops','fix-ladder','agent','active','pi','always on','/admin/home-hub','server',false,28,
 '{"src":"pi_any","gap":30}'),
('mac-hands','Mac Hands','Hands','Runs jobs on your Mac after you tap yes.','ops','fix-ladder','agent','active','macbook','when you approve a job',null,'laptop',false,29,
 '{"src":"at","table":"mac_agents","col":"last_seen_at","where":"name = ''jareds-macbook-air''","on_demand":true}'),
('team-watch','Team Watch','Roll call','Checks every bot on this page every 10 minutes and tells Scout when one goes quiet.','ops','fix-ladder','agent','active','cloud','every 10 min','/admin/team','users',false,30,
 '{"src":"cron","job":"org-chart-watch","gap":25,"issues":["team.watch"]}'),
('team-watch-ping','Team Watch Backup','Roll call backup','Runs from the Pi and restarts Team Watch if it stops.','ops','team-watch','agent','active','pi','every 15 min','/admin/team','repeat',false,31,
 '{"src":"beat","gap":45}'),

-- Studio & Marketing
('spark','Spark','Head of Studio','The chat inside Studio. Writes and edits posts with you.','studio','jared','agent','active','cloud','when you ask',null,'sparkles',false,40,
 '{"src":"at","table":"studio_chat_actions","col":"created_at","on_demand":true}'),
('studio-rewriter','Rewriter','Copywriter','Rewrites posts using the change notes you leave in Studio.','studio','spark','agent','active','pi','every hour',null,'pen-line',false,41,
 '{"src":"pi_job","key":"studio_regen","gap":150}'),
('ask-builder','Ask Builder','Builder','Builds the change requests people send from Studio''s Ask button.','studio','spark','agent','active','claude','every 20 min, 6 AM to 10 PM',null,'hammer',false,42,
 '{"src":"beat","gap":540,"alert":true,"also":["studio_ask"]}'),
('daily-post','Daily Poster','Social media','Makes and posts the daily Instagram and Facebook post.','studio','spark','agent','active','claude','daily 10 AM',null,'image',false,43,
 '{"src":"beat","gap":1500,"alert":true}'),
('weekly-carousel','Carousel Maker','Social media','Builds the weekly Instagram carousel.','studio','spark','agent','active','pi','checks daily, posts Tuesdays',null,'gallery-horizontal',false,44,
 '{"src":"pi_job","key":"bestly_social","gap":1560}'),
('poster','Post Sender','Publisher','Sends approved posts out to Instagram and TikTok.','studio','spark','agent','active','cloud','every 5 min',null,'send',false,45,
 '{"src":"cron","job":"social-drain-instagram","gap":15,"issues":["studio:posting"]}'),
('hoku-post-check','HOKU Post Checker','Proofreader','Every morning at 9:30 AM makes sure today''s HOKU post is queued and clean.','studio','spark','agent','active','pi','daily 9:30 AM',null,'spray-can',false,46,
 '{"src":"pi_job","key":"hoku_prepost","gap":1560}'),
('transcoder','Transcoder','Video tech','Turns client recordings into videos that play anywhere.','studio','spark','agent','active','pi','every 15 min, 7 AM to midnight',null,'clapperboard',false,47,
 '{"src":"pi_job","key":"transcode","gap":540}'),
('cy-pipeline','Cookie Yeti Pipeline','Content robot','The Cookie Yeti AI content run on Make.com.','studio','spark','agent','active','external','on Make.com',null,'cookie',false,48,
 '{"src":"none"}'),

-- Turo
('turo-reader','Turo Reader','Head of Turo','Reads your Turo trips and guest messages and puts them on the wall.','turo','jared','agent','active','pi','every 2 min','/admin/turo','car',false,50,
 '{"src":"at","table":"turo_reader_state","col":"seen_at","ok":"coalesce(signed_in, false)","sum":"case when signed_in then ''Signed in'' else coalesce(last_error, ''Signed out of Turo'') end","gap":10,"issues":["turo.reader"]}'),
('turo-sender','Link Sender','Guest messages','Messages each new guest their trip link.','turo','turo-reader','agent','active','mac_mini','every 3 min','/admin/turo/settings','message-square-share',false,51,
 '{"src":"at","table":"turo_sender_settings","col":"seen_at","sum":"case when enabled then coalesce(''Error: '' || last_error, ''Sending is on'') else ''Sending is switched off'' end","gap":15}'),
('turo-watch-report','Turo Watch Report','Analyst','Twice a day (7 AM, 7 PM) checks prices, demand and your listing against nearby hosts.','turo','turo-reader','agent','active','claude','7:05 AM and 7:12 PM','/admin/turo','line-chart',false,52,
 '{"src":"beat","gap":780,"alert":true}'),
('turo-car-facts','Car Facts','Researcher','Every Monday refreshes the car facts guests see from TezLab.','turo','turo-reader','agent','active','claude','Mondays 9 AM',null,'book-open',false,53,
 '{"src":"beat","gap":10200,"alert":true}'),
('lax-concierge','LAX Concierge','Concierge','Makes each guest''s trip page, sends the reminder email and parking pass.','turo','turo-reader','agent','active','cloud','every 10 min','/admin/turo','plane-landing',false,54,
 '{"src":"cron","job":"lax-guest-tick","gap":25,"issues":["guest."]}'),
('key-keeper','Key Keeper','Valet','Sends guest Tesla keys once the license and your check-in are done.','turo','turo-reader','agent','active','pi','when a key is due','/admin/turo','key-round',false,55,
 '{"src":"at","table":"tesla_fleet_commands","col":"claimed_at","where":"via is null","on_demand":true,"issues":["tesla.worker","key"]}'),
('trip-checker','Trip Checker','Inspector','Checks every upcoming trip is set up right (keys, links, car).','turo','turo-reader','agent','active','cloud','every 10 min','/admin/turo','clipboard-check',false,56,
 '{"src":"cron","job":"trip-health","gap":25}'),
('car-guard','Car Guard','Security','Tells you if the car moves with no trip booked (but not when it''s you driving).','turo','turo-reader','agent','active','cloud','every 5 min',null,'siren',false,57,
 '{"src":"cron","job":"car-protect","gap":15,"issues":["car."]}'),
('sweep-guard','Sweep Guard','Parking','Warns you on the wall and HomePod before street sweeping gets the car.','turo','turo-reader','agent','active','cloud','every 5 min','/admin/street-sweeping','brush',false,58,
 '{"src":"cron","job":"bluesteel-sweep-tick","gap":15,"also":["street_sweep"]}'),

-- Sales & Clients
('roofguard-outreach','RoofGuard Outreach','Recruiter','Weekday emails asking roofing and building companies for an intro to Eli.','sales','jared','agent','active','claude','weekdays 9 AM','/admin/roofguard','mail-plus',false,60,
 '{"src":"beat","gap":4400,"alert":true}'),
('roofguard-finder','Phone Finder','Researcher','Finds phone numbers for RoofGuard leads.','sales','roofguard-outreach','agent','active','cloud','every 5 min','/admin/roofguard','search',false,61,
 '{"src":"cron","job":"roofguard-enrich","gap":20}'),
('roofguard-caller','RoofGuard Caller','Open role','Will call leads with an AI voice, reach the decision maker and book a meeting with Eli.','sales','roofguard-outreach','open_role','planned','cloud',null,'/admin/roofguard','phone-call',false,62,null),
('content-bot','Listing Bot','Realtor content','Turns listing emails from realtor clients into social posts.','sales','jared','agent','active','claude','every hour',null,'house',false,63,
 '{"src":"beat","gap":130,"alert":true}'),
('reddit-scout','Reddit Scout','Lead finder','Finds Reddit threads where Bestly Cloud could help and drafts a reply for you. Never posts.','sales','jared','agent','active','claude','daily 12:15 PM',null,'message-circle',false,64,
 '{"src":"beat","gap":1500,"alert":true}'),
('skytouch-triage','SkyTouch Front Desk','Front desk','Sends the first reply to new massage clients. Everything else waits for you.','sales','jared','agent','active','claude','every hour',null,'hand-heart',true,65,
 '{"src":"beat","gap":130,"alert":true}'),
('skytouch-morning','SkyTouch Morning Check','Scheduler','Checks your availability each morning for SkyTouch.','sales','skytouch-triage','agent','active','claude','daily 8 AM',null,'sunrise',true,66,
 '{"src":"beat","gap":1500,"alert":true}'),

-- Mail Room
('mail-bridge','Mail Bridge','Mail clerk','Pulls new mail from your inboxes into Bestly.','mail','jared','agent','active','pi','every 5 min',null,'inbox',false,70,
 '{"src":"pi_job","key":"mail_bridge","gap":20}'),
('sent-sync','Sent Sync','Mail clerk','Files copies of the mail you send.','mail','mail-bridge','agent','active','pi','every 10 min',null,'send-horizontal',false,71,
 '{"src":"pi_job","key":"sent_sync","gap":40}'),
('partner-mail','Partner Mail','Mail clerk','Handles the partner portal inbox.','mail','mail-bridge','agent','active','pi','every 10 min',null,'mails',false,72,
 '{"src":"pi_job","key":"partner_mail","gap":40}'),
('icloud-cleanup','Inbox Cleaner','Tidier','Cleans out your iCloud inbox every morning.','mail','mail-bridge','agent','active','claude','daily 6 AM',null,'trash-2',false,73,
 '{"src":"beat","gap":1500,"alert":true}'),

-- Home & Wall
('home-hub','Home Hub Agent','Head of Home','Runs the admin''s home buttons on the Pi and checks the home network.','home','jared','agent','active','pi','always on','/admin/home-hub','house-wifi',false,80,
 '{"src":"at","table":"home_hub_agent_state","col":"last_seen_at","where":"agent = ''home-hub''","sum":"''Version '' || version","gap":15,"issues":["agent."]}'),
('wall','Wall','Display','The projector wall: sky, cards, alerts and radio.','home','home-hub','agent','active','pi','always on','/admin/wall','projector',false,81,
 '{"src":"at","table":"wall_state","col":"pulled_at","where":"id = 1","gap":10,"issues":["wall."]}'),
('wall-watchdog','Wall Watchdog','Lookout','Keeps the projector awake and unfrozen.','home','wall','agent','active','pi','every minute','/admin/wall','scan-eye',false,82,
 '{"src":"at","table":"wall_state","col":"status_at","where":"id = 1","gap":10}'),
('ha-todo-sync','To-do Sync','Clerk','Keeps the Home Assistant "Bestly" list matched to your Today list.','home','home-hub','agent','active','pi','every minute','/admin/home-hub/home-assistant','list-todo',false,83,
 '{"src":"at","table":"ha_todo_sync_status","col":"last_ok","gap":10}'),
('home-narrator','Home Narrator','Announcer','Turns home events into alerts, and stays quiet while you''re home.','home','home-hub','agent','active','pi','every 5 min',null,'megaphone',false,84,
 '{"src":"beat","gap":30}'),

-- Your desk
('mercury-sync','Bookkeeper','Bookkeeper','Copies Mercury bank statements into Nextcloud every Monday.','desk','jared','agent','active','claude','Mondays 8 AM',null,'landmark',false,90,
 '{"src":"beat","gap":10200,"alert":true}'),
('job-finder','Job Finder','Recruiter','Finds new jobs near 90069 for you every morning.','desk','jared','agent','active','claude','daily 7 AM',null,'briefcase',false,91,
 '{"src":"beat","gap":1500,"alert":true}')
on conflict (slug) do nothing;

-- ------------------------------------------------------------------ schedules
select cron.unschedule(jobid) from cron.job where jobname in ('org-chart-watch','org-chart-discover');
select cron.schedule('org-chart-watch', '7-59/10 * * * *', $$select public.team_watch()$$);
select cron.schedule('org-chart-discover', '17 10 * * *', $$select public.team_discover()$$);  -- 3:17 AM PT
