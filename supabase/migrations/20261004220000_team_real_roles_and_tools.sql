-- 2026-10-04 Real job titles + tools (Jared: "titles and roles more in line with real roles... Spark could be head of
-- marketing, and Rewriter a tool Spark can use. Same for security: Ares, and he uses the Fix Ladder as a tool").
--   Employees keep real-world titles (Head of Marketing & Content, Fleet Manager, Pricing Analyst...).
--   Narrow single-job bots become tools: bestly_agents.profile.tool = true and reports_to = the employee who uses it.
--   Tools stay fully watched (pulse, team_watch, moods); the Team page shows them as a row under their owner instead of
--   as separate employees. A tool going quiet is reported by its owner ("Ares: Fix Ladder has gone quiet") so every
--   alert is signed by the employee responsible for it.
--   Every change keeps the old title/boss/department in profile.before_roles, so it can be put back.

-- set a bot's title, boss, department and whether it is a tool (admins, or a session with the service key)
create or replace function public.team_role_apply(p jsonb) returns int
language plpgsql security definer set search_path to 'public' as $$
declare r jsonb; a bestly_agents; v_owner bestly_agents; n int := 0; v_dept text; v_boss text;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  for r in select * from jsonb_array_elements(p) loop
    select * into a from bestly_agents where slug = r->>'slug';
    continue when a.slug is null;
    v_boss := coalesce(r->>'tool_of', r->>'reports_to', a.reports_to);
    select * into v_owner from bestly_agents where slug = v_boss;
    -- a tool lives in its owner's department (Scout's tools in Scout's team)
    v_dept := coalesce(r->>'dept', case when r ? 'tool_of' then case when v_owner.dept = 'top' then 'scout' else v_owner.dept end end, a.dept);
    update bestly_agents set
      role = coalesce(r->>'role', role),
      reports_to = v_boss,
      dept = v_dept,
      updated_at = now(),
      profile = coalesce(profile, '{}'::jsonb)
        || case when coalesce(profile, '{}'::jsonb) ? 'before_roles' then '{}'::jsonb
                else jsonb_build_object('before_roles', jsonb_build_object('role', a.role, 'reports_to', a.reports_to, 'dept', a.dept)) end
        || jsonb_build_object('tool', r ? 'tool_of')
     where slug = a.slug;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.team_role_apply(jsonb) from public, anon;
grant execute on function public.team_role_apply(jsonb) to authenticated, service_role;

-- the edit sheet can flip "this is a tool" (patch key "tool": true/false)
create or replace function public.admin_agent_set(p_slug text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
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
  if coalesce((p_patch->>'tool')::boolean, false) and nullif(coalesce(p_patch->>'reports_to', v.reports_to), '') is null then
    raise exception 'a tool needs someone who uses it (pick who it reports to)';
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
    profile      = case when p_patch ? 'tool' then coalesce(profile, '{}'::jsonb) || jsonb_build_object('tool', (p_patch->>'tool')::boolean) else profile end,
    updated_at   = now()
  where slug = p_slug returning * into v;
  return to_jsonb(v);
end $$;

-- team_watch: a quiet tool is reported by the employee who uses it
create or replace function public.team_watch() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  a record; v_red int := 0; v_raised int := 0; v_resolved int := 0; v_when text; v_key text; v_striking boolean; v_owner text;
begin
  for a in
    select b.*, p.last_at, p.last_ok, p.summary, team_health(b.status, b.pulse, p.last_at, p.last_ok) h,
           case when coalesce((b.profile->>'tool')::boolean, false) then (select o.name from bestly_agents o where o.slug = b.reports_to) end owner_name
      from bestly_agents b left join team_pulses() p on p.slug = b.slug
     where b.status in ('active','new') and coalesce((b.pulse->>'alert')::boolean, false)
  loop
    v_key := 'team.silent.' || a.slug;
    v_owner := a.owner_name;
    v_striking := exists (select 1 from team_strikes s where s.ended_at is null and a.slug = any(s.members));
    if a.h = 'red' and not v_striking then
      v_red := v_red + 1;
      v_when := coalesce(to_char(a.last_at at time zone 'America/Los_Angeles', 'FMHH12:MI AM "on" Mon FMDD'), 'never');
      perform bestly_raise(v_key, 'problem', 'warning',
        case when v_owner is not null then v_owner || ': my ' || a.name || ' has gone quiet' else a.name || ' has gone quiet' end,
        format('%s%s (%s) last checked in at %s. It should check in about every %s minutes. It runs on %s%s.%s',
               case when v_owner is not null then v_owner || ' uses this tool. ' else '' end,
               a.name, a.what_it_does, v_when, coalesce(a.pulse->>'gap', '60'), coalesce(a.runs_on, 'unknown'),
               coalesce(' (' || a.schedule || ')', ''),
               coalesce(E'\nLast thing it said: ' || a.summary, '')),
        'team', null, false);
      v_raised := v_raised + 1;
    elsif (a.h in ('green','yellow') or v_striking) and exists (select 1 from monitor_issues where key = v_key and status = 'open') then
      perform bestly_raise(v_key, 'resolved', 'info',
        case when v_striking then a.name || ' is on strike (covered by the strike alert)'
             when v_owner is not null then v_owner || ': my ' || a.name || ' is working again'
             else a.name || ' is checking in again' end);
      v_resolved := v_resolved + 1;
    end if;
  end loop;

  for a in select b.slug, b.name from bestly_agents b
            where b.status in ('paused','planned','retired')
              and exists (select 1 from monitor_issues m where m.key = 'team.silent.' || b.slug and m.status = 'open') loop
    perform bestly_raise('team.silent.' || a.slug, 'resolved', 'info', a.name || ' is paused');
  end loop;

  update team_watch_state set checked_at = now(), red = v_red, raised = v_raised, resolved = v_resolved, error = null where id = 1;
  return jsonb_build_object('red', v_red, 'raised', v_raised, 'resolved', v_resolved);
end $$;
revoke all on function public.team_watch() from public, anon, authenticated;

-- the restructure itself
select public.team_role_apply($j$[
  {"slug":"scout","role":"Chief of Staff"},
  {"slug":"improver","role":"Head of Operations"},
  {"slug":"hr","role":"Head of People"},

  {"slug":"scout-autopilot","tool_of":"scout","role":"Night-shift worker"},
  {"slug":"scout-daily","tool_of":"scout","role":"Daily planner"},
  {"slug":"scout-learner","tool_of":"scout","role":"Lessons notebook"},
  {"slug":"hey-scout","tool_of":"scout","role":"Voice on the HomePod"},
  {"slug":"scout-notetaker","tool_of":"scout","role":"Call recorder and notes"},
  {"slug":"todo-checker","tool_of":"scout","role":"To-do checker"},
  {"slug":"chat-router","tool_of":"scout","role":"AI router"},
  {"slug":"decision-prompt","tool_of":"scout","role":"Daily decision digest"},
  {"slug":"partner-scout","role":"Executive Assistant to Eli","reports_to":"scout"},

  {"slug":"security-auditor","role":"Head of Security & IT","reports_to":"jared","dept":"ops"},
  {"slug":"fix-ladder","tool_of":"security-auditor","role":"Escalation ladder"},
  {"slug":"system-monitor","tool_of":"security-auditor","role":"Site and service monitor"},
  {"slug":"watchdogs","tool_of":"security-auditor","role":"System checks"},
  {"slug":"free-ai-fixer","tool_of":"security-auditor","role":"Fix writer (free AI)"},
  {"slug":"studio-watch","tool_of":"security-auditor","role":"Studio uptime check"},
  {"slug":"db-watch","tool_of":"security-auditor","role":"Database guard"},
  {"slug":"pi-runner","tool_of":"security-auditor","role":"Pi job runner"},
  {"slug":"mac-hands","tool_of":"security-auditor","role":"Mac job runner"},
  {"slug":"team-watch","tool_of":"security-auditor","role":"Bot roll call"},
  {"slug":"team-watch-ping","tool_of":"security-auditor","role":"Roll call backup"},
  {"slug":"cron-consolidator","tool_of":"security-auditor","role":"Pi job merger"},

  {"slug":"spark","role":"Head of Marketing & Content"},
  {"slug":"studio-rewriter","tool_of":"spark","role":"Rewrite tool"},
  {"slug":"transcoder","tool_of":"spark","role":"Video converter"},
  {"slug":"cy-pipeline","tool_of":"spark","role":"Cookie Yeti content pipeline"},
  {"slug":"ask-builder","tool_of":"spark","role":"Change-request builder"},
  {"slug":"daily-post","role":"Social Media Manager","reports_to":"spark"},
  {"slug":"poster","tool_of":"daily-post","role":"Publishing tool"},
  {"slug":"hoku-post-check","tool_of":"daily-post","role":"HOKU post checker"},

  {"slug":"turo-reader","role":"Fleet Manager"},
  {"slug":"trip-checker","tool_of":"turo-reader","role":"Trip setup checker"},
  {"slug":"car-guard","tool_of":"turo-reader","role":"Car tracker"},
  {"slug":"sweep-guard","tool_of":"turo-reader","role":"Street sweeping alert"},
  {"slug":"lax-concierge","role":"Guest Experience Manager","reports_to":"turo-reader"},
  {"slug":"turo-sender","tool_of":"lax-concierge","role":"Trip link messenger"},
  {"slug":"key-keeper","tool_of":"lax-concierge","role":"Digital key sender"},
  {"slug":"turo-car-facts","tool_of":"lax-concierge","role":"Car facts refresher"},
  {"slug":"turo-watch-report","role":"Pricing Analyst","reports_to":"turo-reader"},
  {"slug":"claims-closer","role":"Claims Specialist","reports_to":"turo-reader"},

  {"slug":"roofguard-outreach","role":"Business Development Rep"},
  {"slug":"roofguard-finder","tool_of":"roofguard-outreach","role":"Phone number finder"},
  {"slug":"roofguard-caller","role":"Sales Rep (phone)","reports_to":"roofguard-outreach"},
  {"slug":"skytouch-triage","role":"Front Desk Coordinator"},
  {"slug":"skytouch-morning","tool_of":"skytouch-triage","role":"Availability check"},

  {"slug":"mail-bridge","role":"Mailroom Manager"},
  {"slug":"partner-mail","tool_of":"mail-bridge","role":"Partner inbox handler"},
  {"slug":"icloud-cleanup","tool_of":"mail-bridge","role":"Inbox cleaner"},

  {"slug":"home-hub","role":"Facilities Manager"},
  {"slug":"wall","tool_of":"home-hub","role":"Projector wall"},
  {"slug":"wall-watchdog","tool_of":"home-hub","role":"Wall keep-alive"},
  {"slug":"ha-todo-sync","tool_of":"home-hub","role":"To-do list sync"},
  {"slug":"home-narrator","tool_of":"home-hub","role":"Home announcer"},

  {"slug":"mercury-sync","role":"Bookkeeper"},
  {"slug":"job-finder","role":"Career Agent"}
]$j$::jsonb);
