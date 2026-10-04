-- 2026-10-04 Team page, round 2 (Jared, 2026-10-03 night):
--  1. Eli on the chart as a PARTNER (CEO, BDC Universal) — not staff: kind 'human', relation 'partner', beside Jared.
--     Bots that deal with him on Jared's behalf carry liaison_to = 'eli' and are listed on his card.
-- Applied live 2026-10-04 in pieces (team_round2_columns_welcome, _welcome_sweep, _improver, _improver_context,
-- _chart_fields, team_pulses_cron_switched_off; seed + crons via execute_sql). This file is the record.
-- No drop statements on purpose: they need a person to confirm and stall unattended runs.
--  2. Every new bot gets a profile (personality, motto, suggested discovery-style field name) and a welcome email
--     to Jared. Edge fn team-hr op=welcome writes the profile with free AI and sends via Resend. team_welcome_sweep
--     retries anything unsent (self-heal); failures show on The Improver/Team Watch cards.
--  3. The Improver: weekly look at the whole picture (bots, problems, AI spend, failures, decisions) -> ranked ideas
--     in improver_ideas. Nothing changes until Jared taps "Do it" (which hands the idea to Scout).

-- ------------------------------------------------------------------ roster columns
alter table public.bestly_agents add column if not exists relation text;   -- 'partner' for Eli; null for staff and bots
alter table public.bestly_agents add column if not exists liaison_to text references public.bestly_agents(slug) on delete set null;
alter table public.bestly_agents add column if not exists profile jsonb;

-- ------------------------------------------------------------------ welcome emails
create table if not exists public.agent_welcomes (
  slug       text primary key references public.bestly_agents(slug) on delete cascade,
  created_at timestamptz not null default now(),
  tries      int not null default 0,
  last_try_at timestamptz,
  sent_at    timestamptz,
  error      text
);
alter table public.agent_welcomes enable row level security;
revoke all on public.agent_welcomes from anon, authenticated;

create or replace function public.team_welcome_queue() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.kind = 'agent' and new.status in ('active','new') then
    insert into agent_welcomes (slug) values (new.slug) on conflict do nothing;
    begin
      perform invoke_edge_function('team-hr', jsonb_build_object('op', 'welcome', 'slug', new.slug), 60000);
      update agent_welcomes set tries = tries + 1, last_try_at = now() where slug = new.slug;
    exception when others then
      update agent_welcomes set error = left(sqlerrm, 300) where slug = new.slug;
    end;
  end if;
  return new;
end $$;
create or replace trigger bestly_agents_welcome after insert on public.bestly_agents
  for each row execute function public.team_welcome_queue();

-- retry anything not sent yet (runs with the roll call)
create or replace function public.team_welcome_sweep() returns int
language plpgsql security definer set search_path to 'public' as $$
declare r record; n int := 0;
begin
  for r in select w.slug from agent_welcomes w
            where w.sent_at is null and w.tries < 4
              and coalesce(w.last_try_at, w.created_at) < now() - interval '20 minutes' loop
    perform invoke_edge_function('team-hr', jsonb_build_object('op', 'welcome', 'slug', r.slug), 60000);
    update agent_welcomes set tries = tries + 1, last_try_at = now() where slug = r.slug;
    n := n + 1;
  end loop;
  -- a welcome that keeps failing goes to Scout like any other problem
  if exists (select 1 from agent_welcomes where sent_at is null and tries >= 4) then
    perform bestly_raise('team.welcome', 'problem', 'warning', 'New-bot welcome emails are failing',
      (select 'Could not send a welcome email for: ' || string_agg(slug, ', ') || '. Last error: ' || coalesce(max(error), 'unknown')
         from agent_welcomes where sent_at is null and tries >= 4),
      'team', null, false);
  else
    perform bestly_raise('team.welcome', 'resolved', 'info', null);
  end if;
  return n;
end $$;
revoke all on function public.team_welcome_sweep() from public, anon, authenticated;

-- what team-hr needs to write a welcome (service role only)
create or replace function public.team_welcome_get(p_slug text) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'agent', to_jsonb(a) - 'pulse',
    'boss', (select jsonb_build_object('name', b.name, 'role', b.role) from bestly_agents b where b.slug = a.reports_to),
    'liaison', (select jsonb_build_object('name', l.name, 'role', l.role) from bestly_agents l where l.slug = a.liaison_to),
    'team_size', (select count(*) from bestly_agents where kind = 'agent' and status in ('active','new')),
    'teammates', (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'role', t.role)), '[]')
                    from (select name, role from bestly_agents t where t.dept = a.dept and t.slug <> a.slug and t.status = 'active' order by sort limit 6) t),
    'welcome', (select to_jsonb(w) from agent_welcomes w where w.slug = a.slug))
  from bestly_agents a where a.slug = p_slug
$$;
revoke all on function public.team_welcome_get(text) from public, anon, authenticated;
grant execute on function public.team_welcome_get(text) to service_role;

create or replace function public.team_welcome_mark(p_slug text, p_ok boolean, p_error text default null, p_profile jsonb default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if p_profile is not null then
    update bestly_agents set profile = coalesce(profile, '{}'::jsonb) || p_profile, updated_at = now() where slug = p_slug;
  end if;
  insert into agent_welcomes (slug) values (p_slug) on conflict do nothing;
  update agent_welcomes set sent_at = case when p_ok then now() else sent_at end,
         error = case when p_ok then null else left(p_error, 300) end
   where slug = p_slug;
end $$;
revoke all on function public.team_welcome_mark(text, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.team_welcome_mark(text, boolean, text, jsonb) to service_role;

-- ------------------------------------------------------------------ The Improver
create table if not exists public.improver_ideas (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  run_at     timestamptz not null default now(),
  title      text not null,
  area       text,
  kind       text check (kind in ('tokens','money','ux','workflow','reliability','security')),
  why        text,
  change     text,
  effort     text check (effort in ('S','M','L')),
  impact     int check (impact between 1 and 5),
  status     text not null default 'new' check (status in ('new','accepted','dismissed','done')),
  decided_at timestamptz,
  note       text
);
create index if not exists improver_ideas_status_idx on public.improver_ideas (status, created_at desc);
alter table public.improver_ideas enable row level security;
revoke all on public.improver_ideas from anon, authenticated;

-- the whole picture, compact (service role only; no secrets, no message bodies)
create or replace function public.improver_context() returns jsonb
language plpgsql stable security definer set search_path to 'public', 'cron' as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'now_pacific', to_char(now() at time zone 'America/Los_Angeles', 'Dy Mon DD, FMHH12:MI AM'),
    'team', (select jsonb_agg(jsonb_build_object('bot', x->>'name', 'role', x->>'role', 'dept', x->>'dept', 'runs_on', x->>'runs_on',
                    'schedule', x->>'schedule', 'health', x->>'health', 'last', x->>'summary'))
               from jsonb_array_elements((admin_org_chart())->'agents') x where x->>'kind' = 'agent'),
    'ai_spend_7d', (select coalesce(jsonb_agg(s), '[]') from (
        select fn, job, provider, count(*) calls, round(sum(cost_usd)::numeric, 2) usd,
               sum(coalesce(input_tokens,0) + coalesce(output_tokens,0)) tokens,
               round(100.0 * count(*) filter (where not coalesce(ok, true)) / greatest(count(*), 1)) fail_pct
          from ai_spend where at > now() - interval '7 days'
         group by 1, 2, 3 order by usd desc nulls last, tokens desc limit 15) s),
    'tesla_api_usd_30d', (select round(coalesce(sum(cost_usd), 0)::numeric, 2) from tesla_fleet_usage where at > now() - interval '30 days'),
    'noisy_problems_14d', (select coalesce(jsonb_agg(m), '[]') from (
        select key, title, status, occurrences, fix_stage from monitor_issues
         where updated_at > now() - interval '14 days' order by occurrences desc limit 15) m),
    'failing_db_jobs_7d', (select coalesce(jsonb_agg(f), '[]') from (
        select j.jobname, count(*) fails from cron.job_run_details d join cron.job j using (jobid)
         where d.start_time > now() - interval '7 days' and d.status <> 'succeeded'
         group by 1 order by 2 desc limit 10) f),
    'db_jobs_total', (select count(*) from cron.job where active),
    'pi_jobs', (select coalesce(jsonb_agg(jsonb_build_object('job', job, 'enabled', enabled, 'failures', consecutive_failures, 'last', last_summary)), '[]') from pi_jobs),
    'scout_chats_7d', (select count(*) from admin_chat_messages where role = 'user' and created_at > now() - interval '7 days'),
    'paid_ai_switch_changes_7d', (select count(*) from scout_paid_log where at > now() - interval '7 days'),
    'recent_decisions', (select coalesce(jsonb_agg(d), '[]') from (
        select area, title from bestly_memory where active and updated_at > now() - interval '14 days'
         order by updated_at desc limit 25) d),
    'past_ideas', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'status', status)), '[]')
                     from (select title, status from improver_ideas order by created_at desc limit 40) p)
  ) into v;
  return v;
end $$;
revoke all on function public.improver_context() from public, anon, authenticated;
grant execute on function public.improver_context() to service_role;

create or replace function public.improver_save(p_ideas jsonb) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  insert into improver_ideas (title, area, kind, why, change, effort, impact)
  select left(i->>'title', 140), left(i->>'area', 60),
         case when i->>'kind' in ('tokens','money','ux','workflow','reliability','security') then i->>'kind' else 'workflow' end,
         left(i->>'why', 600), left(i->>'change', 900),
         case when i->>'effort' in ('S','M','L') then i->>'effort' else 'M' end,
         least(5, greatest(1, coalesce((i->>'impact')::int, 3)))
    from jsonb_array_elements(p_ideas) i
   where coalesce(i->>'title', '') <> ''
     and not exists (select 1 from improver_ideas x where lower(x.title) = lower(i->>'title') and x.created_at > now() - interval '60 days');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.improver_save(jsonb) from public, anon, authenticated;
grant execute on function public.improver_save(jsonb) to service_role;

create or replace function public.admin_improver_ideas() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(i) order by (i.status = 'new') desc, i.impact desc, i.created_at desc), '[]')
            from (select * from improver_ideas where status in ('new','accepted') or decided_at > now() - interval '3 days'
                   order by created_at desc limit 30) i);
end $$;
revoke all on function public.admin_improver_ideas() from public, anon;
grant execute on function public.admin_improver_ideas() to authenticated, service_role;

create or replace function public.admin_improver_set(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  if p_status not in ('new','accepted','dismissed','done') then raise exception 'bad status'; end if;
  update improver_ideas set status = p_status, decided_at = now(), note = coalesce(p_note, note) where id = p_id;
end $$;
revoke all on function public.admin_improver_set(uuid, text, text) from public, anon;
grant execute on function public.admin_improver_set(uuid, text, text) to authenticated, service_role;

-- ------------------------------------------------------------------ chart read now carries relation / liaison / profile
-- admin_org_chart() was re-created with 'relation', 'liaison_to', 'profile' on each row (body otherwise as in
-- 20261004000000_org_chart.sql), and team_pulses() now reports switched-off cron / Pi jobs as 'Switched off ...'
-- with no timestamp, so they show grey instead of "gone quiet". Live definitions:
--   select pg_get_functiondef('public.admin_org_chart()'::regprocedure);
--   select pg_get_functiondef('public.team_pulses()'::regprocedure);

-- ------------------------------------------------------------------ seed
insert into public.bestly_agents (slug, name, role, what_it_does, dept, reports_to, kind, relation, status, runs_on, schedule, admin_url, icon, private, sort, pulse) values
('eli','Eli Cooper','Business partner · CEO, BDC Universal','Your partner on RoofGuard, HOKU, Vesta and Centering YOU. Works with you, not for you.','top',null,'human','partner','active',null,null,'/admin/partners','handshake',false,0,null),
('improver','The Improver','Continuous improvement','Looks at the whole picture every week (the bots, the admin, what breaks, what AI costs) and brings you a short list of ways to save tokens, money and time. Changes nothing until you tap Do it.','ops','jared','agent',null,'active','cloud','Mondays 8:45 AM','/admin/team#ideas','lightbulb',false,19,
 '{"src":"beat","gap":10200,"alert":true}')
on conflict (slug) do nothing;
update public.bestly_agents set liaison_to = 'eli'
 where slug in ('partner-scout','roofguard-outreach','roofguard-finder','roofguard-caller','partner-mail','scout-notetaker');
-- these three can't check in yet (device-bound task, or instructions too long to safely rewrite): "Can't see this one"
update public.bestly_agents set pulse = '{"src":"none"}'::jsonb where slug in ('job-finder','roofguard-outreach','turo-watch-report');

-- ------------------------------------------------------------------ schedules
select cron.schedule('org-chart-watch', '7-59/10 * * * *', $$select public.team_watch(); select public.team_welcome_sweep();$$);
select cron.schedule('improver-weekly', '45 15 * * 1', $$select public.invoke_edge_function('team-hr', '{"op":"improve"}'::jsonb, 150000)$$);  -- Mon 8:45 AM PDT
