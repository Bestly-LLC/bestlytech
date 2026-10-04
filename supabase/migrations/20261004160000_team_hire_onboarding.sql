-- 2026-10-04 Hire onboarding (Jared: "it just says in training — what's next, where are they in progress; clear them from
-- Suggested hires once they're hired AND working").
--   Every hired bot walks four steps, kept in bestly_agents.profile.onboarding:
--     1 hired   — plan written, welcome email sent (set by admin_hire_accept)
--     2 building — a builder (a Claude session) picked it up          hire_stage_set(slug,'building')
--     3 built    — its job exists, waiting for the first run           hire_stage_set(slug,'built')
--     4 live     — it checked in: graduates automatically on its first OK agent_beat (or hire_stage_set(slug,'live'))
--   Graduation: status active, kind agent, pulse {"src":"beat","gap":1500,"alert":true} unless the builder set a pulse,
--   team_hires.live_at stamped, Scout told. Suggested hires shows a hire only until it is live.
--   Cancel hire (admin_hire_cancel): before it's live, the bot leaves the chart and the hire is marked passed.
--   Watchdog: hire_training_sweep (with the 10-minute roll call) nudges Scout once if a hire sits on one step 7+ days.

alter table public.team_hires add column if not exists live_at timestamptz;
alter table public.team_hires add column if not exists cancelled_at timestamptz;

-- the onboarding record for hires made before today
update public.bestly_agents a
   set profile = coalesce(a.profile, '{}'::jsonb) || jsonb_build_object('onboarding',
         jsonb_build_object('stage', 'hired', 'hired_at', coalesce(a.profile->>'hired_at', now()::text)))
 where a.kind = 'open_role' and a.status = 'planned' and a.profile ? 'hire_id' and not (a.profile ? 'onboarding');

-- move a hire to a step (admins, or a builder session with the service key)
create or replace function public.hire_stage_set(p_slug text, p_stage text, p_note text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare a bestly_agents; v_on jsonb;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  if p_stage not in ('hired','building','built','live') then raise exception 'stage must be hired, building, built or live'; end if;
  select * into a from bestly_agents where slug = p_slug;
  if a.slug is null then raise exception 'no such bot'; end if;
  if not (a.profile ? 'hire_id') then raise exception 'not a hire'; end if;
  if p_stage = 'live' then return hire_graduate(p_slug, coalesce(p_note, 'Marked working')); end if;
  v_on := coalesce(a.profile->'onboarding', '{}'::jsonb) || jsonb_build_object('stage', p_stage, p_stage || '_at', now())
          || case when p_note is not null then jsonb_build_object('note', left(p_note, 300)) else '{}'::jsonb end;
  update bestly_agents set profile = profile || jsonb_build_object('onboarding', v_on), updated_at = now() where slug = p_slug;
  return jsonb_build_object('slug', p_slug, 'stage', p_stage);
end $$;
revoke all on function public.hire_stage_set(text, text, text) from public, anon;
grant execute on function public.hire_stage_set(text, text, text) to authenticated, service_role;

-- graduation: in training -> working crew member
create or replace function public.hire_graduate(p_slug text, p_note text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare a bestly_agents;
begin
  select * into a from bestly_agents where slug = p_slug;
  if a.slug is null or not (a.profile ? 'hire_id') then return jsonb_build_object('ok', false); end if;
  if a.status = 'active' and a.kind = 'agent' then return jsonb_build_object('ok', true, 'already', true); end if;
  update bestly_agents set status = 'active', kind = 'agent', updated_at = now(), icon = coalesce(nullif(icon, 'sparkle'), 'bot'),
         pulse = case when pulse is null or pulse->>'src' = 'none' then '{"src":"beat","gap":1500,"alert":true}'::jsonb else pulse end,
         profile = profile || jsonb_build_object('onboarding', coalesce(profile->'onboarding', '{}'::jsonb)
                     || jsonb_build_object('stage', 'live', 'live_at', now())
                     || case when p_note is not null then jsonb_build_object('note', left(p_note, 300)) else '{}'::jsonb end)
   where slug = p_slug;
  update team_hires set live_at = now() where id = (a.profile->>'hire_id')::uuid and live_at is null;
  perform scout_notify(p_title => a.name || ' is on the job',
    p_body => a.name || ' finished training and checked in for the first time. It is a regular crew member now.',
    p_severity => 'info', p_push => false, p_url => '/admin/team', p_dedupe => 'hire-live-' || p_slug);
  return jsonb_build_object('ok', true, 'slug', p_slug);
end $$;
revoke all on function public.hire_graduate(text, text) from public, anon, authenticated;
grant execute on function public.hire_graduate(text, text) to service_role;

-- a hire's first OK check-in graduates it
create or replace function public.agent_beats_graduate() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(new.ok, true) and exists (select 1 from bestly_agents a where a.slug = new.slug and a.status = 'planned'
                                          and a.kind = 'open_role' and a.profile ? 'hire_id') then
    perform hire_graduate(new.slug, coalesce(new.summary, 'First check-in'));
  end if;
  return new;
end $$;
create or replace trigger agent_beats_graduate after insert or update on public.agent_beats
  for each row execute function public.agent_beats_graduate();

-- cancel a hire before it starts working
create or replace function public.admin_hire_cancel(p_slug text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare a bestly_agents;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  select * into a from bestly_agents where slug = p_slug;
  if a.slug is null or not (a.profile ? 'hire_id') then raise exception 'not a hire'; end if;
  if a.status = 'active' then raise exception 'it is already working; use a reorg to let it go'; end if;
  update bestly_agents set status = 'retired', updated_at = now(),
         profile = profile || jsonb_build_object('onboarding', coalesce(profile->'onboarding', '{}'::jsonb) || jsonb_build_object('stage', 'cancelled', 'cancelled_at', now()))
   where slug = p_slug;
  update team_hires set status = 'passed', cancelled_at = now() where id = (a.profile->>'hire_id')::uuid;
end $$;
revoke all on function public.admin_hire_cancel(text) from public, anon;
grant execute on function public.admin_hire_cancel(text) to authenticated, service_role;

-- hiring now starts the onboarding record (step 1)
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
          jsonb_build_object('hired_at', now(), 'hire_id', h.id, 'first_task', h.first_task, 'cost', h.cost,
                             'onboarding', jsonb_build_object('stage', 'hired', 'hired_at', now())));
  update team_hires set status = 'hired', decided_at = now(), hired_slug = v_slug where id = p_id;

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

-- Suggested hires: proposed, plus hires still in training (they leave the list once working or cancelled)
create or replace function public.admin_team_hires() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(h) || jsonb_build_object('onboarding', a.profile->'onboarding', 'agent_status', a.status)
                    order by (h.status = 'proposed') desc, h.improver_score desc, h.created_at desc), '[]')
            from (select * from team_hires
                   where status = 'proposed' or (status = 'hired' and live_at is null and cancelled_at is null)
                   order by created_at desc limit 30) h
            left join bestly_agents a on a.slug = h.hired_slug);
end $$;
revoke all on function public.admin_team_hires() from public, anon;
grant execute on function public.admin_team_hires() to authenticated, service_role;

-- watchdog: a hire stuck on one step for 7+ days gets one nudge to Scout (per step)
create or replace function public.hire_training_sweep() returns int
language plpgsql security definer set search_path to 'public' as $$
declare r record; n int := 0; v_since timestamptz;
begin
  for r in select slug, name, coalesce(profile->'onboarding', jsonb_build_object('stage', 'hired', 'hired_at', profile->>'hired_at')) o from bestly_agents
            where status = 'planned' and kind = 'open_role' and profile ? 'hire_id' loop
    v_since := coalesce((r.o->>(coalesce(r.o->>'stage', 'hired') || '_at'))::timestamptz, (r.o->>'hired_at')::timestamptz, now());
    if v_since < now() - interval '7 days' then
      perform scout_notify(p_title => r.name || ' is stuck in training',
        p_body => r.name || ' has been on "' || coalesce(r.o->>'stage', 'hired') || '" for a week. Open Suggested hires to copy its build plan, or cancel the hire.',
        p_severity => 'info', p_push => false, p_url => '/admin/team#hires', p_dedupe => 'hire-stuck-' || r.slug || '-' || coalesce(r.o->>'stage', 'hired'));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.hire_training_sweep() from public, anon, authenticated;

select cron.schedule('org-chart-watch', '7-59/10 * * * *', $$select public.team_watch(); select public.team_welcome_sweep(); select public.hire_training_sweep();$$);
