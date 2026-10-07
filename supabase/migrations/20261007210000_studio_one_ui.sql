-- 2026-10-07 (Spark): one Studio UI for every project.
-- Jared, Oct 6 9:22 PM: HOKU "keeps reverting to the older UI. Make it the same one Elizabeth uses, for everything."
-- Root cause (app code, not a deploy): the Studio app had two Queues. A brand that publishes from the social pipeline
-- (kind 'house': HOKU, Cookie Yeti, InventoryProof) was painted by paintHouse() from social_posts; the 4 s live check,
-- syncs and notes repainted the standard Queue over it, so the page flipped between the two and the brand's own posts
-- under review disappeared from the one it kept landing on. The app build now has ONE Queue; the pipeline schedule is a
-- card inside it. Per-project behaviour stays data (guide_only boards take no sends; pipeline posts show a card).
-- These statements record what was applied live with execute_sql (apply_migration is cancelled in these sessions).
-- Everything here is idempotent; the Studio build itself ships by row flip (see bestly_memory studio/one-ui-2026-10-07).

-- 1. the pipeline posts say which approval item they came from, so the Queue can tell
--    "scheduled from an approved item" from "made by the pipeline" without showing a post twice
create or replace function public.studio_house_board(p_token text, p_slug text)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  s public.studio_caller;
  v_brand text; v_name text;
  v_acct jsonb; v_posts jsonb; v_drain jsonb; v_counts jsonb;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.staff_may_see_slug(s.id, p_slug) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;

  select c.social_brand, c.name into v_brand, v_name
    from public.approval_clients c where c.slug = p_slug and c.active and c.social_brand is not null;
  if v_brand is null then return jsonb_build_object('ok', false, 'error', 'not_house'); end if;

  select jsonb_build_object(
           'brand', a.brand, 'handle', a.handle, 'accent', a.accent, 'active', a.active,
           'connected', (a.access_token is not null and a.remote_user_id is not null),
           'api', case when a.access_token like 'EA%' then 'Facebook Login' else 'Instagram Login' end,
           'token_expires_at', a.token_expires_at,
           'never_expires', (a.access_token is not null and a.token_expires_at is null),
           'publishing_paused', a.publishing_paused)
    into v_acct
    from public.social_accounts a where a.brand = v_brand and a.platform = 'instagram' limit 1;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', p.id, 'status', p.status, 'type', p.media_type,
           'slides', coalesce(array_length(p.media_urls, 1), 1),
           'media_urls', coalesce(to_jsonb(p.media_urls), to_jsonb(array[p.media_url])),
           'cover', coalesce(p.cover_url, p.media_url),
           'hook', left(split_part(coalesce(p.caption,''), E'\n', 1), 140),
           'caption', p.caption,
           'scheduled_at', p.scheduled_at, 'posted_at', p.posted_at,
           'permalink', p.permalink, 'attempts', p.attempts,
           'item', p.approval_item_id,
           'error', left(p.error, 240)))
           order by p.scheduled_at), '[]'::jsonb)
    into v_posts
    from public.social_posts p
   where p.brand = v_brand and p.platform = 'instagram' and p.status <> 'canceled';

  select jsonb_build_object(
           'queued', count(*) filter (where status = 'queued'),
           'posted', count(*) filter (where status = 'posted'),
           'held',   count(*) filter (where status = 'held'),
           'failed', count(*) filter (where status = 'failed'),
           'overdue', count(*) filter (where status = 'queued' and scheduled_at < now() - interval '30 minutes'),
           'next_at', min(scheduled_at) filter (where status = 'queued' and scheduled_at > now()),
           'last_at', max(scheduled_at) filter (where status = 'queued'),
           'runway_days', greatest(0, (extract(epoch from (max(scheduled_at) filter (where status = 'queued') - now())) / 86400)::int))
    into v_counts
    from public.social_posts where brand = v_brand and platform = 'instagram';

  select to_jsonb(d) into v_drain from public.social_drain_status() d;

  return jsonb_build_object('ok', true,
    'staff', jsonb_build_object('name', s.name, 'slug', s.slug, 'can_promote', s.can_promote),
    'client', jsonb_build_object('slug', p_slug, 'name', v_name, 'brand', v_brand),
    'account', coalesce(v_acct, '{}'::jsonb),
    'counts', v_counts,
    'drain', coalesce(v_drain, '{}'::jsonb),
    'posts', v_posts);
end $function$;

-- 2. the client list says whether a board takes sends (guide_only boards show the brand guide and nothing else)
create or replace function public.studio_clients(p_token text)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare s public.studio_caller;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'clients', coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'slug', c.slug, 'name', c.name, 'contact', c.contact_name,
             'kind', c.kind,
             'brand', c.social_brand,
             'handle', sa.handle,
             'accent', sa.accent,
             'guide_only', coalesce(c.guide_only, false),
             'logo_path', (select u.path from public.client_uploads u
                            where u.client_id = c.id and u.purpose = 'brand_guide'
                              and u.question_key = 'logo' and u.mime like 'image/%'
                              and u.status not in ('failed','removed')
                            order by u.created_at desc limit 1),
             'open_asks', case when c.kind = 'client'
                 then (select count(*) from public.client_asks a where a.client_id = c.id and a.status in ('draft','open','received'))
                 else 0 end,
             'board_url', case when c.kind = 'client' then 'https://studio.bestly.tech/' || c.slug || '?c=' || c.access_token end,
             'guide_url', 'https://studio.bestly.tech/' || c.slug || '?c=' || c.access_token || '#guide'))
           order by c.kind, c.name)
      from public.approval_clients c
      left join public.social_accounts sa on sa.brand = c.social_brand and sa.platform = 'instagram'
     where c.active and public.staff_may_see(s.id, c.id)), '[]'::jsonb));
end $function$;

-- 3. Cookie Yeti and Centering YOU both numbered their posts CY01, CY02, ... so "CY07" could mean either.
--    Cookie Yeti gets CK. Its three posts were unposted internal drafts, so they are renumbered CK01-CK03
--    (triggers skipped on purpose: this must not bump versions or notify anyone). Nothing else is renumbered.
set local session_replication_role = replica;
update public.approval_items set code = 'CK' || substr(code, 3)
 where client_id = (select id from public.approval_clients where slug = 'cookie-yeti') and code like 'CY%';
update public.approval_clients set code_prefix = 'CK' where slug = 'cookie-yeti' and code_prefix is distinct from 'CK';
set local session_replication_role = default;

-- 4. and it cannot happen again: one prefix per client, and a new client's prefix steps aside from any taken one
create unique index if not exists approval_clients_code_prefix_uq on public.approval_clients (code_prefix) where code_prefix is not null;

create or replace function public.client_code_prefix_free(p_name text, p_self uuid default null)
returns text language plpgsql stable set search_path to 'public', 'extensions', 'pg_temp' as $f$
declare base text := public.client_code_prefix(p_name); cand text := base; i int := 0;
begin
  while exists (select 1 from public.approval_clients c where c.code_prefix = cand and (p_self is null or c.id <> p_self)) loop
    i := i + 1;
    cand := base || chr(64 + i);          -- CY -> CYA -> CYB ...
    exit when i > 25;
  end loop;
  return cand;
end $f$;

create or replace function public.trg_items_assign_code()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare c public.approval_clients%rowtype; n int;
begin
  select * into c from public.approval_clients where id = new.client_id for update;
  if c.id is null then return new; end if;
  if c.code_prefix is null then
    c.code_prefix := public.client_code_prefix_free(c.name, c.id);
    update public.approval_clients set code_prefix = c.code_prefix where id = c.id;
  end if;
  n := c.code_next;
  new.code := c.code_prefix || lpad(n::text, 2, '0');
  update public.approval_clients set code_next = n + 1 where id = c.id;
  return new;
end $f$;

-- 5. the guard. Owner: Studio Watch (notification prefix 'studio'). Daily at 11:17 UTC (4:17 AM PT), after
--    studio_ui_contract_request has fetched the live app files at 11:05. Reports through scout_notify, signed
--    "Studio Watch:", silent (bell + recap) because a layout regression is not one of the four kinds that interrupt.
create or replace function public.studio_one_ui_check() returns jsonb
language plpgsql security definer set search_path to 'public' as $f$
declare r record; t text; v_bad text[] := '{}'; v_files int := 0; v_title text; v_body text;
begin
  for r in select distinct on (f.file) f.file, h.content
             from public.studio_ui_contract_fetch f join net._http_response h on h.id = f.req
            where f.at > now() - interval '3 hours' and h.status_code = 200 and f.file ~ '/index\.'
            order by f.file, f.at desc loop
    v_files := v_files + 1;
    foreach t in array array['function isHouse', 'paintHouseQueue', 'paintHouseDetail', 'async function paintHouse(', 'isHouse()'] loop
      if position(t in r.content) > 0 then
        v_bad := v_bad || (r.file || ' still has a second Queue layout for house brands (' || t || ')');
      end if;
    end loop;
    foreach t in array array['pipeOpen', 'function pipeMount', 'function tabs()', 'hasBank'] loop
      if position(t in r.content) = 0 then
        v_bad := v_bad || (r.file || ' is missing ' || t || ' from the one-Queue contract');
      end if;
    end loop;
  end loop;
  if position('guide_only' in (select prosrc from pg_proc where proname = 'studio_clients' and pronamespace = 'public'::regnamespace limit 1)) = 0 then
    v_bad := v_bad || 'studio_clients no longer returns guide_only, so the Queue cannot tell which boards take sends';
  end if;
  if exists (select 1 from public.approval_clients where code_prefix is not null group by code_prefix having count(*) > 1) then
    v_bad := v_bad || 'two clients share a post-number prefix';
  end if;

  if v_files = 0 then
    v_title := 'Studio Watch: could not read the live Studio app';
    v_body := 'studio_ui_contract_request fetched nothing in the last 3 hours, so the one-Queue check had nothing to read.';
    perform public.scout_notify(p_title => v_title, p_body => v_body, p_severity => 'warning', p_push => false,
      p_url => '/admin', p_dedupe => 'studio-one-ui-nofetch-' || to_char(now(), 'YYYYMMDD'));
  elsif coalesce(array_length(v_bad, 1), 0) > 0 then
    v_title := 'Studio Watch: Studio no longer has one Queue for every project';
    v_body := array_to_string(v_bad, E'\n') || E'\nFix: ship the build that uses one Queue for all projects, or flip back to the last good row. Studio Watch checks again tomorrow at 4:17 AM PT.';
    perform public.scout_notify(p_title => v_title, p_body => v_body, p_severity => 'warning', p_push => false,
      p_url => '/admin', p_dedupe => 'studio-one-ui-' || to_char(now(), 'YYYYMMDD'));
  end if;
  return jsonb_build_object('ok', coalesce(array_length(v_bad, 1), 0) = 0 and v_files > 0, 'files', v_files, 'problems', to_jsonb(v_bad));
end $f$;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'studio-one-ui-check') then
    perform cron.schedule('studio-one-ui-check', '17 11 * * *', 'select public.studio_one_ui_check()');
  end if;
end $$;

-- 6. team card: Studio Watch owns the job (pulse names every cron it owns) and says so
update public.bestly_agents
   set pulse = jsonb_set(pulse, '{also}', (pulse->'also') || '"studio-one-ui-check"'::jsonb),
       what_it_does = 'Opens Studio every 5 minutes to make sure it loads. Each morning it also checks that every project uses the one Queue (no second layout for HOKU, Cookie Yeti or InventoryProof) and that the pages call the database correctly.',
       updated_at = now()
 where slug = 'studio-watch' and not (pulse->'also') ? 'studio-one-ui-check';
