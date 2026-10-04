-- 2026-10-04 Team page, round 4 (Jared): reorgs / layoffs.
--   Weekly (Mondays 9:30 AM, after The Improver 8:45 and The Recruiter's hiring look 9:15) The Recruiter looks for
--   bots whose jobs overlap, sit idle, or aren't needed any more, and proposes a reorg round: "merge" (its duties move
--   to another bot) or "retire" (nobody needs it). The Improver vets each one; only moves BOTH back reach Jared, in
--   "Reorg" on /admin/team. Jared can approve the whole round ("layoffs") or one bot at a time.
--   Let go = the bot is retired on the chart (alerts stop), anyone reporting to it moves to the bot taking its work
--   (or its boss), a farewell email goes out, Scout gets the off-boarding brief to actually switch the job off and
--   move its duties (waits for Jared's yes). The page plays a short farewell scene: Scout and The Recruiter break the
--   news, the bot packs a box and heads out. Undo ("Bring back") works for 7 days.
--   Protected, never proposed: Scout, The Improver, The Recruiter, Fix Ladder, Team Watch and its backup.
-- No drop statements on purpose (they need a person to confirm and stall unattended runs).

create table if not exists public.team_reorgs (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  round_id       uuid not null,                 -- one weekly review = one round
  kind           text not null check (kind in ('merge','retire')),
  slug           text not null references public.bestly_agents(slug) on delete cascade,
  into_slug      text references public.bestly_agents(slug) on delete set null,
  why            text,          -- The Recruiter's evidence
  change         text,          -- what moves where
  saves          text,
  risk           text,
  improver_note  text,
  improver_score int check (improver_score between 1 and 5),
  status         text not null default 'proposed' check (status in ('proposed','vetoed','done','kept','undone')),
  decided_at     timestamptz,
  prev_status    text,          -- for Undo
  moved_reports  text[]         -- bots that reported to it and were moved (for Undo)
);
create index if not exists team_reorgs_status_idx on public.team_reorgs (status, created_at desc);
alter table public.team_reorgs enable row level security;
revoke all on public.team_reorgs from anon, authenticated;

-- what The Recruiter reads for a reorg: the hiring picture + past reorgs + who is protected (service role only)
create or replace function public.reorg_context() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  return hr_context() || jsonb_build_object(
    'protected', '["scout","improver","hr","fix-ladder","team-watch","team-watch-ping"]'::jsonb,
    'past_reorgs', (select coalesce(jsonb_agg(jsonb_build_object('bot', r.slug, 'kind', r.kind, 'status', r.status)), '[]')
                      from (select slug, kind, status from team_reorgs order by created_at desc limit 40) r));
end $$;
revoke all on function public.reorg_context() from public, anon, authenticated;
grant execute on function public.reorg_context() to service_role;

-- save one round (backed and vetoed both, so neither comes back for 60 days). Returns rows saved.
create or replace function public.reorg_save(p_moves jsonb) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int; v_round uuid := gen_random_uuid();
begin
  insert into team_reorgs (round_id, kind, slug, into_slug, why, change, saves, risk, improver_note, improver_score, status)
  select v_round,
         case when m->>'kind' = 'merge' and m->>'into' is not null then 'merge' else 'retire' end,
         m->>'bot',
         (select slug from bestly_agents where slug = m->>'into' and status in ('active','new') and slug <> m->>'bot'),
         left(m->>'why', 600), left(m->>'change', 600), left(m->>'saves', 300), left(m->>'risk', 300),
         left(m->>'improver_note', 500), least(5, greatest(1, coalesce((m->>'improver_score')::int, 3))),
         case when m->>'verdict' = 'back' then 'proposed' else 'vetoed' end
    from jsonb_array_elements(p_moves) m
   where exists (select 1 from bestly_agents a where a.slug = m->>'bot' and a.kind = 'agent'
                   and a.status in ('active','paused','new'))
     and m->>'bot' not in ('scout','improver','hr','fix-ladder','team-watch','team-watch-ping')
     and not exists (select 1 from team_reorgs x where x.slug = m->>'bot' and x.created_at > now() - interval '60 days');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.reorg_save(jsonb) from public, anon, authenticated;
grant execute on function public.reorg_save(jsonb) to service_role;

create or replace function public.admin_team_reorgs() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', r.id, 'round_id', r.round_id, 'created_at', r.created_at, 'kind', r.kind, 'slug', r.slug, 'into_slug', r.into_slug,
            'why', r.why, 'change', r.change, 'saves', r.saves, 'risk', r.risk, 'improver_note', r.improver_note,
            'improver_score', r.improver_score, 'status', r.status, 'decided_at', r.decided_at,
            'name', a.name, 'role', a.role, 'icon', a.icon, 'what_it_does', a.what_it_does,
            'into_name', b.name, 'into_icon', b.icon)
          order by (r.status = 'proposed') desc, r.created_at desc), '[]')
            from team_reorgs r join bestly_agents a on a.slug = r.slug left join bestly_agents b on b.slug = r.into_slug
           where r.status = 'proposed' or (r.status = 'done' and r.decided_at > now() - interval '7 days'));
end $$;
revoke all on function public.admin_team_reorgs() from public, anon;
grant execute on function public.admin_team_reorgs() to authenticated, service_role;

-- Let go: retire the bot, move its reports, stop its alerts, send the farewell email. Returns what the scene shows.
create or replace function public.admin_reorg_execute(p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r team_reorgs; a bestly_agents; v_heir text; v_moved text[];
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  select * into r from team_reorgs where id = p_id for update;
  if r.id is null then raise exception 'no such reorg'; end if;
  if r.status <> 'proposed' then raise exception 'already decided'; end if;
  select * into a from bestly_agents where slug = r.slug;
  v_heir := coalesce(r.into_slug, a.reports_to, 'scout');

  select coalesce(array_agg(slug), '{}') into v_moved from bestly_agents where reports_to = r.slug and status <> 'retired';
  update bestly_agents set reports_to = v_heir, updated_at = now() where reports_to = r.slug and status <> 'retired';
  update bestly_agents set status = 'retired', updated_at = now(),
         profile = coalesce(profile, '{}'::jsonb) || jsonb_build_object('retired_at', now(), 'reorg_id', r.id, 'duties_to', r.into_slug)
   where slug = r.slug;
  update team_reorgs set status = 'done', decided_at = now(), prev_status = a.status, moved_reports = v_moved where id = p_id;
  -- a retired bot never keeps a "gone quiet" alert open
  perform bestly_raise('team.silent.' || r.slug, 'resolved', 'info', null);

  begin
    perform invoke_edge_function('team-hr', jsonb_build_object('op', 'farewell', 'id', r.id), 60000);
  exception when others then null;   -- the farewell email is a nicety; the reorg already happened
  end;

  return jsonb_build_object('slug', r.slug, 'name', a.name, 'icon', a.icon, 'into_slug', r.into_slug,
    'into_name', (select name from bestly_agents where slug = r.into_slug), 'moved', to_jsonb(v_moved));
end $$;
revoke all on function public.admin_reorg_execute(uuid) from public, anon;
grant execute on function public.admin_reorg_execute(uuid) to authenticated, service_role;

create or replace function public.admin_reorg_keep(p_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  update team_reorgs set status = 'kept', decided_at = now() where id = p_id and status = 'proposed';
end $$;
revoke all on function public.admin_reorg_keep(uuid) from public, anon;
grant execute on function public.admin_reorg_keep(uuid) to authenticated, service_role;

-- Bring back (7 days): the bot returns with its old status and its old reports.
create or replace function public.admin_reorg_undo(p_id uuid) returns text
language plpgsql security definer set search_path to 'public' as $$
declare r team_reorgs;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  select * into r from team_reorgs where id = p_id for update;
  if r.id is null or r.status <> 'done' then raise exception 'nothing to undo'; end if;
  if r.decided_at < now() - interval '7 days' then raise exception 'too late to undo (7 days)'; end if;
  update bestly_agents set status = coalesce(r.prev_status, 'active'), updated_at = now(),
         profile = coalesce(profile, '{}'::jsonb) - 'retired_at' - 'reorg_id' - 'duties_to'
   where slug = r.slug;
  update bestly_agents set reports_to = r.slug, updated_at = now() where slug = any(coalesce(r.moved_reports, '{}'));
  update team_reorgs set status = 'undone', decided_at = now() where id = p_id;
  return r.slug;
end $$;
revoke all on function public.admin_reorg_undo(uuid) from public, anon;
grant execute on function public.admin_reorg_undo(uuid) to authenticated, service_role;

-- what the farewell email needs (service role only)
create or replace function public.reorg_farewell_get(p_id uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('reorg', to_jsonb(r), 'agent', to_jsonb(a) - 'pulse',
    'heir', (select jsonb_build_object('name', b.name, 'role', b.role) from bestly_agents b where b.slug = r.into_slug),
    'team_size', (select count(*) from bestly_agents where kind = 'agent' and status in ('active','new')))
  from team_reorgs r join bestly_agents a on a.slug = r.slug where r.id = p_id
$$;
revoke all on function public.reorg_farewell_get(uuid) from public, anon, authenticated;
grant execute on function public.reorg_farewell_get(uuid) to service_role;

select cron.schedule('reorg-weekly', '30 16 * * 1', $$select public.invoke_edge_function('team-hr', '{"op":"reorg"}'::jsonb, 150000)$$);  -- Mon 9:30 AM PDT
