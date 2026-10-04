-- 2026-10-04 Reorg handovers (Jared: "display if any of these responsibilities are being transferred to another employee").
--   Each reorg move now carries a handover list: [{duty, to}] where to = the bot taking that duty, or null = dropped.
--   Shown on the reorg card, in the farewell scene and email. On Let go, every bot that takes a duty gets it recorded
--   in profile.inherited ([{reorg_id, from_slug, from_name, duties[], at}]) so its card and details say "Took over".
--   Undo removes those records. Moves without a handover fall back to one line: the bot's whole job -> into_slug.

alter table public.team_reorgs add column if not exists handover jsonb;

-- the handover with names/icons resolved, plus who reports to the bot today (they move on Let go)
create or replace function public.reorg_handover_view(p_id uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with r as (select * from team_reorgs where id = p_id),
  h as (
    select coalesce(
      (select jsonb_agg(x) from jsonb_array_elements(r.handover) x where coalesce(x->>'duty','') <> ''),
      jsonb_build_array(jsonb_build_object('duty', (select what_it_does from bestly_agents where slug = r.slug), 'to', r.into_slug))
    ) arr from r)
  select jsonb_build_object(
    'duties', (select coalesce(jsonb_agg(jsonb_build_object('duty', d->>'duty', 'to', b.slug, 'to_name', b.name, 'to_icon', b.icon)), '[]')
                 from h, jsonb_array_elements(h.arr) d left join bestly_agents b on b.slug = d->>'to' and b.status <> 'retired'),
    -- before Let go: who reports to it today; after: who was moved
    'reports', (select coalesce(jsonb_agg(jsonb_build_object('slug', a.slug, 'name', a.name)), '[]')
                  from r, bestly_agents a
                 where case when r.status = 'done' then a.slug = any(coalesce(r.moved_reports, '{}'))
                            else a.reports_to = r.slug and a.status <> 'retired' end),
    'reports_to', (select jsonb_build_object('slug', b.slug, 'name', b.name) from r, bestly_agents me, bestly_agents b
                    where me.slug = r.slug and b.slug = coalesce(r.into_slug, me.reports_to, 'scout')))
$$;
revoke all on function public.reorg_handover_view(uuid) from public, anon, authenticated;
grant execute on function public.reorg_handover_view(uuid) to service_role;

-- save: same as before plus the handover (only real, non-retired bots can receive a duty)
create or replace function public.reorg_save(p_moves jsonb) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int; v_round uuid := gen_random_uuid();
begin
  insert into team_reorgs (round_id, kind, slug, into_slug, why, change, saves, risk, improver_note, improver_score, status, handover)
  select v_round,
         case when m->>'kind' = 'merge' and m->>'into' is not null then 'merge' else 'retire' end,
         m->>'bot',
         (select slug from bestly_agents where slug = m->>'into' and status in ('active','new') and slug <> m->>'bot'),
         left(m->>'why', 600), left(m->>'change', 600), left(m->>'saves', 300), left(m->>'risk', 300),
         left(m->>'improver_note', 500), least(5, greatest(1, coalesce((m->>'improver_score')::int, 3))),
         case when m->>'verdict' = 'back' then 'proposed' else 'vetoed' end,
         (select jsonb_agg(jsonb_build_object('duty', left(d->>'duty', 200),
                   'to', (select slug from bestly_agents where slug = d->>'to' and status in ('active','new') and slug <> m->>'bot')))
            from jsonb_array_elements(case when jsonb_typeof(m->'handover') = 'array' then m->'handover' else '[]'::jsonb end) d
           where coalesce(d->>'duty', '') <> '')
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

-- the list now carries the resolved handover for each move
create or replace function public.admin_team_reorgs() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', r.id, 'round_id', r.round_id, 'created_at', r.created_at, 'kind', r.kind, 'slug', r.slug, 'into_slug', r.into_slug,
            'why', r.why, 'change', r.change, 'saves', r.saves, 'risk', r.risk, 'improver_note', r.improver_note,
            'improver_score', r.improver_score, 'status', r.status, 'decided_at', r.decided_at,
            'name', a.name, 'role', a.role, 'icon', a.icon, 'what_it_does', a.what_it_does,
            'into_name', b.name, 'into_icon', b.icon,
            'handover', reorg_handover_view(r.id))
          order by (r.status = 'proposed') desc, r.created_at desc), '[]')
            from team_reorgs r join bestly_agents a on a.slug = r.slug left join bestly_agents b on b.slug = r.into_slug
           where r.status = 'proposed' or (r.status = 'done' and r.decided_at > now() - interval '7 days'));
end $$;
revoke all on function public.admin_team_reorgs() from public, anon;
grant execute on function public.admin_team_reorgs() to authenticated, service_role;

-- Let go: as before, plus each bot that takes a duty records it under profile.inherited
create or replace function public.admin_reorg_execute(p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r team_reorgs; a bestly_agents; v_heir text; v_moved text[]; v_view jsonb; t record;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  select * into r from team_reorgs where id = p_id for update;
  if r.id is null then raise exception 'no such reorg'; end if;
  if r.status <> 'proposed' then raise exception 'already decided'; end if;
  select * into a from bestly_agents where slug = r.slug;
  v_heir := coalesce(r.into_slug, a.reports_to, 'scout');
  v_view := reorg_handover_view(p_id);   -- read before anything moves

  -- every bot taking a duty gets a "Took over" record
  for t in select d->>'to' to_slug, jsonb_agg(d->>'duty') duties
             from jsonb_array_elements(v_view->'duties') d where d->>'to' is not null group by d->>'to' loop
    update bestly_agents set updated_at = now(),
           profile = coalesce(profile, '{}'::jsonb) || jsonb_build_object('inherited',
             coalesce(profile->'inherited', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
               'reorg_id', r.id, 'from_slug', r.slug, 'from_name', a.name, 'duties', t.duties, 'at', now())))
     where slug = t.to_slug;
  end loop;

  select coalesce(array_agg(slug), '{}') into v_moved from bestly_agents where reports_to = r.slug and status <> 'retired';
  update bestly_agents set reports_to = v_heir, updated_at = now() where reports_to = r.slug and status <> 'retired';
  update bestly_agents set status = 'retired', updated_at = now(),
         profile = coalesce(profile, '{}'::jsonb) || jsonb_build_object('retired_at', now(), 'reorg_id', r.id, 'duties_to', r.into_slug)
   where slug = r.slug;
  update team_reorgs set status = 'done', decided_at = now(), prev_status = a.status, moved_reports = v_moved where id = p_id;
  perform bestly_raise('team.silent.' || r.slug, 'resolved', 'info', null);

  begin
    perform invoke_edge_function('team-hr', jsonb_build_object('op', 'farewell', 'id', r.id), 60000);
  exception when others then null;
  end;

  return jsonb_build_object('slug', r.slug, 'name', a.name, 'icon', a.icon, 'into_slug', r.into_slug,
    'into_name', (select name from bestly_agents where slug = r.into_slug), 'moved', to_jsonb(v_moved), 'handover', v_view);
end $$;
revoke all on function public.admin_reorg_execute(uuid) from public, anon;
grant execute on function public.admin_reorg_execute(uuid) to authenticated, service_role;

-- Bring back: as before, plus the "Took over" records from this reorg come off the other bots
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
  update bestly_agents set updated_at = now(),
         profile = profile || jsonb_build_object('inherited',
           coalesce((select jsonb_agg(e) from jsonb_array_elements(profile->'inherited') e where e->>'reorg_id' <> r.id::text), '[]'::jsonb))
   where profile ? 'inherited' and exists (select 1 from jsonb_array_elements(profile->'inherited') e where e->>'reorg_id' = r.id::text);
  update team_reorgs set status = 'undone', decided_at = now() where id = p_id;
  return r.slug;
end $$;
revoke all on function public.admin_reorg_undo(uuid) from public, anon;
grant execute on function public.admin_reorg_undo(uuid) to authenticated, service_role;

-- the farewell email gets the resolved handover too
create or replace function public.reorg_farewell_get(p_id uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('reorg', to_jsonb(r), 'agent', to_jsonb(a) - 'pulse',
    'heir', (select jsonb_build_object('name', b.name, 'role', b.role) from bestly_agents b where b.slug = r.into_slug),
    'handover', reorg_handover_view(r.id),
    'team_size', (select count(*) from bestly_agents where kind = 'agent' and status in ('active','new')))
  from team_reorgs r join bestly_agents a on a.slug = r.slug where r.id = p_id
$$;
revoke all on function public.reorg_farewell_get(uuid) from public, anon, authenticated;
grant execute on function public.reorg_farewell_get(uuid) to service_role;
