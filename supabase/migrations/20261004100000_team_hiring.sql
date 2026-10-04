-- 2026-10-04 Team page, round 3 (Jared): an HR bot that works WITH The Improver to hire new bots.
--   The Recruiter (slug 'hr') looks for jobs no bot covers yet: The Improver's ideas, problems that keep coming back,
--   failing or missing jobs, open roles. It writes up candidate hires. The Improver then checks each one against the
--   same picture (is it worth it, does it overlap, what does it cost). Only candidates BOTH back reach Jared,
--   in "Suggested hires" on /admin/team. Tap Hire -> the bot joins the chart as "in training" (kind open_role,
--   status planned), gets its welcome email, and Scout gets the build brief. Nothing is built without Jared's yes.
--   Weekly: Mondays 9:15 AM, right after The Improver (8:45 AM), so it reads fresh ideas.
-- No drop statements on purpose (they need a person to confirm and stall unattended runs).

create table if not exists public.team_hires (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  name           text not null,
  role           text,
  dept           text,
  reports_to     text,
  what_it_does   text,
  why            text,          -- The Recruiter's pitch: the evidence for the gap
  saves          text,          -- what it saves Jared (time, money, tokens, worry)
  runs_on        text,
  schedule       text,
  cost           text,
  first_task     text,
  improver_note  text,          -- The Improver's take
  improver_score int check (improver_score between 1 and 5),
  status         text not null default 'proposed' check (status in ('proposed','vetoed','hired','passed')),
  decided_at     timestamptz,
  hired_slug     text
);
create index if not exists team_hires_status_idx on public.team_hires (status, created_at desc);
alter table public.team_hires enable row level security;
revoke all on public.team_hires from anon, authenticated;

-- what The Recruiter reads: The Improver's picture + the full roster + what was already proposed (service role only)
create or replace function public.hr_context() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  return improver_context() || jsonb_build_object(
    'roster', (select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'role', role, 'dept', dept,
                      'does', left(what_it_does, 160), 'status', status) order by dept, sort), '[]')
                 from bestly_agents where kind in ('agent','open_role') and status <> 'retired'),
    'departments', '["scout","ops","studio","turo","sales","mail","home","desk"]'::jsonb,
    'improver_ideas', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'kind', kind, 'why', left(why, 200), 'status', status)), '[]')
                         from (select * from improver_ideas order by created_at desc limit 20) i),
    'past_hires', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'role', role, 'status', status)), '[]')
                     from (select name, role, status from team_hires order by created_at desc limit 40) h));
end $$;
revoke all on function public.hr_context() from public, anon, authenticated;
grant execute on function public.hr_context() to service_role;

-- save one run's candidates (both the backed and the vetoed, so neither comes back for 90 days)
create or replace function public.hr_save(p_hires jsonb) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  insert into team_hires (name, role, dept, reports_to, what_it_does, why, saves, runs_on, schedule, cost, first_task,
                          improver_note, improver_score, status)
  select left(h->>'name', 60), left(h->>'role', 80),
         case when h->>'dept' in ('scout','ops','studio','turo','sales','mail','home','desk') then h->>'dept' else 'unassigned' end,
         (select slug from bestly_agents where slug = h->>'reports_to'),
         left(h->>'what_it_does', 500), left(h->>'why', 600), left(h->>'saves', 300),
         case when h->>'runs_on' in ('pi','cloud','claude','mac_mini','macbook') then h->>'runs_on' else 'pi' end,
         left(h->>'schedule', 80), left(h->>'cost', 120), left(h->>'first_task', 300),
         left(h->>'improver_note', 500), least(5, greatest(1, coalesce((h->>'improver_score')::int, 3))),
         case when h->>'verdict' = 'back' then 'proposed' else 'vetoed' end
    from jsonb_array_elements(p_hires) h
   where coalesce(h->>'name', '') <> ''
     and not exists (select 1 from team_hires x where lower(x.name) = lower(h->>'name') and x.created_at > now() - interval '90 days')
     and not exists (select 1 from bestly_agents a where lower(a.name) = lower(h->>'name') and a.status <> 'retired');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.hr_save(jsonb) from public, anon, authenticated;
grant execute on function public.hr_save(jsonb) to service_role;

create or replace function public.admin_team_hires() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(h) order by (h.status = 'proposed') desc, h.improver_score desc, h.created_at desc), '[]')
            from (select * from team_hires where status = 'proposed' or (status = 'hired' and decided_at > now() - interval '7 days')
                   order by created_at desc limit 20) h);
end $$;
revoke all on function public.admin_team_hires() from public, anon;
grant execute on function public.admin_team_hires() to authenticated, service_role;

-- Hire: the bot joins the chart "in training" and gets its welcome email. Returns the new slug.
create or replace function public.admin_hire_accept(p_id uuid) returns text
language plpgsql security definer set search_path to 'public' as $$
declare h team_hires; v_slug text; v_base text; i int := 1;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  select * into h from team_hires where id = p_id;
  if h.id is null then raise exception 'no such candidate'; end if;
  if h.status = 'hired' then return h.hired_slug; end if;
  v_base := trim(both '-' from regexp_replace(lower(h.name), '[^a-z0-9]+', '-', 'g'));
  if v_base = '' then v_base := 'new-hire'; end if;
  v_slug := v_base;
  while exists (select 1 from bestly_agents where slug = v_slug) loop i := i + 1; v_slug := v_base || '-' || i; end loop;

  insert into bestly_agents (slug, name, role, what_it_does, dept, reports_to, kind, status, runs_on, schedule, icon, private, sort, pulse, profile)
  values (v_slug, h.name, h.role, h.what_it_does, h.dept, coalesce(h.reports_to, 'scout'), 'open_role', 'planned',
          h.runs_on, h.schedule, 'sparkle', false, 90, '{"src":"none"}'::jsonb,
          jsonb_build_object('hired_at', now(), 'hire_id', h.id, 'first_task', h.first_task, 'cost', h.cost));
  update team_hires set status = 'hired', decided_at = now(), hired_slug = v_slug where id = p_id;

  -- welcome email (the insert trigger only welcomes running bots); the sweep retries it if this call fails
  insert into agent_welcomes (slug) values (v_slug) on conflict do nothing;
  begin
    perform invoke_edge_function('team-hr', jsonb_build_object('op', 'welcome', 'slug', v_slug), 60000);
    update agent_welcomes set tries = tries + 1, last_try_at = now() where slug = v_slug;
  exception when others then
    update agent_welcomes set error = left(sqlerrm, 300) where slug = v_slug;
  end;
  return v_slug;
end $$;
revoke all on function public.admin_hire_accept(uuid) from public, anon;
grant execute on function public.admin_hire_accept(uuid) to authenticated, service_role;

create or replace function public.admin_hire_pass(p_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  update team_hires set status = 'passed', decided_at = now() where id = p_id and status = 'proposed';
end $$;
revoke all on function public.admin_hire_pass(uuid) from public, anon;
grant execute on function public.admin_hire_pass(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ The Recruiter joins (its own welcome email fires)
insert into public.bestly_agents (slug, name, role, what_it_does, dept, reports_to, kind, status, runs_on, schedule, admin_url, icon, private, sort, pulse) values
('hr','The Recruiter','HR & hiring',
 'Spots jobs no bot covers yet (from The Improver''s ideas, problems that keep coming back, things that fail) and writes up new hires. The Improver checks every one; only hires they both back reach you. Tap Hire and it joins the crew.',
 'ops','jared','agent','active','cloud','Mondays 9:15 AM','/admin/team#hires','user-plus',false,20,
 '{"src":"beat","gap":10200,"alert":true}')
on conflict (slug) do nothing;

select cron.schedule('hr-weekly', '15 16 * * 1', $$select public.invoke_edge_function('team-hr', '{"op":"recruit"}'::jsonb, 150000)$$);  -- Mon 9:15 AM PDT

-- Applied live 2026-10-04 as team_hiring_schema + team_hiring_recruiter_joins. First run: The Recruiter proposed 4;
-- free-model verdict wording wasn't recognized so all 4 were saved as vetoed. team-hr now accepts back/yes/hire or a
-- 4-5 score; Chat Router and Cron Consolidator (score 4) were put back to proposed by hand, Post Guardian marked passed
-- (it was built on the stale "Post Sender is red" idea, a false alarm).
