-- Reorg: let Jared pin a bot he wants let go, and let an undone reorg come back.
--
-- Why: Listing Bot (content-bot) was proposed for retirement, Jared tapped Undo, then decided he does want it gone
-- (its hourly task is switched off and Studio runs without it). Before this, nothing could bring it back: reorg_save
-- blocked any bot with a reorg in the last 60 days (undone included) and the AI was told never to pick one in past_reorgs.
--
-- 1. bestly_agents.profile.let_go_requested = true marks "Jared wants this one let go". The next reorg review always
--    proposes it (still needs his Approve tap, nothing is switched off automatically).
-- 2. An undone reorg no longer blocks a new proposal and no longer hides the bot from the AI.

create or replace function reorg_context()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  return hr_context() || jsonb_build_object(
    'protected', '["scout","improver","hr","fix-ladder","team-watch","team-watch-ping"]'::jsonb,
    'past_reorgs', (select coalesce(jsonb_agg(jsonb_build_object('bot', r.slug, 'kind', r.kind, 'status', r.status)), '[]')
                      from (select slug, kind, status from team_reorgs where status <> 'undone' order by created_at desc limit 40) r),
    'let_go_requested', (select coalesce(jsonb_agg(jsonb_build_object('bot', a.slug, 'name', a.name, 'note', a.profile->>'let_go_note')), '[]')
                           from bestly_agents a
                          where coalesce((a.profile->>'let_go_requested')::boolean, false)
                            and a.kind = 'agent' and a.status in ('active','paused','new')
                            and not exists (select 1 from team_reorgs x where x.slug = a.slug
                                              and x.status in ('proposed','done','kept')
                                              and x.created_at > now() - interval '60 days')));
end $$;

create or replace function reorg_save(p_moves jsonb)
returns integer language plpgsql security definer set search_path to 'public' as $$
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
     -- undone reorgs don't block a new proposal; a pending, done or kept one still does
     and not exists (select 1 from team_reorgs x where x.slug = m->>'bot' and x.status <> 'undone'
                       and x.created_at > now() - interval '60 days');
  get diagnostics n = row_count;
  return n;
end $$;

-- Jared's call: let Listing Bot go. The hourly Claude task is switched off, Studio (change requests, Rewriter, Post Sender)
-- runs without it, and nothing else reads its output. Only the realtor listing intake pauses with it.
update bestly_agents
   set profile = coalesce(profile, '{}'::jsonb) || jsonb_build_object(
         'let_go_requested', true,
         'let_go_note', 'Jared asked to let this one go (Oct 4). Its hourly task is switched off and Studio runs without it. Only the realtor listing intake pauses.'),
       updated_at = now()
 where slug = 'content-bot';
