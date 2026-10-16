-- One source of truth for connect instructions (Jared, 2026-10-16): "make the instructions in settings the same as
-- in the todos for the connections." A to-do with source.connect_platform now carries `connect`, the exact jsonb
-- client_connect_tile(client, platform) gives the Settings tile (prep steps, conditional YouTube unverified step,
-- trouble items, live action link). The board draws the steps from that, not from title/detail/forward.next text.
-- Title, due, tick-off are untouched. Rollback: re-apply the previous client_todos_board (no `connect` key) and
-- flip the board app back (see tools/studio-connect-steps/README.md).

-- 1. client_todos_board: add `connect` for open connect to-dos; repair the stored /c/ link from the live tile link.
create or replace function public.client_todos_board(p_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare c public.approval_caller;
begin
  c := public.approval_resolve_client(p_token);
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true,
    'todos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
        'id', t.id, 'title', t.title, 'detail', t.detail, 'due', t.due,
        'status', t.status, 'done_at', t.done_at,
        'next', t.forward->>'next',
        'we_can', t.forward->>'we_can',
        'blocked', t.forward->>'blocked',
        'handed_at', t.forward->>'handed_at',
        'links', coalesce((select jsonb_agg(l) from jsonb_array_elements(
                   case when jsonb_typeof(t.forward->'links') = 'array' then t.forward->'links' else '[]'::jsonb end) l
                   where l->>'url' ~* '^(https://|mailto:)'), '[]'::jsonb),
        'from', case when t.source is not null then jsonb_build_object(
                  'label', t.source->>'label', 'meeting', t.source->>'meeting',
                  'at', t.source->>'at', 'quote', t.source->>'quote') end)
        || case when t.status = 'open' and t.source->>'connect_platform' is not null then
             jsonb_build_object('connect_platform', t.source->>'connect_platform', 'connect', x.tile,
               'links', (
                 -- keep her stored links, except a /c/ short link that is no longer live; then add the tile's live link
                 select coalesce(jsonb_agg(l), '[]'::jsonb) || case
                          when x.tile->'action'->>'kind' = 'link' and x.tile->'action'->>'url' ~ '^https://'
                           and not exists (select 1 from jsonb_array_elements(
                                 case when jsonb_typeof(t.forward->'links') = 'array' then t.forward->'links' else '[]'::jsonb end) k
                                 where k->>'url' = x.tile->'action'->>'url')
                          then jsonb_build_array(jsonb_build_object('url', x.tile->'action'->>'url',
                                 'label', coalesce(x.tile->'action'->>'label', 'Connect')))
                          else '[]'::jsonb end
                   from jsonb_array_elements(
                          case when jsonb_typeof(t.forward->'links') = 'array' then t.forward->'links' else '[]'::jsonb end) l
                  where l->>'url' ~* '^(https://|mailto:)'
                    and (l->>'url' !~ '^https://www\.bestly\.tech/c/'
                         or l->>'url' = x.tile->'action'->>'url'
                         or coalesce(x.tile->'action'->>'kind', '') <> 'link'))
             ) else '{}'::jsonb end
        order by (t.status = 'open') desc, (t.status = 'ours') desc,
                 t.due nulls last, t.position, t.created_at)
      from public.client_todos t
      left join lateral (select case when t.status = 'open' and t.source->>'connect_platform' is not null
                                     then public.client_connect_tile(c.id, t.source->>'connect_platform') end as tile) x on true
      where t.client_id = c.id and t.status not in ('dropped', 'draft')), '[]'::jsonb));
end $function$;

-- 2. Seeder writes a neutral detail so nothing contradicts the steps. Title stays; the steps come from the tile.
create or replace function public.studio_connect_todo_seed(p_slug text, p_platform text, p_due date default null::date, p_not_before date default '2026-10-22'::date)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c approval_clients%rowtype; h connect_platform_help%rowtype; v_due date; v_days smallint[]; v_today date; v_pos int; v_id uuid; i int;
begin
  select * into c from approval_clients where slug = p_slug and active;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'no_client'); end if;
  select * into h from connect_platform_help where platform = p_platform;
  if h.platform is null or h.todo_title is null then return jsonb_build_object('ok', false, 'error', 'no_todo_for_platform'); end if;
  if exists (select 1 from client_todos where client_id = c.id and source->>'connect_platform' = p_platform) then
    return jsonb_build_object('ok', true, 'seeded', false, 'reason', 'exists');
  end if;
  if c.social_brand is not null and exists (select 1 from social_accounts a where a.brand = c.social_brand and a.platform = p_platform and a.active and a.access_token is not null) then
    return jsonb_build_object('ok', true, 'seeded', false, 'reason', 'already_connected');
  end if;
  if p_due is not null then
    v_due := p_due;
  else
    v_today := (now() at time zone coalesce(c.tz, 'America/Los_Angeles'))::date;
    v_days := coalesce(c.todo_work_days, '{4,5}'::smallint[]);
    v_due := greatest(v_today + 1, p_not_before);
    for i in 0..13 loop
      exit when extract(isodow from v_due)::int = any (v_days);
      v_due := v_due + 1;
    end loop;
  end if;
  select coalesce(max(position), 0) + 1 into v_pos from client_todos where client_id = c.id;
  -- detail/next are neutral on purpose (2026-10-16): the steps on the card come live from client_connect_tile.
  insert into client_todos (client_id, title, detail, due, position, status, source, forward)
  values (c.id, h.todo_title, 'The steps are below.', v_due, v_pos, 'open',
          jsonb_build_object('label', 'Set up by Bestly', 'connect_platform', p_platform, 'auto', true),
          jsonb_build_object('next', 'This ticks itself off when it works.'))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'seeded', true, 'id', v_id, 'due', v_due);
end $function$;
