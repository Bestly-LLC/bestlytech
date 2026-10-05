-- 2026-10-04 Onboarding protocol for both Avas + the fix so it can't happen again.
-- What happened: personal Ava (/admin/ava, (816) 429-9495) and RoofGuard Ava (/admin/roofguard) went live on Oct 4 and
-- took/made calls, but the Team page didn't know: personal Ava had no card, RoofGuard Ava still said "Open role".
-- Why: the roster keeper (The Recruiter, Head of People) only discovered new Pi jobs, Home Hub agents and Macs
-- (team_discover). Ava runs in the cloud (edge functions + database schedules + a phone line), so nothing noticed her,
-- and the sessions that built her never filled in a team card.
-- Fix (The Recruiter's new tools):
--   1. team_onboard(jsonb): the onboarding protocol for a bot that is already working: card, real title, pulse, tools,
--      alert ownership, welcome email, "on the job" note. Works for brand-new bots and for open roles that went live.
--   2. Roster Scanner (team_roster_scan, hourly with team_discover): finds database schedules no bot owns (grouped by
--      family, 2+ jobs) and open roles whose family is already running. New findings are told to Jared by The Recruiter
--      once, and kept in team_roster_findings. Today's existing gaps are baselined as "known" so only new ones ping.
--   3. Builders' rule (CLAUDE.md): every bot gets a team card the day it goes live.

-- ------------------------------------------------------------------ 1. onboarding protocol
create or replace function public.team_onboard(p jsonb) returns int
language plpgsql security definer set search_path to 'public' as $$
declare r jsonb; v_owner bestly_agents; v_boss text; v_dept text; n int := 0; v_tool boolean;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  for r in select * from jsonb_array_elements(p) loop
    v_tool := r ? 'tool_of';
    v_boss := coalesce(r->>'tool_of', r->>'reports_to');
    select * into v_owner from bestly_agents where slug = v_boss;
    v_dept := coalesce(r->>'dept', case when v_owner.dept = 'top' then 'scout' else v_owner.dept end, 'unassigned');
    insert into bestly_agents (slug, name, role, what_it_does, dept, reports_to, kind, status, runs_on, schedule, icon, admin_url,
                               private, sort, pulse, profile)
    values (r->>'slug', r->>'name', r->>'role', r->>'what_it_does', v_dept, v_boss, 'agent', 'active', r->>'runs_on',
            r->>'schedule', coalesce(r->>'icon', 'bot'), r->>'admin_url', false, coalesce((r->>'sort')::int, 50),
            coalesce(r->'pulse', '{"src":"none"}'::jsonb),
            jsonb_build_object('tool', v_tool, 'onboarding', jsonb_build_object('stage', 'live', 'live_at', now(), 'via', 'onboarding protocol')))
    on conflict (slug) do update set
      name = coalesce(excluded.name, bestly_agents.name),
      role = coalesce(excluded.role, bestly_agents.role),
      what_it_does = coalesce(excluded.what_it_does, bestly_agents.what_it_does),
      dept = excluded.dept, reports_to = excluded.reports_to,
      kind = 'agent', status = 'active',
      runs_on = coalesce(excluded.runs_on, bestly_agents.runs_on),
      schedule = coalesce(excluded.schedule, bestly_agents.schedule),
      icon = coalesce(r->>'icon', bestly_agents.icon),
      admin_url = coalesce(excluded.admin_url, bestly_agents.admin_url),
      pulse = case when r ? 'pulse' then excluded.pulse else bestly_agents.pulse end,
      updated_at = now(),
      profile = coalesce(bestly_agents.profile, '{}'::jsonb)
        || case when coalesce(bestly_agents.profile, '{}'::jsonb) ? 'before_roles' then '{}'::jsonb
                else jsonb_build_object('before_roles', jsonb_build_object('role', bestly_agents.role, 'reports_to', bestly_agents.reports_to, 'dept', bestly_agents.dept, 'status', bestly_agents.status)) end
        || jsonb_build_object('tool', v_tool, 'onboarding', jsonb_build_object('stage', 'live', 'live_at', now(), 'via', 'onboarding protocol'));

    -- alerts with these prefixes come from this employee
    if r ? 'owns' then
      update notification_owners set agent_slug = r->>'slug' where prefix in (select jsonb_array_elements_text(r->'owns'));
      insert into notification_owners (prefix, agent_slug, note)
      select x, r->>'slug', 'onboarding protocol' from jsonb_array_elements_text(r->'owns') x
       where not exists (select 1 from notification_owners o where o.prefix = x);
    end if;

    -- employees get the welcome email (with their mascot) and a note to Jared from The Recruiter
    if not v_tool and coalesce((r->>'welcome')::boolean, true) then
      insert into agent_welcomes (slug) values (r->>'slug') on conflict do nothing;
      begin
        perform invoke_edge_function('team-hr', jsonb_build_object('op', 'welcome', 'slug', r->>'slug'), 60000);
        update agent_welcomes set tries = tries + 1, last_try_at = now() where slug = r->>'slug';
      exception when others then
        update agent_welcomes set error = left(sqlerrm, 300) where slug = r->>'slug';
      end;
      perform scout_notify(p_title => 'The Recruiter: ' || (r->>'name') || ' is onboarded',
        p_body => (r->>'name') || ' (' || (r->>'role') || ') is on the Team page now, watched, with ' ||
                  (select count(*) from jsonb_array_elements(p) t where t->>'tool_of' = r->>'slug') || ' tools.',
        p_severity => 'info', p_push => false, p_url => '/admin/team', p_dedupe => 'onboard-' || (r->>'slug'));
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.team_onboard(jsonb) from public, anon;
grant execute on function public.team_onboard(jsonb) to authenticated, service_role;

-- ------------------------------------------------------------------ 2. Roster Scanner
create table if not exists public.team_roster_findings (
  key         text primary key,
  kind        text not null,            -- 'unowned_schedules' | 'open_role_working'
  title       text not null,
  detail      text,
  jobs        text[] not null default '{}',
  status      text not null default 'new' check (status in ('new','known','onboarded','dismissed')),
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  notified_at timestamptz
);
alter table public.team_roster_findings enable row level security;
revoke all on public.team_roster_findings from anon, authenticated;

-- p_quiet: record findings as already known without telling Jared (first-run baseline)
create or replace function public.team_roster_scan(p_quiet boolean default false) returns jsonb
language plpgsql security definer set search_path to 'public', 'cron' as $$
declare v_new int := 0; v_list text;
begin
  -- owned = a bot's pulse names the job. Being watched by the Watchdogs (cron_family) is not owning it:
  -- ava-watch was "watched" while nobody owned Ava.
  with covered as (
    select j.jobname from cron.job j
     where exists (select 1 from bestly_agents a where a.status <> 'retired'
                     and (a.pulse->>'job' = j.jobname or coalesce(a.pulse->'also', '[]') ? j.jobname))),
  fam as (
    select split_part(j.jobname, '-', 1) prefix, array_agg(j.jobname order by j.jobname) jobs
      from cron.job j
     where j.active and j.jobname not in (select jobname from covered)
     group by 1 having count(*) >= 2),
  found as (
    select 'schedules:' || prefix key, 'unowned_schedules' kind,
           format('%s schedules nobody on the team owns: %s', cardinality(jobs), prefix || '-*') title,
           'Database schedules ' || array_to_string(jobs, ', ') || ' are running but no bot on the Team page owns them.' detail, jobs
      from fam
    union all
    -- an open role whose family is already running (RoofGuard Caller while roofguard-dial was dialing)
    select 'open-role:' || a.slug, 'open_role_working',
           a.name || ' may already be working',
           format('%s is still an open role, but %s ran in the last day. If it is live, onboard it.', a.name, string_agg(distinct j.jobname, ', ')),
           array_agg(distinct j.jobname)
      from bestly_agents a
      join cron.job j on split_part(j.jobname, '-', 1) = split_part(a.slug, '-', 1) and j.active
      join lateral (select 1 from cron.job_run_details d where d.jobid = j.jobid and d.start_time > now() - interval '24 hours' limit 1) ran on true
     where a.status = 'planned' and a.kind = 'open_role' and not (a.profile ? 'hire_id')
       and a.created_at < now() - interval '6 hours'
       and j.jobname not in (select jobname from covered)
     group by a.slug, a.name)
  insert into team_roster_findings as f (key, kind, title, detail, jobs)
  select key, kind, title, detail, jobs from found
  on conflict (key) do update set title = excluded.title, detail = excluded.detail, jobs = excluded.jobs, last_seen = now(),
    -- came back after it was handled: tell Jared again (dismissed stays dismissed)
    status = case when f.status = 'onboarded' then 'new' else f.status end,
    notified_at = case when f.status = 'onboarded' then null else f.notified_at end;

  -- what's no longer seen was handled (onboarded, or the schedules went away)
  update team_roster_findings set status = 'onboarded'
   where status in ('new','known') and last_seen < now() - interval '2 hours';

  if p_quiet then
    update team_roster_findings set status = 'known', notified_at = now() where status = 'new' and notified_at is null;
  end if;
  select count(*), string_agg('- ' || title, E'\n') into v_new, v_list
    from team_roster_findings where status = 'new' and notified_at is null;
  if v_new > 0 then
    perform scout_notify(p_title => 'The Recruiter: I found work nobody on the team owns',
      p_body => v_list || E'\nOpen the Team page and tell me who it belongs to, or ask Scout to onboard it.',
      p_severity => 'info', p_push => true, p_url => '/admin/team', p_dedupe => 'roster-' || to_char(now(), 'YYYYMMDDHH24'));
    update team_roster_findings set notified_at = now() where status = 'new' and notified_at is null;
  end if;
  return jsonb_build_object('new', v_new, 'open', (select count(*) from team_roster_findings where status in ('new','known')));
end $$;
revoke all on function public.team_roster_scan(boolean) from public, anon, authenticated;

-- a scan failure must not stop discovery, and is reported (by The Recruiter's own alert key)
create or replace function public.team_roster_scan_safe() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r jsonb;
begin
  r := team_roster_scan();
  if exists (select 1 from monitor_issues where key = 'hr.roster' and status = 'open') then
    perform bestly_raise('hr.roster', 'resolved', 'info', 'The Recruiter: roster check is working again');
  end if;
  return r;
exception when others then
  perform bestly_raise('hr.roster', 'problem', 'warning', 'The Recruiter: my roster check broke',
    'team_roster_scan failed: ' || left(sqlerrm, 300) || '. New bots may go unnoticed until this is fixed.', 'team', null, false);
  return jsonb_build_object('error', left(sqlerrm, 300));
end $$;
revoke all on function public.team_roster_scan_safe() from public, anon, authenticated;

create or replace function public.admin_roster_findings() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(f) order by f.first_seen desc), '[]') from team_roster_findings f where f.status = 'new');
end $$;
revoke all on function public.admin_roster_findings() from public, anon;
grant execute on function public.admin_roster_findings() to authenticated, service_role;

create or replace function public.admin_roster_finding_set(p_key text, p_status text) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  if p_status not in ('known','dismissed','onboarded') then raise exception 'bad status'; end if;
  update team_roster_findings set status = p_status where key = p_key;
end $$;
revoke all on function public.admin_roster_finding_set(text, text) from public, anon;
grant execute on function public.admin_roster_finding_set(text, text) to authenticated, service_role;

-- hourly: discover (Pi/Mac/Home Hub) + scan (cloud schedules, open roles)
select cron.schedule('org-chart-discover', '17 * * * *', $$select public.team_discover(); select public.team_roster_scan_safe();$$);

insert into notification_owners (prefix, agent_slug, note)
select 'hr', 'hr', 'The Recruiter owns roster alerts' where not exists (select 1 from notification_owners where prefix = 'hr');

-- baseline: today's existing gaps are "known" (the Improver's reviews can work through them); only new ones ping
select public.team_roster_scan(true);

-- ------------------------------------------------------------------ 1:1s (coaching notes on an employee's card)
create or replace function public.team_one_on_one_add(p_slug text, p_note jsonb) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  update bestly_agents
     set profile = coalesce(profile, '{}'::jsonb) || jsonb_build_object('one_on_ones',
           coalesce(profile->'one_on_ones', '[]'::jsonb) || jsonb_build_array(p_note || jsonb_build_object('at', now()))),
         updated_at = now()
   where slug = p_slug;
end $$;
revoke all on function public.team_one_on_one_add(text, jsonb) from public, anon;
grant execute on function public.team_one_on_one_add(text, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------------ the onboarding run itself (2026-10-04, via SQL)
-- Recorded here with "welcome": false so a replay doesn't resend the welcome emails (they went out on Oct 4).
select public.team_onboard($j$[
 {"slug":"ava","name":"Ava","role":"Personal Assistant","reports_to":"jared","dept":"desk","runs_on":"cloud","icon":"hand-helping","welcome":false,
  "schedule":"answers (816) 429-9495 any time","admin_url":"/admin/ava","sort":5,
  "what_it_does":"Answers your personal line, (816) 429-9495. Takes messages (your mom can call any time), greets people she knows by name, makes calls for you, and can connect a call to your cell.",
  "pulse":{"src":"at","table":"ava_line_health","col":"checked_at","ok":"ok","sum":"case when ok then 'Line OK' else 'Line problem' end","where":"source = 'ava'","gap":30,"alert":true,"also":["ava-watch","ava-followups"]},
  "owns":["ava"]},
 {"slug":"ava-line-check","name":"Line Check","role":"Phone line check","tool_of":"ava","runs_on":"cloud","icon":"activity","schedule":"every 10 min",
  "what_it_does":"Checks Ava's phone line every 10 minutes and repairs it when it breaks.","pulse":{"src":"cron","job":"ava-watch","gap":25}},
 {"slug":"ava-callbacks","name":"Callback Scheduler","role":"Callbacks and reminders","tool_of":"ava","runs_on":"cloud","icon":"calendar-check","schedule":"every 5 min",
  "what_it_does":"Calls people back when Ava promised to, and sends the reminders.","pulse":{"src":"cron","job":"ava-followups","gap":15}},
 {"slug":"roofguard-caller","name":"RoofGuard Ava","role":"Sales Development Rep (phone)","reports_to":"jared","dept":"sales","runs_on":"cloud","icon":"phone-call","welcome":false,
  "schedule":"calls leads on weekdays","admin_url":"/admin/roofguard","sort":60,
  "what_it_does":"Cold-calls RoofGuard leads, gets past the front desk to whoever maintains the roof, and books meetings with Eli. Her goal is 6 meetings a week.",
  "pulse":{"src":"at","table":"ava_line_health","col":"checked_at","ok":"ok","sum":"case when ok then 'Line OK' else 'Line problem' end","where":"source = 'roofguard'","gap":30,"alert":true,
           "also":["roofguard-watch","roofguard-watch-calls","roofguard-dial","roofguard-followups","roofguard-daily-report","roofguard-pace","roofguard-weekly-review"]},
  "owns":["roofguard","rg"]},
 {"slug":"rg-dialer","name":"Dialer","role":"Auto-dialer","tool_of":"roofguard-caller","runs_on":"cloud","icon":"repeat","schedule":"every 5 min while calling is on",
  "what_it_does":"Picks the next leads and places RoofGuard Ava's calls.","pulse":{"src":"cron","job":"roofguard-dial","gap":15}},
 {"slug":"rg-callbacks","name":"Callback Scheduler","role":"Callbacks and reminders","tool_of":"roofguard-caller","runs_on":"cloud","icon":"calendar-check","schedule":"every 5 min",
  "what_it_does":"Calls leads back at the time they asked for.","pulse":{"src":"cron","job":"roofguard-followups","gap":15}},
 {"slug":"rg-line-check","name":"Line Check","role":"Phone line check","tool_of":"roofguard-caller","runs_on":"cloud","icon":"activity","schedule":"every 10 min",
  "what_it_does":"Checks RoofGuard Ava's phone line and recent calls every 10 minutes.","pulse":{"src":"cron","job":"roofguard-watch","also":["roofguard-watch-calls"],"gap":25}},
 {"slug":"rg-pace","name":"Pace Setter","role":"Daily call target","tool_of":"roofguard-caller","runs_on":"cloud","icon":"line-chart","schedule":"weekdays 6:05 AM",
  "what_it_does":"Sets how many calls RoofGuard Ava makes each weekday.","pulse":{"src":"cron","job":"roofguard-pace","gap":4400}},
 {"slug":"rg-scorecard","name":"Scorecard","role":"Daily report and weekly review","tool_of":"roofguard-caller","runs_on":"cloud","icon":"clipboard-check","schedule":"weeknights, plus Fridays 4:50 PM",
  "what_it_does":"Writes the daily call report and the Friday review against the 6-meetings-a-week goal.","pulse":{"src":"cron","job":"roofguard-daily-report","also":["roofguard-weekly-review"],"gap":4400}},
 {"slug":"roster-scanner","name":"Roster Scanner","role":"Finds work nobody owns","tool_of":"hr","runs_on":"cloud","icon":"search","schedule":"every hour at :17",
  "what_it_does":"Every hour looks for new Pi jobs, Macs and Home Hub agents, cloud schedules no bot owns, and open roles that are already working. Anything new, The Recruiter tells you.",
  "pulse":{"src":"cron","job":"org-chart-discover","gap":90,"alert":true}}
]$j$::jsonb);
select public.team_role_apply('[{"slug":"roofguard-finder","tool_of":"roofguard-caller","role":"Phone number finder"}]'::jsonb);
select public.admin_agent_set('hr', jsonb_build_object('what_it_does', 'Keeps the team roster true: every working bot has a card, a title, an owner and a watch, within an hour of going live. Also spots jobs no bot covers yet and writes up new hires with The Improver.'));
