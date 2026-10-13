-- Studio: house brands get a Post button (2026-10-12). Spark. Reproduces what was applied live in pieces.
-- Append-only: this file is the whole change. Live rollback is the studio_builds base_build noted in bestly_memory studio/house-post-button-2026-10-12.

-- accounts map
create table if not exists public.approval_client_accounts (
  client_id  uuid not null references public.approval_clients(id) on delete cascade,
  account_id uuid not null references public.social_accounts(id) on delete cascade,
  sort       int  not null default 0,
  note       text,
  created_at timestamptz not null default now(),
  primary key (client_id, account_id)
);
alter table public.approval_client_accounts enable row level security;
comment on table public.approval_client_accounts is
  'Which social account(s) a house brand posts to from Studio (Post button). Add a row for a new house brand; no code change. RLS on, no policies: read through house_post_targets() / studio_clients().';

insert into public.approval_client_accounts (client_id, account_id, note)
select c.id, a.id, m.note
  from (values
    ('bestly-cloud',   '@bestly_llc',          'Bestly Cloud posts go to the Bestly account'),
    ('bestly-studio',  '@bestly_llc',          'Bestly Studio posts go to the Bestly account'),
    ('inventoryproof', '@inventoryproof',      null),
    ('cookie-yeti',    '@cookie_yeti_privacy', null),
    ('hoku',           '@hoku_hocl',           null)
  ) m(slug, handle, note)
  join public.approval_clients c on c.slug = m.slug
  join public.social_accounts a on a.handle = m.handle and a.platform = 'instagram'
on conflict do nothing;

create or replace function public.house_post_targets(p_client uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with mapped as (
    select a.*, m.sort from public.approval_client_accounts m
      join public.social_accounts a on a.id = m.account_id where m.client_id = p_client
  ), fallback as (
    select a.*, 0 as sort from public.approval_clients c
      join public.social_accounts a on a.brand = c.social_brand and a.platform = 'instagram'
     where c.id = p_client and not exists (select 1 from mapped)
  ), t as (select * from mapped union all select * from fallback)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'platform', t.platform, 'handle', t.handle, 'brand', t.brand,
      'ready', (t.active and t.access_token is not null and t.remote_user_id is not null and not t.publishing_paused),
      'why', case when t.access_token is null or t.remote_user_id is null then 'is not connected'
                  when not t.active then 'needs to be reconnected'
                  when t.publishing_paused then 'has posting paused' end
    ) order by t.sort, t.platform), '[]'::jsonb) from t;
$$;
revoke all on function public.house_post_targets(uuid) from public, anon, authenticated;

-- engine house mode
create or replace function public.social_enqueue_item(p_item uuid, p_at timestamp with time zone, p_actor text, p_force boolean default false, p_platform text default 'instagram')
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  it approval_items%rowtype; c approval_clients%rowtype; a social_accounts%rowtype;
  v_urls text[]; v_cap text; v_tags text[]; v_id uuid; v_n int; v_type text; v_cover text;
  v_acct uuid := nullif(current_setting('studio.house_account', true), '')::uuid;
  v_house boolean := false; v_brand text;
begin
  select * into it from approval_items where id = p_item;
  if it.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  select * into c from approval_clients where id = it.client_id;
  if p_platform not in ('instagram','tiktok') then return jsonb_build_object('ok', false, 'error', 'platform_not_ready', 'detail', p_platform || ' posting comes in the next phase.'); end if;
  if c.publish_mode = 'off' then return jsonb_build_object('ok', false, 'error', 'publishing_off'); end if;
  if v_acct is not null then
    if c.kind is distinct from 'house' then return jsonb_build_object('ok', false, 'error', 'not_house'); end if;
    v_house := true;
    select * into a from social_accounts where id = v_acct and platform = p_platform;
    v_brand := a.brand;
  else
    if c.social_brand is null then return jsonb_build_object('ok', false, 'error', p_platform || '_not_connected'); end if;
  end if;
  if not p_force and not public.claim_gate_ready(c.slug) then
    return jsonb_build_object('ok', false, 'error', 'claim_gate_not_set_up',
      'detail', 'This client has no claim rules of its own and nobody has confirmed house rules are enough.'); end if;
  if not v_house then
    select * into a from social_accounts where brand = c.social_brand and platform = p_platform;
    v_brand := c.social_brand;
  end if;
  if a.id is null or a.access_token is null or a.remote_user_id is null then
    return jsonb_build_object('ok', false, 'error', p_platform || '_not_connected'); end if;
  if not coalesce(a.active, false) then return jsonb_build_object('ok', false, 'error', p_platform || '_needs_reconnect'); end if;
  if v_house then
    if coalesce(public.studio_signoff(p_item)->>'state', 'pending') is distinct from 'approved' or it.internal_status = 'killed' then
      return jsonb_build_object('ok', false, 'error', 'not_approved', 'detail', 'Approve it first. Nothing posts before the team has signed off.'); end if;
  elsif not p_force and not (it.stage = 'client' and it.status = 'approved') then
    return jsonb_build_object('ok', false, 'error', 'not_approved', 'detail', 'Only work the client has approved can be posted.'); end if;
  if coalesce((it.provenance->>'publish_block')::boolean, false) and not p_force then
    return jsonb_build_object('ok', false, 'error', 'publish_blocked',
      'detail', coalesce(it.provenance->>'licensing', 'This item is marked not for publication.')); end if;
  if exists (select 1 from social_posts where approval_item_id = p_item and platform = p_platform and status in ('queued','posting','posted','held','in_drafts')) then
    return jsonb_build_object('ok', false, 'error', 'already_queued'); end if;
  if it.media_type = 'video' then
    if it.media_url is null then return jsonb_build_object('ok', false, 'error', 'no_media'); end if;
    v_urls := array[it.media_url]; v_n := 1; v_type := 'video'; v_cover := it.thumb_url;
  else
    if p_platform = 'tiktok' then return jsonb_build_object('ok', false, 'error', 'tiktok_video_only', 'detail', 'TikTok takes video only.'); end if;
    select array_agg(media_url order by position) into v_urls from approval_slides where item_id = p_item and media_url is not null;
    if v_urls is null then v_urls := array[it.media_url]; end if;
    v_n := coalesce(array_length(v_urls,1),0);
    if v_n = 0 or v_urls[1] is null then return jsonb_build_object('ok', false, 'error', 'no_media'); end if;
    if v_n > 10 then return jsonb_build_object('ok', false, 'error', 'too_many_slides', 'detail', format('Instagram takes at most 10 slides; this has %s.', v_n)); end if;
    v_type := case when v_n > 1 then 'carousel' else 'image' end;
  end if;
  select caption, hashtags into v_cap, v_tags from approval_variants where item_id = p_item and platform = p_platform order by created_at desc limit 1;
  if v_cap is null and p_platform = 'tiktok' then
    select caption, hashtags into v_cap, v_tags from approval_variants where item_id = p_item and platform = 'instagram' order by created_at desc limit 1;
  end if;
  v_cap := coalesce(v_cap, it.caption, '');
  if v_tags is not null and array_length(v_tags,1) > 0 then v_cap := v_cap || E'\n\n' || array_to_string(v_tags, ' '); end if;
  insert into social_posts (brand, platform, media_url, media_urls, media_type, cover_url, caption, scheduled_at, approval_item_id, content_version)
  values (v_brand, p_platform, v_urls[1], case when v_n > 1 then v_urls end, v_type, v_cover, left(v_cap, 2200), coalesce(p_at, now()), p_item, it.content_version)
  returning id into v_id;
  insert into approval_item_events (item_id, kind, actor_kind, payload)
  values (p_item, 'scheduled', case when p_actor = 'client' then 'client' else 'system' end,
          jsonb_build_object('social_post', v_id, 'platform', p_platform, 'at', coalesce(p_at, now()), 'by', p_actor, 'forced', p_force, 'house', v_house));
  return jsonb_build_object('ok', true, 'post', v_id, 'platform', p_platform, 'scheduled_at', coalesce(p_at, now()), 'slides', v_n, 'media_type', v_type, 'handle', a.handle);
end $function$;

-- RPCs: state, post, retry, cancel
create or replace function public.house_post_caption(p_item uuid, p_platform text)
returns text language plpgsql stable security definer set search_path = public as $$
declare it approval_items%rowtype; v_cap text; v_tags text[];
begin
  select * into it from approval_items where id = p_item;
  if it.id is null then return null; end if;
  select caption, hashtags into v_cap, v_tags from approval_variants where item_id = p_item and platform = p_platform order by created_at desc limit 1;
  if v_cap is null and p_platform = 'tiktok' then
    select caption, hashtags into v_cap, v_tags from approval_variants where item_id = p_item and platform = 'instagram' order by created_at desc limit 1;
  end if;
  v_cap := coalesce(v_cap, it.caption, '');
  if v_tags is not null and array_length(v_tags,1) > 0 then v_cap := v_cap || E'\n\n' || array_to_string(v_tags, ' '); end if;
  return left(v_cap, 2200);
end $$;
revoke all on function public.house_post_caption(uuid, text) from public, anon, authenticated;

create or replace function public.studio_house_post_state(p_token text, p_item uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s studio_caller; it approval_items%rowtype; c approval_clients%rowtype; v_t jsonb; v_first jsonb; v_brand text; v_tz text;
  v_posts jsonb; v_caps jsonb := '{}'::jsonb; v_slot timestamptz; v_d date; k int; e jsonb;
begin
  s := studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.staff_may_see_item(s.id, p_item) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  select * into it from approval_items where id = p_item;
  if it.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  select * into c from approval_clients where id = it.client_id;
  if c.kind is distinct from 'house' then return jsonb_build_object('ok', true, 'house', false); end if;
  v_t := public.house_post_targets(c.id);
  for e in select * from jsonb_array_elements(v_t) loop
    v_caps := v_caps || jsonb_build_object(e->>'platform', public.house_post_caption(p_item, e->>'platform'));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'platform', p.platform, 'handle', a.handle, 'status', p.status,
      'scheduled_at', p.scheduled_at, 'posted_at', p.posted_at, 'error', p.error, 'permalink', p.permalink,
      'attempts', p.attempts, 'max_attempts', p.max_attempts) order by p.created_at desc), '[]'::jsonb)
    into v_posts
    from public.social_posts p left join public.social_accounts a on a.brand = p.brand and a.platform = p.platform
   where p.approval_item_id = p_item;
  -- the next good slot: the account's usual time, on the first day that has a free one
  v_first := (select x from jsonb_array_elements(v_t) x where (x->>'ready')::boolean limit 1);
  v_brand := v_first->>'brand';
  v_tz := coalesce((select sb.tz from social_brand_settings sb where sb.brand = v_brand), 'America/Los_Angeles');
  if v_brand is not null then
    for k in 0..30 loop
      v_d := (now() at time zone v_tz)::date + k;
      v_slot := public.social_default_at(v_brand, v_d);
      if v_slot > now() + interval '15 minutes'
         and not exists (select 1 from social_posts q where q.brand = v_brand and q.status in ('queued','posting')
                          and (q.scheduled_at at time zone v_tz)::date = v_d) then exit; end if;
      v_slot := null;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'house', true, 'tz', v_tz, 'targets', v_t, 'posts', v_posts,
                            'captions', v_caps, 'next_slot', v_slot);
end $$;

create or replace function public.studio_house_post(p_token text, p_item uuid, p_at timestamp with time zone default null, p_platform text default 'instagram')
returns jsonb language plpgsql security definer set search_path = public as $$
declare s studio_caller; it approval_items%rowtype; c approval_clients%rowtype; t jsonb; v_miss text[]; v_at timestamptz; r jsonb; v_tz text; v_now boolean;
begin
  s := studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.staff_may_see_item(s.id, p_item) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if not s.can_promote then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  -- a person presses Post. Spark, the connector and the builder never do.
  if exists (select 1 from approval_staff a where a.id = s.id and a.is_system) then
    return jsonb_build_object('ok', false, 'error', 'human_required'); end if;
  select * into it from approval_items where id = p_item;
  if it.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  select * into c from approval_clients where id = it.client_id;
  if c.kind is distinct from 'house' then return jsonb_build_object('ok', false, 'error', 'not_house'); end if;
  if it.posted_at is not null then return jsonb_build_object('ok', false, 'error', 'already_posted'); end if;
  if it.internal_status = 'killed' or coalesce(public.studio_signoff(p_item)->>'state', 'pending') is distinct from 'approved' then
    return jsonb_build_object('ok', false, 'error', 'not_approved', 'detail', 'Approve it first. Nothing posts before the team has signed off.'); end if;
  v_miss := public.post_sells_product(p_item);
  if coalesce(array_length(v_miss, 1), 0) > 0 then
    return jsonb_build_object('ok', false, 'error', 'held', 'detail', 'A house rule holds it: ' || array_to_string(v_miss, '; ')); end if;
  select x into t from jsonb_array_elements(public.house_post_targets(c.id)) x where x->>'platform' = p_platform limit 1;
  if t is null then return jsonb_build_object('ok', false, 'error', 'no_account', 'detail', 'This project has no ' || p_platform || ' account to post to.'); end if;
  if not (t->>'ready')::boolean then
    return jsonb_build_object('ok', false, 'error', 'account_not_ready', 'detail', coalesce(t->>'handle', 'The account') || ' ' || coalesce(t->>'why', 'is not ready')); end if;
  v_at := coalesce(p_at, now());
  if p_at is not null and p_at < now() - interval '2 minutes' then return jsonb_build_object('ok', false, 'error', 'in_the_past', 'detail', 'That time has already passed.'); end if;
  if v_at > now() + interval '90 days' then return jsonb_build_object('ok', false, 'error', 'too_far', 'detail', 'Pick a time within the next 90 days.'); end if;
  perform set_config('studio.house_account', t->>'id', true);
  r := public.social_enqueue_item(p_item, v_at, s.name, false, p_platform);
  perform set_config('studio.house_account', '', true);
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  v_tz := coalesce((select sb.tz from social_brand_settings sb where sb.brand = t->>'brand'), 'America/Los_Angeles');
  update approval_items set posting_ready_at = coalesce(posting_ready_at, now()), scheduled_at = v_at,
         scheduled_for = (v_at at time zone v_tz)::date, time_locked = true where id = p_item;
  insert into approval_item_events (item_id, kind, actor_kind, staff_id, payload)
  values (p_item, 'posting_ready', 'staff', s.id, jsonb_build_object('by', s.name, 'house_post', r->'post', 'handle', t->>'handle', 'at', v_at));
  v_now := v_at <= now() + interval '1 minute';
  if v_now then perform invoke_edge_function('bestly-ig-poster', jsonb_build_object('action', 'drain'), 5000); end if;
  return r || jsonb_build_object('handle', t->>'handle', 'now', v_now);
end $$;

create or replace function public.studio_house_post_retry(p_token text, p_post uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s studio_caller; p social_posts%rowtype;
begin
  s := studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not s.can_promote then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if exists (select 1 from approval_staff a where a.id = s.id and a.is_system) then return jsonb_build_object('ok', false, 'error', 'human_required'); end if;
  select * into p from social_posts where id = p_post;
  if p.id is null or p.approval_item_id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.staff_may_see_item(s.id, p.approval_item_id) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if p.status <> 'failed' then return jsonb_build_object('ok', false, 'error', 'not_failed', 'status', p.status); end if;
  update social_posts set status = 'queued', attempts = 0, error = null, claimed_at = null, scheduled_at = now() where id = p_post;
  insert into social_post_events (post_id, brand, kind, staff_id, note) values (p_post, p.brand, 'retry', s.id, 'Retry from Studio');
  perform invoke_edge_function('bestly-ig-poster', jsonb_build_object('action', 'drain'), 5000);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.studio_house_post_cancel(p_token text, p_post uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s studio_caller; p social_posts%rowtype;
begin
  s := studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not s.can_promote then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  select * into p from social_posts where id = p_post;
  if p.id is null or p.approval_item_id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.staff_may_see_item(s.id, p.approval_item_id) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if p.status not in ('queued', 'failed') then return jsonb_build_object('ok', false, 'error', 'not_cancelable', 'status', p.status); end if;
  update social_posts set status = 'canceled' where id = p_post;
  update approval_items set posting_ready_at = null, scheduled_at = null, scheduled_for = null, time_locked = false
   where id = p.approval_item_id and posted_at is null;
  insert into social_post_events (post_id, brand, kind, staff_id, note) values (p_post, p.brand, 'cancel', s.id, 'Taken back from Studio');
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.studio_house_post_state(text, uuid) to anon, authenticated;
grant execute on function public.studio_house_post(text, uuid, timestamptz, text) to anon, authenticated;
grant execute on function public.studio_house_post_retry(text, uuid) to anon, authenticated;
grant execute on function public.studio_house_post_cancel(text, uuid) to anon, authenticated;
insert into public.security_public_rpcs (fn, why) values
 ('studio_house_post_state', 'Studio reads where a house brand posts and the state of its posts (publishable key + staff session token); token-gated'),
 ('studio_house_post', 'Studio Post button for house brands (publishable key + a human staff session token); refuses Spark and other system staff, needs team sign-off, queues through the existing engine'),
 ('studio_house_post_retry', 'Studio Retry on a failed house post (publishable key + human staff session token)'),
 ('studio_house_post_cancel', 'Studio takes back a queued or failed house post (publishable key + staff session token)')
on conflict (fn) do nothing;

-- clients payload
create or replace function public.studio_clients(p_token text)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare s public.studio_caller;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'clients', coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'slug', c.slug, 'name', c.name, 'contact', c.contact_name,
             'kind', c.kind,
             'brand', c.social_brand,
             'handle', coalesce(sa.handle, case when c.kind = 'house' then public.house_post_targets(c.id)->0->>'handle' end),
             'accent', sa.accent,
             'guide_only', coalesce(c.guide_only, false),
             -- 2026-10-12: where a house brand posts (approval_client_accounts); the Post button reads this
             'post_targets', case when c.kind = 'house' then public.house_post_targets(c.id) end,
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

-- failure alert owner + trigger
insert into public.notification_owners (prefix, agent_slug, note)
values ('studio.post', 'spark', 'A house-brand post that Studio queued did not go out; bell only, never a push')
on conflict (prefix) do nothing returning prefix;

-- failure alert function
create or replace function public.trg_house_post_alert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text; v_slug text; v_key text := 'studio.post.' || new.id::text;
begin
  if new.approval_item_id is null or new.status is not distinct from old.status then return new; end if;
  select i.title, c.slug into v_title, v_slug
    from approval_items i join approval_clients c on c.id = i.client_id
   where i.id = new.approval_item_id and c.kind = 'house';
  if v_slug is null then return new; end if;
  if new.status = 'failed' then
    perform bestly_raise(v_key, 'problem', 'info',
      'A post did not go out: ' || left(coalesce(v_title, 'a post'), 60),
      v_slug || ' to ' || coalesce((select a.handle from social_accounts a where a.brand = new.brand and a.platform = new.platform), new.platform)
        || ' failed after ' || new.attempts || ' tries. Open it in Studio and press Retry. ' || left(coalesce(new.error, ''), 300),
      'studio', null, true);
  elsif old.status = 'failed' then
    perform bestly_raise(v_key, 'resolved', 'info', 'Post recovered: ' || left(coalesce(v_title, 'a post'), 60), null, 'studio');
  end if;
  return new;
end $$;
revoke all on function public.trg_house_post_alert() from public, anon, authenticated;

create trigger house_post_alert after update of status on public.social_posts for each row execute function public.trg_house_post_alert();

-- engine watchdog leaves house posts to the alert
create or replace function public.social_engine_watch()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_bad text[] := '{}'; v_fixed text[] := '{}'; n int; v_last timestamptz; r record;
begin
  update social_posts set status = 'queued', claimed_at = null where status = 'posting' and claimed_at < now() - interval '20 minutes';
  get diagnostics n = row_count; if n > 0 then v_fixed := v_fixed || (n || ' post(s) stuck in posting reset to queued'); end if;
  select count(*) into n from social_posts where status = 'queued' and scheduled_at < now() - interval '30 minutes' and platform = 'instagram';
  if n > 0 then perform invoke_edge_function('bestly-ig-poster', jsonb_build_object('action','drain'), 5000); v_bad := v_bad || (n || ' Instagram post(s) more than 30 minutes past their slot — drain kicked'); end if;
  select count(*) into n from social_posts where status = 'queued' and scheduled_at < now() - interval '30 minutes' and platform = 'tiktok';
  if n > 0 then perform invoke_edge_function('tiktok-inbox', jsonb_build_object('action','drain'), 5000); v_bad := v_bad || (n || ' TikTok post(s) more than 30 minutes past their slot — drain kicked'); end if;
  for r in select j.jobname, max(d.end_time) last from cron.job j left join cron.job_run_details d on d.jobid = j.jobid and d.status = 'succeeded'
            where j.jobname in ('social-drain-instagram','social-drain-tiktok') group by j.jobname loop
    if r.last is null or r.last < now() - interval '10 minutes' then
      perform invoke_edge_function(case r.jobname when 'social-drain-instagram' then 'bestly-ig-poster' else 'tiktok-inbox' end, jsonb_build_object('action','drain'), 5000);
      v_bad := v_bad || (r.jobname || ' has not run in the last 10 minutes — drain kicked by hand');
    end if;
  end loop;
  select count(*) into n from social_accounts where active and access_token is not null and platform = 'instagram' and token_expires_at is not null and token_expires_at < now() + interval '7 days';
  if n > 0 then perform invoke_edge_function('bestly-ig-poster', jsonb_build_object('action','refresh'), 5000); v_fixed := v_fixed || (n || ' Instagram token(s) inside 7 days — refresh kicked'); end if;
  select count(*) into n from social_accounts where active and access_token is not null and platform = 'tiktok' and token_expires_at is not null and token_expires_at < now() + interval '2 hours';
  if n > 0 then perform invoke_edge_function('tiktok-inbox', jsonb_build_object('action','refresh'), 5000); v_fixed := v_fixed || (n || ' TikTok token(s) inside 2 hours — refresh kicked'); end if;
  select count(*) into n from social_accounts where active and access_token is not null and platform = 'tiktok' and refresh_expires_at is not null and refresh_expires_at < now() + interval '7 days';
  if n > 0 then v_bad := v_bad || (n || ' TikTok account(s) need a reconnect within 7 days (refresh token expiring)'); end if;
  select count(*) into n from social_accounts where active and access_token is not null and platform <> 'tiktok' and token_expires_at is not null and token_expires_at < now();
  if n > 0 then
    update social_accounts set active = false where active and access_token is not null and platform <> 'tiktok' and token_expires_at is not null and token_expires_at < now();
    v_bad := v_bad || (n || ' account(s) have an expired token — marked needs reconnect');
  end if;
  for r in select p.id, p.approval_item_id, it.client_id, it.title from social_posts p join approval_items it on it.id = p.approval_item_id
            where p.platform = 'tiktok' and p.status = 'in_drafts' and p.in_drafts_at < now() - interval '48 hours'
              and not exists (select 1 from notify_outbox o where o.dedupe = 'tiktok_draft_nudge:' || p.id) loop
    insert into notify_outbox (kind, audience, client_id, subject, body, link, dedupe, payload, sent_at)
    values ('tiktok_draft', 'client', r.client_id, 'Still in your TikTok drafts', '"' || coalesce(r.title, 'A video') || '" has been waiting in TikTok for two days. Paste the caption from your board, add the deck, and tap Post when you have a minute.', '#review', 'tiktok_draft_nudge:' || r.id, jsonb_build_object('item', r.approval_item_id, 'post', r.id), now());
    v_fixed := v_fixed || ('nudged her about a TikTok draft: ' || coalesce(r.title, r.id::text));
  end loop;
  -- 2026-10-12: a failed post on a HOUSE brand's Studio item has its own bell-only Spark alert (trg_house_post_alert) and a Retry button
  select count(*) into n from social_posts p where p.status = 'failed' and p.updated_at > now() - interval '24 hours'
     and not exists (select 1 from approval_items i join approval_clients c on c.id = i.client_id where i.id = p.approval_item_id and c.kind = 'house');
  if n > 0 then v_bad := v_bad || (n || ' post(s) failed in the last day (see the calendar)'); end if;
  if coalesce(array_length(v_bad, 1), 0) > 0 then
    perform public.bestly_raise('studio:posting-engine', 'problem', 'warn', array_length(v_bad, 1) || ' posting engine problem(s)', array_to_string(v_bad || v_fixed, E'\n'), 'ops');
  else
    perform public.bestly_raise('studio:posting-engine', 'resolved', 'info', 'Posting engine healthy' || case when array_length(v_fixed,1) > 0 then ' (healed: ' || array_to_string(v_fixed, '; ') || ')' else '' end, null, 'ops');
  end if;
  return jsonb_build_object('ok', true, 'problems', to_jsonb(coalesce(v_bad,'{}')), 'fixed', to_jsonb(coalesce(v_fixed,'{}')));
end $function$;

-- board_slim
create or replace function public.studio_board_slim(p_token text, p_client_slug text default null::text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare s public.studio_caller; v_items jsonb;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.staff_may_see_slug(s.id, p_client_slug) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', it.id,
           'stage', it.stage, 'internal_status', it.internal_status, 'status', it.status,
           'content_version', it.content_version, 'decided_at', it.decided_at,
           'posted_at', it.posted_at, 'posting_ready_at', it.posting_ready_at, 'scheduled_for', it.scheduled_for, 'scheduled_at', it.scheduled_at, 'time_locked', it.time_locked, 'position', it.position,
           'work_kind', it.work_kind, 'work_note', it.work_note, 'work_started_at', it.work_started_at,
           'work_eta_at', it.work_eta_at, 'work_by', it.work_by,
           'needs_render_at', it.needs_render_at, 'needs_render_why', it.needs_render_why,
           'regen_requested_at', it.regen_requested_at, 'regen_last_run_at', it.regen_last_run_at,
           'blocked', case when it.stage = 'internal'
                           then to_jsonb(coalesce(public.post_sells_product(it.id), '{}'::text[]))
                           else '[]'::jsonb end,
           'post', (select jsonb_build_object('id', sp.id, 'status', sp.status, 'at', sp.scheduled_at, 'error', left(sp.error, 300), 'attempts', sp.attempts, 'platform', sp.platform, 'permalink', sp.permalink)
                      from public.social_posts sp where sp.approval_item_id = it.id order by sp.created_at desc limit 1),
           'signoff', public.studio_signoff(it.id))
         order by it.created_at desc), '[]'::jsonb)
    into v_items
  from public.approval_items it
  join public.approval_clients ac on ac.id = it.client_id
 where (p_client_slug is null or ac.slug = p_client_slug)
   and public.staff_may_see(s.id, it.client_id)
   and it.status <> 'draft';

  return jsonb_build_object('ok', true, 'slim', true, 'items', v_items);
end $function$;

-- board_stamp
create or replace function public.studio_board_stamp(p_token text, p_client_slug text default null::text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare s public.studio_caller; v_stamp text; v_n int; v_working int;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select md5(coalesce(string_agg(concat_ws('|',
           it.id, it.stage, it.internal_status, it.status, it.content_version,
           it.work_kind, it.work_started_at, it.work_eta_at, it.needs_render_at,
           it.decided_at, it.posted_at, it.scheduled_for, it.posting_ready_at, it.scheduled_at, it.position, md5(coalesce(it.caption, '')),
           (select sp.status || ':' || coalesce(sp.scheduled_at::text, '') from public.social_posts sp where sp.approval_item_id = it.id order by sp.created_at desc limit 1),
           (select count(*) || ':' || md5(coalesce(string_agg(coalesce(sl.media_url, sl.copy::text), ',' order by sl.position), ''))
              from public.approval_slides sl where sl.item_id = it.id),
           (select count(*) || ':' || coalesce(max(r.created_at)::text, '') || ':' || coalesce(max(r.triage_at)::text, '')
                 || ':' || count(*) filter (where r.reply_draft is not null) || ':' || count(*) filter (where r.rule_override is not null)
              from public.approval_reviews r where r.item_id = it.id)),
         ';' order by it.id), '')),
         count(*), count(*) filter (where it.work_kind is not null)
    into v_stamp, v_n, v_working
  from public.approval_items it
  join public.approval_clients ac on ac.id = it.client_id
  where (p_client_slug is null or ac.slug = p_client_slug) and it.status <> 'draft';
  return jsonb_build_object('ok', true, 'stamp', v_stamp, 'items', v_n, 'working', v_working);
end $function$;

-- board full
create or replace function public.studio_board(p_token text, p_client_slug text default null::text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare s public.studio_caller; v_items jsonb;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.staff_may_see_slug(s.id, p_client_slug) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;

  select coalesce(jsonb_agg(row_to_json(i)::jsonb order by i.created_at desc), '[]'::jsonb)
    into v_items
  from (
    select it.id, it.title, it.caption, it.media_url, it.media_type, it.platform, it.audience,
           it.stage, it.internal_status, it.status, it.content_version,
           it.provenance, it.created_at, it.decided_at, it.scheduled_for,
           it.posted_at, it.posted_note, it.posting_ready_at, it.scheduled_at, it.time_locked, it.position,
           it.regen_requested_at, it.regen_last_run_at, it.needs_render_at, it.needs_render_why,
           it.work_kind, it.work_note, it.work_started_at, it.work_eta_at, it.work_by,
           coalesce(it.thumb_url, (select sl.media_url from public.approval_slides sl where sl.item_id = it.id and sl.media_url is not null order by sl.position limit 1)) as thumb_url,
           it.code, ac.slug as client_slug, ac.name as client_name,
           public.studio_signoff(it.id) as signoff,
           (select jsonb_build_object('id', sp.id, 'status', sp.status, 'at', sp.scheduled_at, 'error', left(sp.error, 300), 'attempts', sp.attempts, 'platform', sp.platform, 'permalink', sp.permalink)
              from public.social_posts sp where sp.approval_item_id = it.id order by sp.created_at desc limit 1) as post,
           case when it.stage = 'internal'
                then coalesce(public.post_sells_product(it.id), '{}'::text[])
                else '{}'::text[] end as blocked,
           coalesce((select jsonb_agg(case when sl.media_url is not null
                                           then to_jsonb(sl.media_url)
                                           else jsonb_build_object('copy', sl.copy) end
                                      order by sl.position)
                       from public.approval_slides sl where sl.item_id = it.id), '[]'::jsonb) as slides,
           coalesce((select jsonb_object_agg(va.platform,
                              (to_jsonb(va) - 'item_id' - 'platform')
                              || jsonb_build_object('rationale', va.hashtag_rationale))
                       from public.approval_variants va where va.item_id = it.id), '{}'::jsonb) as variants,
           coalesce((select jsonb_agg(jsonb_build_object(
                              'id', r.id, 'kind', r.reviewer_kind, 'who',
                              case when r.reviewer_kind = 'client' then ac.name
                                   when r.reviewer_kind = 'member' then coalesce(cp.name, initcap(r.person))
                                   else st.name end,
                              'person', r.person,
                              'call_status', r.call_status, 'call_note', r.call_note, 'call_at', r.call_at,
                              'system', coalesce(st.is_system, false),
                              'mine', r.staff_id is not distinct from s.id,
                              'decision', r.decision, 'note', r.note, 'at', r.created_at,
                              'content_version', r.content_version, 'parent_id', r.parent_id, 'slide', r.slide,
                              'rule_hits', r.rule_hits, 'rule_blocked', r.rule_blocked, 'rule_override', r.rule_override,
                              'triage', r.triage, 'triage_at', r.triage_at, 'reply_draft', r.reply_draft, 'to_client', r.to_client)
                              order by r.created_at desc)
                       from public.approval_reviews r
                       left join public.approval_staff st on st.id = r.staff_id
                       left join public.client_people cp on cp.client_slug = ac.slug and cp.person = r.person
                      where r.item_id = it.id), '[]'::jsonb) as reviews
      from public.approval_items it
      join public.approval_clients ac on ac.id = it.client_id
     where (p_client_slug is null or ac.slug = p_client_slug)
       and public.staff_may_see(s.id, it.client_id)
       and it.status <> 'draft'
  ) i;

  return jsonb_build_object('ok', true,
    'staff', jsonb_build_object('name', s.name, 'slug', s.slug, 'id', s.id, 'can_promote', s.can_promote),
    'items', v_items);
end $function$;

-- post RPC takes a date and a time (replaces the first overload)
drop function if exists public.studio_house_post(text, uuid, timestamp with time zone, text);
create or replace function public.studio_house_post(p_token text, p_item uuid, p_date date default null, p_time text default null, p_platform text default 'instagram')
returns jsonb language plpgsql security definer set search_path = public as $$
declare s studio_caller; it approval_items%rowtype; c approval_clients%rowtype; t jsonb; v_miss text[]; v_at timestamptz; r jsonb; v_tz text; v_now boolean;
begin
  s := studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.staff_may_see_item(s.id, p_item) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if not s.can_promote then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  -- a person presses Post. Spark, the connector and the builder never do.
  if exists (select 1 from approval_staff a where a.id = s.id and a.is_system) then
    return jsonb_build_object('ok', false, 'error', 'human_required'); end if;
  select * into it from approval_items where id = p_item;
  if it.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  select * into c from approval_clients where id = it.client_id;
  if c.kind is distinct from 'house' then return jsonb_build_object('ok', false, 'error', 'not_house'); end if;
  if it.posted_at is not null then return jsonb_build_object('ok', false, 'error', 'already_posted'); end if;
  if it.internal_status = 'killed' or coalesce(public.studio_signoff(p_item)->>'state', 'pending') is distinct from 'approved' then
    return jsonb_build_object('ok', false, 'error', 'not_approved', 'detail', 'Approve it first. Nothing posts before the team has signed off.'); end if;
  v_miss := public.post_sells_product(p_item);
  if coalesce(array_length(v_miss, 1), 0) > 0 then
    return jsonb_build_object('ok', false, 'error', 'held', 'detail', 'A house rule holds it: ' || array_to_string(v_miss, '; ')); end if;
  select x into t from jsonb_array_elements(public.house_post_targets(c.id)) x where x->>'platform' = p_platform limit 1;
  if t is null then return jsonb_build_object('ok', false, 'error', 'no_account', 'detail', 'This project has no ' || p_platform || ' account to post to.'); end if;
  if not (t->>'ready')::boolean then
    return jsonb_build_object('ok', false, 'error', 'account_not_ready', 'detail', coalesce(t->>'handle', 'The account') || ' ' || coalesce(t->>'why', 'is not ready')); end if;
  v_tz := coalesce((select sb.tz from social_brand_settings sb where sb.brand = t->>'brand'), 'America/Los_Angeles');
  if p_date is not null then
    begin v_at := (p_date + coalesce(nullif(p_time, ''), '09:15')::time) at time zone v_tz;
    exception when others then return jsonb_build_object('ok', false, 'error', 'bad_time', 'detail', 'That time did not make sense.'); end;
    if v_at < now() - interval '2 minutes' then return jsonb_build_object('ok', false, 'error', 'in_the_past', 'detail', 'That time has already passed.'); end if;
  else
    v_at := now();
  end if;
  if v_at > now() + interval '90 days' then return jsonb_build_object('ok', false, 'error', 'too_far', 'detail', 'Pick a time within the next 90 days.'); end if;
  perform set_config('studio.house_account', t->>'id', true);
  r := public.social_enqueue_item(p_item, v_at, s.name, false, p_platform);
  perform set_config('studio.house_account', '', true);
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  update approval_items set posting_ready_at = coalesce(posting_ready_at, now()), scheduled_at = v_at,
         scheduled_for = (v_at at time zone v_tz)::date, time_locked = true where id = p_item;
  insert into approval_item_events (item_id, kind, actor_kind, staff_id, payload)
  values (p_item, 'posting_ready', 'staff', s.id, jsonb_build_object('by', s.name, 'house_post', r->'post', 'handle', t->>'handle', 'at', v_at));
  v_now := v_at <= now() + interval '1 minute';
  if v_now then perform invoke_edge_function('bestly-ig-poster', jsonb_build_object('action', 'drain'), 5000); end if;
  return r || jsonb_build_object('handle', t->>'handle', 'now', v_now);
end $$;
grant execute on function public.studio_house_post(text, uuid, date, text, text) to anon, authenticated;
