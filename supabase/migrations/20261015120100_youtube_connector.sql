-- YouTube connector for Bestly Studio (2026-10-15), step 2 of 2. Mirrors Pinterest (studio/linkedin-pinterest 2026-10-14).
-- Plan: video only (image items never plan or enqueue YouTube); Shorts when vertical and 3 minutes or less (the poster decides);
-- one upload ~1,600 of 10,000 quota units a day, so the poster drains one per tick.
-- Unlike Pinterest, the live gate does NOT stop queueing: while studio_yt_live() is false the poster uploads PRIVATE
-- (Google forces unverified projects private anyway); when true it uploads public.
-- Step 1 (platform CHECKs) is 20261015120000_youtube_connector_platform_checks.sql.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Vault accessors + gates (same grants as the Pinterest ones: service role only, except *_ready)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.studio_yt_app_set(p_client_id text, p_client_secret text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'vault', 'extensions'
as $function$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','') <> 'service_role' then raise exception 'service role only'; end if;
  if length(coalesce(btrim(p_client_id),'')) < 5 or length(coalesce(btrim(p_client_secret),'')) < 16 then raise exception 'id or secret looks too short'; end if;
  perform public.studio_vault_upsert('studio_yt_client_id', btrim(p_client_id), 'Google OAuth client id (Bestly Studio YouTube connect)');
  perform public.studio_vault_upsert('studio_yt_client_secret', btrim(p_client_secret), 'Google OAuth client secret (Bestly Studio YouTube connect)');
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.studio_yt_app_get()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'vault'
as $function$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','') <> 'service_role' then raise exception 'service role only'; end if;
  return jsonb_build_object(
    'client_id', (select decrypted_secret from vault.decrypted_secrets where name = 'studio_yt_client_id'),
    'client_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'studio_yt_client_secret'));
end $function$;

create or replace function public.studio_yt_ready()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'vault'
as $function$
  select exists (select 1 from vault.secrets where name = 'studio_yt_client_id') and exists (select 1 from vault.secrets where name = 'studio_yt_client_secret');
$function$;

create or replace function public.studio_yt_live()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'vault'
as $function$
  select coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'studio_yt_live'), 'false') = 'true';
$function$;

create or replace function public.studio_yt_live_set(p_on boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'vault', 'extensions'
as $function$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','') <> 'service_role' then raise exception 'service role only'; end if;
  perform public.studio_vault_upsert('studio_yt_live', case when p_on then 'true' else 'false' end, 'YouTube posting gate: true = uploads go out public (false = private only, until the Google audit passes)');
  return jsonb_build_object('ok', true, 'live', p_on);
end $function$;

create or replace function public.studio_yt_switch_on(p_brand text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update social_brand_settings set platforms = coalesce(platforms, '{}'::jsonb) || jsonb_build_object('youtube', true) where brand = p_brand;
end $function$;

-- same ACLs as the Pinterest set: service role only; studio_yt_ready keeps the default (like studio_pin_ready)
revoke all on function public.studio_yt_app_set(text, text) from public, anon, authenticated;
revoke all on function public.studio_yt_app_get() from public, anon, authenticated;
revoke all on function public.studio_yt_live() from public, anon, authenticated;
revoke all on function public.studio_yt_live_set(boolean) from public, anon, authenticated;
revoke all on function public.studio_yt_switch_on(text) from public, anon, authenticated;
grant execute on function public.studio_yt_app_set(text, text) to service_role;
grant execute on function public.studio_yt_app_get() to service_role;
grant execute on function public.studio_yt_live() to service_role;
grant execute on function public.studio_yt_live_set(boolean) to service_role;
grant execute on function public.studio_yt_switch_on(text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Portal words (copy from the plan; typographic apostrophes like the other rows)
-- ---------------------------------------------------------------------------------------------------------------
insert into public.connect_platform_help (platform, prep, todo_title, todo_detail, todo_next, updated_at)
values ('youtube',
  $j${
    "title": "Before you tap Connect",
    "steps": [
      "You need a YouTube channel. No channel yet? Open the YouTube app, tap You, then Create a channel.",
      "Tap Connect and sign in with the Google account that owns your channel.",
      "If Google asks you to pick an account or channel, pick the one named {brand}. Then tap Continue and Allow."
    ],
    "after": "That’s it. Your approved videos will post to your YouTube channel as Shorts.",
    "trouble_title": "Having trouble?",
    "trouble": [
      {"q": "It shows the wrong Google account", "a": "Tap your picture at the top of the Google screen, then Use another account."},
      {"q": "Google says it hasn’t verified this app", "a": "That’s expected while Google reviews Bestly Studio. Tap Advanced, then Continue."},
      {"q": "It says I don’t have a channel", "a": "Make one in the YouTube app: tap You, then Create a channel. Then tap Connect again."},
      {"q": "Google says something went wrong", "a": "Close that tab, come back here, and tap Connect again. You get a fresh link each time."}
    ],
    "ask": "Ask us to do it",
    "ask_text": "Still stuck? We can do it with you.",
    "ask_note": "Please help me connect YouTube."
  }$j$::jsonb,
  'Connect your YouTube',
  'Open Settings, then Your accounts, then tap Connect YouTube. It takes about a minute.',
  'Tap Connect and follow the steps. This ticks itself off when it works.',
  now())
on conflict (platform) do update set prep = excluded.prep, todo_title = excluded.todo_title, todo_detail = excluded.todo_detail,
  todo_next = excluded.todo_next, updated_at = now();

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Shared functions: the live body plus youtube branches beside the pinterest ones
-- ---------------------------------------------------------------------------------------------------------------

-- 3a. calendar_post_platforms: YouTube is planned for video items only; no live gate (the poster uploads private until live)
create or replace function public.calendar_post_platforms(p_item uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with it as (select id, client_id, platform, media_type from public.approval_items where id = p_item),
  posted as (select distinct sp.platform from public.social_posts sp where sp.approval_item_id = p_item and sp.status = 'posted'),
  wanted as (
    select distinct w.platform from (
      select case when v.platform = 'youtube_shorts' then 'youtube' else v.platform end as platform from public.approval_variants v where v.item_id = p_item
      union select it.platform from it where it.platform is not null
        and not exists (select 1 from public.approval_variants v where v.item_id = p_item)) w, it
     where w.platform <> 'youtube' or it.media_type = 'video'),
  live as (select distinct a.platform from public.social_accounts a, it
            where a.client_id = it.client_id and a.active and not coalesce(a.publishing_paused, false)
              and (a.platform <> 'linkedin' or public.studio_li_live())
              and (a.platform <> 'pinterest' or public.studio_pin_live())),
  held as (select distinct a.platform from public.social_accounts a, it
            where a.client_id = it.client_id and a.active and not coalesce(a.publishing_paused, false)
              and ((a.platform = 'linkedin' and not public.studio_li_live()) or (a.platform = 'pinterest' and not public.studio_pin_live()))),
  hz as (select coalesce(bool_or(c.kind = 'house' and coalesce(c.calendar_autopost, false)), false) as is_house
           from public.approval_clients c join it on c.id = it.client_id)
  select jsonb_build_object(
    'posted',  coalesce((select jsonb_agg(platform) from posted), '[]'::jsonb),
    'planned', case when (select is_house from hz)
                    then coalesce((select jsonb_agg(p) from unnest(public.house_item_platforms(p_item)) p where p not in (select platform from posted)), '[]'::jsonb)
                    else coalesce((select jsonb_agg(w.platform) from wanted w where w.platform in (select platform from live)
                           and w.platform not in (select platform from posted)), '[]'::jsonb) end,
    'not_connected', case when (select is_house from hz) then '[]'::jsonb
                    else coalesce((select jsonb_agg(w.platform) from wanted w where w.platform not in (select platform from live)
                           and w.platform not in (select platform from held)
                           and w.platform not in (select platform from posted)), '[]'::jsonb) end);
$function$;

-- 3b. item_platforms: YouTube only for video items
create or replace function public.item_platforms(p_item uuid)
 returns text[]
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare it approval_items%rowtype; c approval_clients%rowtype; st social_brand_settings%rowtype; out text[] := '{}'; p text;
begin
  select * into it from approval_items where id = p_item;
  if it.id is null then return '{}'; end if;
  if it.platforms is not null then return it.platforms; end if;
  select * into c from approval_clients where id = it.client_id;
  if c.social_brand is null then return '{}'; end if;
  select * into st from social_brand_settings where brand = c.social_brand;
  foreach p in array array['instagram','facebook','tiktok','linkedin','pinterest','youtube'] loop
    if coalesce((st.platforms->>p)::boolean, p = 'instagram')
       and exists (select 1 from social_accounts a where a.brand = c.social_brand and a.platform = p and a.active and a.access_token is not null)
       and (p <> 'tiktok' or it.media_type = 'video')
       and (p <> 'youtube' or it.media_type = 'video')
       and (p <> 'linkedin' or public.studio_li_live())
       and (p <> 'pinterest' or public.studio_pin_live()) then
      out := out || p;
    end if;
  end loop;
  return out;
end $function$;

-- 3c. house_item_platforms: same video-only rule for house accounts
create or replace function public.house_item_platforms(p_item uuid)
 returns text[]
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare it approval_items%rowtype; v_brand text; st social_brand_settings%rowtype; out text[] := '{}'; t jsonb;
begin
  select * into it from approval_items where id = p_item;
  if it.id is null then return '{}'; end if;
  v_brand := public.studio_brand_of(it.client_id);
  select * into st from social_brand_settings where brand = v_brand;
  for t in select x from jsonb_array_elements(public.house_post_targets(it.client_id)) x loop
    if (t->>'ready')::boolean and coalesce((st.platforms->>(t->>'platform'))::boolean, (t->>'platform') = 'instagram')
       and (it.platforms is null or (t->>'platform') = any(it.platforms))
       and ((t->>'platform') <> 'tiktok' or it.media_type = 'video')
       and ((t->>'platform') <> 'youtube' or it.media_type = 'video')
       and ((t->>'platform') <> 'linkedin' or public.studio_li_live())
       and ((t->>'platform') <> 'pinterest' or public.studio_pin_live()) then
      out := out || (t->>'platform');
    end if;
  end loop;
  return out;
end $function$;

-- 3d. studio_item_platforms: staff may pick youtube for an item
create or replace function public.studio_item_platforms(p_token text, p_item uuid, p_platforms text[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s studio_caller;
begin
  s := studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.staff_may_see_item(s.id, p_item) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if not s.can_promote then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if p_platforms is not null and exists (select 1 from unnest(p_platforms) x where x not in ('instagram','facebook','tiktok','linkedin','pinterest','youtube')) then
    return jsonb_build_object('ok', false, 'error', 'bad_platform'); end if;
  update approval_items set platforms = p_platforms where id = p_item;
  return jsonb_build_object('ok', true, 'platforms', to_jsonb(public.item_platforms(p_item)));
end $function$;

-- 3e. connect links: youtube mints like linkedin / pinterest once the platform is available for the client
create or replace function public.studio_social_connect_link(p_token text, p_slug text, p_platform text DEFAULT 'instagram'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s studio_caller; v_id uuid;
begin
  s := studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.staff_may_see_slug(s.id, p_slug) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if not s.can_promote then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  select id into v_id from approval_clients where slug = p_slug and active;
  if v_id is null then return jsonb_build_object('ok', false, 'error', 'no_client'); end if;
  if not (p_platform = 'instagram' or (p_platform = 'tiktok' and public.studio_tiktok_ready()) or (p_platform = 'facebook' and public.studio_fb_ready())
          or (p_platform in ('linkedin', 'pinterest', 'youtube') and public.connect_platform_available(v_id, p_platform))) then return jsonb_build_object('ok', false, 'error', 'platform_not_ready'); end if;
  return jsonb_build_object('ok', true, 'url', social_connect_mint(v_id, s.name, p_platform), 'expires_in_days', 14);
end $function$;

create or replace function public.client_social_connect_link(p_token text, p_platform text DEFAULT 'instagram'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c approval_caller;
begin
  c := approval_resolve_client(p_token);
  if public.client_viewer(p_token) is not null then return jsonb_build_object('ok', false, 'error', 'view_only', 'message', 'You are viewing as the client. Nothing here is saved as them.'); end if;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not (p_platform = 'instagram' or (p_platform = 'tiktok' and public.studio_tiktok_ready()) or (p_platform = 'facebook' and public.studio_fb_ready() and exists (select 1 from approval_clients ac join social_brand_settings s on s.brand = ac.social_brand where ac.id = c.id and coalesce((s.platforms->>'facebook_offered')::boolean, false)))
          or (p_platform in ('linkedin', 'pinterest', 'youtube') and public.connect_platform_available(c.id, p_platform))) then return jsonb_build_object('ok', false, 'error', 'platform_not_ready'); end if;
  return jsonb_build_object('ok', true, 'url', social_connect_mint(c.id, 'client', p_platform));
end $function$;

-- 3f. client_posting_state: youtube is available once Google creds are saved AND the brand is offered it.
--     The access token lasts ~1 hour and is refreshed before each upload, so expiry never shows or nags for youtube;
--     only an inactive account (Google refused the saved login) needs attention.
create or replace function public.client_posting_state(p_client uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare c approval_clients%rowtype; st social_brand_settings%rowtype; v_pl text[] := array['instagram','facebook','tiktok','linkedin','pinterest','youtube']; p text; v_out jsonb := '[]'::jsonb; a social_accounts%rowtype; v_tt boolean; v_fb boolean; v_li boolean; v_pin boolean; v_yt boolean; v_b text; v_house boolean;
begin
  select * into c from approval_clients where id = p_client;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'no_client'); end if;
  v_house := (c.kind = 'house' and coalesce(c.calendar_autopost, false));
  v_b := case when v_house then public.studio_brand_of(c.id) else c.social_brand end;
  if v_b is not null then select * into st from social_brand_settings where brand = v_b; end if;
  v_tt := public.studio_tiktok_ready();
  v_fb := public.studio_fb_ready();
  v_li := public.studio_li_ready();
  v_pin := public.studio_pin_ready();
  v_yt := public.studio_yt_ready();
  foreach p in array v_pl loop
    a := null;
    if v_b is not null then select * into a from social_accounts where brand = v_b and platform = p; end if;
    v_out := v_out || jsonb_build_object(
      'platform', p,
      'available', p = 'instagram' or (p = 'tiktok' and v_tt) or (p = 'facebook' and v_fb and coalesce((st.platforms->>'facebook_offered')::boolean, false))
                   or (p = 'linkedin' and v_li and coalesce((st.platforms->>'linkedin_offered')::boolean, false))
                   or (p = 'pinterest' and v_pin and coalesce((st.platforms->>'pinterest_offered')::boolean, false))
                   or (p = 'youtube' and v_yt and coalesce((st.platforms->>'youtube_offered')::boolean, false)),
      'mode', case when p = 'tiktok' then 'inbox' else 'direct' end,
      'enabled', coalesce((st.platforms->>p)::boolean, p = 'instagram'),
      'connected', a.id is not null and a.access_token is not null and a.remote_user_id is not null,
      'active', coalesce(a.active, false),
      'handle', a.handle,
      'connected_at', a.updated_at,
      'expires_at', case when p = 'tiktok' then a.refresh_expires_at when p in ('linkedin','pinterest') then coalesce(a.refresh_expires_at, a.token_expires_at) when p = 'youtube' then null else a.token_expires_at end,
      'needs_attention', a.id is not null and a.access_token is not null and (not coalesce(a.active, false)
         or (p not in ('tiktok','linkedin','pinterest','youtube') and a.token_expires_at is not null and a.token_expires_at < now() + interval '3 days')
         or (p in ('linkedin','pinterest') and coalesce(a.refresh_expires_at, a.token_expires_at) is not null and coalesce(a.refresh_expires_at, a.token_expires_at) < now() + interval '14 days')
         or (p = 'tiktok' and a.refresh_expires_at is not null and a.refresh_expires_at < now() + interval '7 days')),
      'paused', coalesce(a.publishing_paused, false),
      'queued', (select count(*) from social_posts q where q.brand = v_b and q.platform = p and q.status in ('queued','held')),
      'in_drafts', (select count(*) from social_posts q where q.brand = v_b and q.platform = p and q.status = 'in_drafts'),
      'posted', (select count(*) from social_posts q where q.brand = v_b and q.platform = p and q.status = 'posted'),
      'connect', public.client_connect_tile(p_client, p));
  end loop;
  return jsonb_build_object('ok', true,
    'publish_mode', coalesce(c.publish_mode, 'push'), 'auto', (c.publish_mode = 'auto') or v_house, 'brand', v_b,
    'posts_per_week', case when v_house then public.studio_week_cap(c.id) else coalesce(st.posts_per_week, 3) end,
    'window_start', coalesce(st.window_start, '08:00'::time), 'window_end', coalesce(st.window_end, '20:00'::time),
    'tz', coalesce(st.tz, 'America/Los_Angeles'), 'days', to_jsonb(st.days), 'accounts', v_out);
end $function$;

-- 3g. client_connect_tile: name + the three steps Google shows her
create or replace function public.client_connect_tile(p_client uuid, p text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  c approval_clients%rowtype; a social_accounts%rowtype; l social_connect_links%rowtype; s client_connect_steps%rowtype;
  v_name text; v_conn boolean; v_until text; v_handle text; v_help jsonb; v_prep jsonb; v_extra jsonb := '{}'::jsonb; v_bn text;
begin
  select * into c from approval_clients where id = p_client;
  v_name := case p when 'instagram' then 'Instagram' when 'facebook' then 'Facebook Page' when 'tiktok' then 'TikTok' when 'linkedin' then 'LinkedIn' when 'pinterest' then 'Pinterest' when 'youtube' then 'YouTube' else p end;
  if c.id is null then return jsonb_build_object('platform', p, 'name', v_name, 'state', 'not_started'); end if;
  -- connect_platform_help: the "Before you tap Connect" words + "Having trouble?" fixes (2026-10-14). Keep this block when editing.
  select prep into v_help from connect_platform_help where platform = p;
  if v_help is not null then
    v_bn := to_json(coalesce(nullif(c.name, ''), 'your business'))::text;
    v_prep := replace(v_help::text, '{brand}', substr(v_bn, 2, length(v_bn) - 2))::jsonb;
    v_extra := jsonb_build_object('prep', v_prep);
  end if;
  if c.social_brand is not null then select * into a from social_accounts where brand = c.social_brand and platform = p; end if;
  select * into s from client_connect_steps where client_id = p_client and platform = p;
  select * into l from social_connect_links
   where client_id = p_client and used_at is null and expires_at > now() and short_code is not null
     and split_part(created_by, ' · ', 2) = p
   order by created_at desc limit 1;
  v_conn := a.id is not null and coalesce(a.active, false) and a.access_token is not null;
  v_handle := a.handle;
  if v_conn then
    return jsonb_build_object('platform', p, 'name', v_name, 'state', 'connected', 'handle', a.handle,
      'connected_at', a.updated_at, 'headline', 'Connected', 'text', coalesce(a.handle, v_name) || ' is connected.');
  end if;
  if s.client_id is not null and s.state in ('waiting_her','her_done') then
    if s.state = 'her_done' then
      return jsonb_build_object('platform', p, 'name', v_name, 'state', 'waiting', 'stage', 'jared',
        'headline', coalesce(s.info->>'jared_title', 'Jared finishes the connection'),
        'text', coalesce(s.info->>'jared_text', 'Thank you. Your part is done. Jared finishes the connection on our side, and this turns green when it is done.'),
        'steps', '[]'::jsonb, 'action', null);
    end if;
    return jsonb_build_object('platform', p, 'name', v_name, 'state', 'waiting', 'stage', 'her',
      'headline', coalesce(s.info->>'title', 'Finish connecting ' || v_name),
      'text', s.info->>'text',
      'steps', coalesce(s.info->'steps', '[]'::jsonb),
      'action', jsonb_build_object('kind', 'ack', 'label', coalesce(s.info->>'ack_label', 'I did it')));
  end if;
  if l.id is not null then
    v_until := to_char(l.expires_at at time zone 'America/Los_Angeles', 'FMMon FMDD');
    return jsonb_build_object('platform', p, 'name', v_name, 'state', 'waiting', 'stage', 'her',
      'headline', 'Connect ' || v_name,
      'text', 'This link works until ' || v_until || '.',
      'steps', case when p = 'tiktok' then
          jsonb_build_array('Tap the button below.', case when v_handle is not null then 'Log in as ' || v_handle || '.' else 'Log in to your TikTok account.' end, 'Tap Agree.')
        when p = 'linkedin' then
          jsonb_build_array('Tap the button below.', 'Log in to LinkedIn with the account that runs your Page.', 'Tap Allow.', 'If LinkedIn asks which Page, pick yours.')
        when p = 'pinterest' then
          jsonb_build_array('Tap the button below.', 'Log in to your Pinterest business account.', 'Tap Give access.', 'Pick the board for your pins, or let Bestly Studio make a new one for you.')
        when p = 'youtube' then
          jsonb_build_array('Tap the button below.', 'Sign in with the Google account that owns your YouTube channel.', 'If Google asks, pick your channel.', 'Tap Continue, then Allow.')
        else jsonb_build_array('Tap the button below.', 'Log in to ' || v_name || ' and approve.', 'That is it. This page updates by itself.') end,
      'action', jsonb_build_object('kind', 'link', 'label', 'Connect ' || v_name, 'url', 'https://www.bestly.tech/c/' || l.short_code, 'expires_at', l.expires_at))
      || v_extra;
  end if;
  if a.id is not null and a.access_token is not null then
    return jsonb_build_object('platform', p, 'name', v_name, 'state', 'reconnect', 'handle', a.handle,
      'headline', v_name || ' signed you out', 'text', 'Reconnect it to keep posting.') || v_extra;
  end if;
  return jsonb_build_object('platform', p, 'name', v_name, 'state', 'not_started') || v_extra;
end $function$;

-- 3h. social_enqueue_item (5-arg): youtube is video only; her 'youtube' (or youtube_shorts) version first, then Instagram's, then the item caption.
create or replace function public.social_enqueue_item(p_item uuid, p_at timestamp with time zone, p_actor text, p_force boolean DEFAULT false, p_platform text DEFAULT 'instagram'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  it approval_items%rowtype; c approval_clients%rowtype; a social_accounts%rowtype;
  v_urls text[]; v_cap text; v_tags text[]; v_id uuid; v_n int; v_type text; v_cover text;
  v_acct uuid := nullif(current_setting('studio.house_account', true), '')::uuid;
  v_house boolean := false; v_brand text;
  v_vtitle text; v_vlink text; v_valt text; v_title text; v_link text; v_alt text; v_cap_max int;
begin
  select * into it from approval_items where id = p_item;
  if it.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  select * into c from approval_clients where id = it.client_id;
  if p_platform not in ('instagram','tiktok','facebook','linkedin','pinterest','youtube') then return jsonb_build_object('ok', false, 'error', 'platform_not_ready', 'detail', p_platform || ' posting comes in the next phase.'); end if;
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
  -- connected is not the same as switched on: LinkedIn / Pinterest only post once their live gate is thrown
  -- (YouTube is different: it queues now and the poster uploads private until studio_yt_live() is true)
  if p_platform = 'linkedin' and not public.studio_li_live() then
    return jsonb_build_object('ok', false, 'error', 'linkedin_not_live', 'detail', 'LinkedIn is connected, but posting to it is not switched on yet.'); end if;
  if p_platform = 'pinterest' and not public.studio_pin_live() then
    return jsonb_build_object('ok', false, 'error', 'pinterest_not_live', 'detail', 'Pinterest is connected, but posting to it is not switched on yet.'); end if;
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
    if p_platform = 'youtube' then return jsonb_build_object('ok', false, 'error', 'youtube_video_only', 'detail', 'YouTube takes video only.'); end if;
    select array_agg(media_url order by position) into v_urls from approval_slides where item_id = p_item and media_url is not null;
    if v_urls is null then v_urls := array[it.media_url]; end if;
    v_n := coalesce(array_length(v_urls,1),0);
    if v_n = 0 or v_urls[1] is null then return jsonb_build_object('ok', false, 'error', 'no_media'); end if;
    if v_n > 10 then return jsonb_build_object('ok', false, 'error', 'too_many_slides', 'detail', format('A carousel takes at most 10 slides; this has %s.', v_n)); end if;
    v_type := case when v_n > 1 then 'carousel' else 'image' end;
  end if;
  -- her own version for the platform first (the Facebook version is written for Facebook), then Instagram's, then the item caption
  -- (YouTube versions are stored as 'youtube_shorts' in approval_variants; a 'youtube' one wins if it ever exists)
  select v.caption, v.hashtags, v.title, v.link, v.alt_text into v_cap, v_tags, v_vtitle, v_vlink, v_valt
    from approval_variants v where v.item_id = p_item and (v.platform = p_platform or (p_platform = 'youtube' and v.platform = 'youtube_shorts'))
    order by (v.platform = p_platform) desc, v.created_at desc limit 1;
  if v_cap is null and p_platform in ('tiktok','facebook','linkedin','pinterest','youtube') then
    select v.caption, v.hashtags, coalesce(v_valt, v.alt_text) into v_cap, v_tags, v_valt
      from approval_variants v where v.item_id = p_item and v.platform = 'instagram' order by v.created_at desc limit 1;
  end if;
  v_cap := coalesce(v_cap, it.caption, '');
  if v_tags is not null and array_length(v_tags,1) > 0 then v_cap := v_cap || E'\n\n' || array_to_string(v_tags, ' '); end if;
  v_cap_max := case p_platform when 'facebook' then 8000 when 'linkedin' then 3000 when 'pinterest' then 500 when 'youtube' then 5000 else 2200 end;
  if p_platform = 'pinterest' then
    v_title := left(coalesce(nullif(btrim(v_vtitle), ''), nullif(btrim(it.title), ''), nullif(btrim(split_part(v_cap, E'\n', 1)), ''), 'Centering YOU'), 100);
    v_link := coalesce(nullif(btrim(v_vlink), ''), public.studio_client_site(it.client_id));
    v_alt := left(nullif(btrim(v_valt), ''), 500);
  elsif p_platform = 'linkedin' then
    v_link := nullif(btrim(v_vlink), '');   -- the poster puts the first link in a comment, never in the post body
    v_alt := left(nullif(btrim(v_valt), ''), 1000);
  elsif p_platform = 'youtube' then
    -- title: max 100 chars, no < or >, cut on a word boundary, never "..."
    v_title := btrim(regexp_replace(regexp_replace(coalesce(nullif(btrim(v_vtitle), ''), nullif(btrim(it.title), ''), nullif(btrim(split_part(v_cap, E'\n', 1)), ''), nullif(btrim(c.name), ''), 'Video'), '[<>]', ' ', 'g'), '\s+', ' ', 'g'));
    if length(v_title) > 100 then
      v_title := coalesce(nullif(btrim(regexp_replace(left(v_title, 101), '\s+\S*$', '')), ''), left(v_title, 100));
    end if;
    v_title := left(v_title, 100);
    v_link := coalesce(nullif(btrim(v_vlink), ''), public.studio_client_site(it.client_id));
  end if;
  insert into social_posts (brand, platform, media_url, media_urls, media_type, cover_url, caption, scheduled_at, approval_item_id, content_version, title, link_url, alt_text)
  values (v_brand, p_platform, v_urls[1], case when v_n > 1 then v_urls end, v_type, v_cover, left(v_cap, v_cap_max), coalesce(p_at, now()), p_item, it.content_version, v_title, v_link, v_alt)
  returning id into v_id;
  insert into approval_item_events (item_id, kind, actor_kind, payload)
  values (p_item, 'scheduled', case when p_actor = 'client' then 'client' else 'system' end,
          jsonb_build_object('social_post', v_id, 'platform', p_platform, 'at', coalesce(p_at, now()), 'by', p_actor, 'forced', p_force, 'house', v_house));
  return jsonb_build_object('ok', true, 'post', v_id, 'platform', p_platform, 'scheduled_at', coalesce(p_at, now()), 'slides', v_n, 'media_type', v_type, 'handle', a.handle);
end $function$;

-- 3i. studio_autopost_tick: plan youtube beside pinterest (video items only), kick bestly-yt-poster with the other drains
create or replace function public.studio_autopost_tick()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c record; it record; p text; r jsonb; v_tz text; v_b text; v_kick boolean := false; v_brand text; v_house boolean; v_tid text; v_plats text[];
        v_done jsonb := '[]'::jsonb; v_bad jsonb := '[]'::jsonb; v_slots jsonb := '[]'::jsonb; g jsonb;
begin
  perform public.studio_cal_revoke_stale();
  perform public.studio_cal_clear_past();
  perform public.studio_cal_clear_uncleared();
  perform public.studio_cal_enforce_cap();
  for c in select ac.* from approval_clients ac where ac.calendar_autopost and ac.social_brand is not null order by ac.name loop
    v_house := (c.kind = 'house');
    v_brand := case when v_house then public.studio_brand_of(c.id) else c.social_brand end;
    if coalesce((public.posting_paused(v_brand)->>'paused')::boolean, false) then continue; end if;
    select coalesce(s.tz, 'America/Los_Angeles') into v_tz from social_brand_settings s where s.brand = v_brand;
    v_tz := coalesce(v_tz, 'America/Los_Angeles');
    update approval_items set scheduled_at = null, scheduled_for = null, slot_reason = null
     where client_id = c.id and posted_at is null and not time_locked and not cal_hold
       and scheduled_at < now() - interval '2 hours'
       and not exists (select 1 from social_posts sp where sp.approval_item_id = approval_items.id and sp.status in ('queued','posting','posted','held','in_drafts'));
    r := public.studio_autoslot(c.id);
    v_slots := v_slots || coalesce(r->'slots', '[]'::jsonb);
    for it in
      select i.* from approval_items i
       where i.client_id = c.id and i.posted_at is null and not i.cal_hold
         and i.scheduled_at is not null and i.scheduled_at <= now() + interval '10 minutes'
         and not exists (select 1 from social_posts sp where sp.approval_item_id = i.id and sp.status in ('queued','posting','posted','held','in_drafts'))
    loop
      v_b := public.studio_cal_blocked(c.slug, (it.scheduled_at at time zone v_tz)::date);
      if v_b is not null and not it.time_locked then
        update approval_items set scheduled_at = null, scheduled_for = null, slot_reason = null where id = it.id;
        continue;
      end if;
      if not public.studio_cal_ready(it.id) then
        g := public.studio_posting_gate(it.id);
        update approval_items set scheduled_at = null, scheduled_for = null, posting_ready_at = null,
               slot_reason = 'Taken off the calendar: ' || coalesce(g->>'error', 'not cleared to post')
         where id = it.id;
        v_bad := v_bad || jsonb_build_object('code', it.code, 'title', it.title, 'why', coalesce(g->>'error', 'not cleared'));
        continue;
      end if;
      v_plats := case when v_house then public.house_item_platforms(it.id) else public.item_platforms(it.id) end;
      foreach p in array v_plats loop
        if p not in ('instagram', 'tiktok', 'facebook', 'linkedin', 'pinterest', 'youtube') then continue; end if;
        -- LinkedIn / Pinterest: silent skip until the brand has an active account AND the platform's live gate is thrown
        if p = 'linkedin' and not public.studio_li_live() then continue; end if;
        if p = 'pinterest' and not public.studio_pin_live() then continue; end if;
        -- YouTube: video only, never an image item (and no live gate: the poster uploads private until studio_yt_live())
        if p = 'youtube' and it.media_type is distinct from 'video' then continue; end if;
        if v_house then
          select x->>'id' into v_tid from jsonb_array_elements(public.house_post_targets(c.id)) x
           where x->>'platform' = p and (x->>'ready')::boolean limit 1;
          if v_tid is null then continue; end if;
          perform set_config('studio.house_account', v_tid, true);
        elsif p in ('facebook', 'linkedin', 'pinterest', 'youtube') and not exists (select 1 from social_accounts fa where fa.brand = c.social_brand and fa.platform = p and fa.active and fa.access_token is not null and not coalesce(fa.publishing_paused, false)) then
          continue;
        end if;
        r := public.social_enqueue_item(it.id, greatest(it.scheduled_at, now()), 'Spark', false, p);
        if v_house then perform set_config('studio.house_account', '', true); end if;
        if coalesce((r->>'ok')::boolean, false) then
          v_done := v_done || jsonb_build_object('code', it.code, 'platform', p, 'at', it.scheduled_at);
          if it.scheduled_at <= now() + interval '1 minute' then v_kick := true; end if;
        elsif coalesce(r->>'error', '') <> 'already_queued' then
          v_bad := v_bad || jsonb_build_object('code', it.code, 'platform', p, 'why', r->>'error');
        end if;
      end loop;
    end loop;
  end loop;
  if v_kick then
    begin perform invoke_edge_function('bestly-ig-poster', jsonb_build_object('action','drain'), 5000); exception when others then null; end;
    begin perform invoke_edge_function('tiktok-inbox', jsonb_build_object('action','drain'), 5000); exception when others then null; end;
    begin perform invoke_edge_function('bestly-fb-poster', jsonb_build_object('action','drain'), 5000); exception when others then null; end;
    begin perform invoke_edge_function('bestly-li-poster', jsonb_build_object('action','drain'), 5000); exception when others then null; end;
    begin perform invoke_edge_function('bestly-pin-poster', jsonb_build_object('action','drain'), 5000); exception when others then null; end;
    begin perform invoke_edge_function('bestly-yt-poster', jsonb_build_object('action','drain'), 5000); exception when others then null; end;
  end if;
  if jsonb_array_length(v_bad) > 0 then
    perform public.bestly_raise('studio:autopost', 'problem', 'warn',
      jsonb_array_length(v_bad) || ' post(s) could not go out on schedule',
      (select string_agg(coalesce(x->>'code','?') || ' ' || coalesce(x->>'title','') || ': ' || coalesce(x->>'why',''), E'\n') from jsonb_array_elements(v_bad) x), 'ops');
  end if;
  return jsonb_build_object('ok', true, 'slotted', v_slots, 'queued', v_done, 'problems', v_bad);
end $function$;

-- 3j. studio_post_now: kick bestly-yt-poster like the others (youtube only queues for video items; images get youtube_video_only)
create or replace function public.studio_post_now(p_token text, p_item uuid, p_platforms text[] DEFAULT NULL::text[], p_when timestamp with time zone DEFAULT NULL::timestamp with time zone)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s studio_caller; it approval_items%rowtype; p text; r jsonb; out jsonb := '[]'::jsonb; v_at timestamptz; v_kick boolean := false;
begin
  s := studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.staff_may_see_item(s.id, p_item) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if not s.can_promote then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if exists (select 1 from approval_staff a where a.id = s.id and a.is_system) then return jsonb_build_object('ok', false, 'error', 'human_required'); end if;
  select * into it from approval_items where id = p_item;
  if it.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  v_at := coalesce(p_when, now());
  if it.posted_at is null and public.studio_cal_week_full(p_item, (v_at at time zone 'America/Los_Angeles')::date) is not null then
    return public.studio_cal_week_full(p_item, (v_at at time zone 'America/Los_Angeles')::date);
  end if;
  foreach p in array coalesce(p_platforms, public.item_platforms(p_item)) loop
    -- LinkedIn / Pinterest wait for their live gate: silent skip, nothing is queued
    if (p = 'linkedin' and not public.studio_li_live()) or (p = 'pinterest' and not public.studio_pin_live()) then continue; end if;
    r := social_enqueue_item(p_item, v_at, s.name, false, p);
    out := out || (jsonb_build_object('platform', p) || r);
    if (r->>'ok')::boolean and v_at <= now() + interval '1 minute' then v_kick := true; end if;
  end loop;
  if v_kick then
    begin perform invoke_edge_function('bestly-ig-poster', jsonb_build_object('action','drain'), 5000); exception when others then null; end;
    begin perform invoke_edge_function('tiktok-inbox', jsonb_build_object('action','drain'), 5000); exception when others then null; end;
    begin perform invoke_edge_function('bestly-fb-poster', jsonb_build_object('action','drain'), 5000); exception when others then null; end;
    begin perform invoke_edge_function('bestly-li-poster', jsonb_build_object('action','drain'), 5000); exception when others then null; end;
    begin perform invoke_edge_function('bestly-pin-poster', jsonb_build_object('action','drain'), 5000); exception when others then null; end;
    begin perform invoke_edge_function('bestly-yt-poster', jsonb_build_object('action','drain'), 5000); exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'results', out, 'social', public.item_social_rows(p_item));
end $function$;

-- 3k. social_engine_watch: YouTube rides the LinkedIn / Pinterest loop. Differences, all because Google access tokens last ~1 hour
--     and are refreshed by the poster before every upload: no "refresh kicked ahead of expiry", and the blanket
--     "expired token -> mark inactive" sweep skips youtube. A post held back by Google's daily quota (error mentions quota)
--     is waiting for tomorrow on purpose, so it is not reported as stuck.
create or replace function public.social_engine_watch()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_bad text[] := '{}'; v_fixed text[] := '{}'; n int; v_last timestamptz; r record; pl text; fn text; nm text;
begin
  update social_posts set status = 'queued', claimed_at = null where status = 'posting' and claimed_at < now() - interval '20 minutes';
  get diagnostics n = row_count; if n > 0 then v_fixed := v_fixed || (n || ' post(s) stuck in posting reset to queued'); end if;
  select count(*) into n from social_posts where status = 'queued' and scheduled_at < now() - interval '30 minutes' and platform = 'instagram';
  if n > 0 then perform invoke_edge_function('bestly-ig-poster', jsonb_build_object('action','drain'), 5000); v_bad := v_bad || (n || ' Instagram post(s) more than 30 minutes past their slot — drain kicked'); end if;
  select count(*) into n from social_posts where status = 'queued' and scheduled_at < now() - interval '30 minutes' and platform = 'tiktok';
  if n > 0 then perform invoke_edge_function('tiktok-inbox', jsonb_build_object('action','drain'), 5000); v_bad := v_bad || (n || ' TikTok post(s) more than 30 minutes past their slot — drain kicked'); end if;
  for r in select j.jobname, max(d.end_time) last from cron.job j left join cron.job_run_details d on d.jobid = j.jobid and d.status = 'succeeded'
            where j.jobname in ('social-drain-instagram','social-drain-tiktok','social-drain-facebook','social-drain-linkedin','social-drain-pinterest','social-drain-youtube') group by j.jobname loop
    -- a brand-new LinkedIn/Pinterest/YouTube job has no run yet: do not call that a stall, only a stale last run
    if (r.last is null and r.jobname not in ('social-drain-linkedin','social-drain-pinterest','social-drain-youtube')) or r.last < now() - interval '10 minutes' then
      perform invoke_edge_function(case r.jobname when 'social-drain-instagram' then 'bestly-ig-poster' when 'social-drain-facebook' then 'bestly-fb-poster' when 'social-drain-linkedin' then 'bestly-li-poster' when 'social-drain-pinterest' then 'bestly-pin-poster' when 'social-drain-youtube' then 'bestly-yt-poster' else 'tiktok-inbox' end, jsonb_build_object('action','drain'), 5000);
      v_bad := v_bad || (r.jobname || ' has not run in the last 10 minutes — drain kicked by hand');
    end if;
  end loop;
  select count(*) into n from social_accounts where active and access_token is not null and platform = 'instagram' and token_expires_at is not null and token_expires_at < now() + interval '7 days';
  if n > 0 then perform invoke_edge_function('bestly-ig-poster', jsonb_build_object('action','refresh'), 5000); v_fixed := v_fixed || (n || ' Instagram token(s) inside 7 days — refresh kicked'); end if;
  select count(*) into n from social_accounts where active and access_token is not null and platform = 'tiktok' and token_expires_at is not null and token_expires_at < now() + interval '2 hours';
  if n > 0 then perform invoke_edge_function('tiktok-inbox', jsonb_build_object('action','refresh'), 5000); v_fixed := v_fixed || (n || ' TikTok token(s) inside 2 hours — refresh kicked'); end if;
  select count(*) into n from social_accounts where active and access_token is not null and platform = 'tiktok' and refresh_expires_at is not null and refresh_expires_at < now() + interval '7 days';
  if n > 0 then v_bad := v_bad || (n || ' TikTok account(s) need a reconnect within 7 days (refresh token expiring)'); end if;
  select count(*) into n from social_posts where status = 'queued' and scheduled_at < now() - interval '30 minutes' and platform = 'facebook';
  if n > 0 then perform invoke_edge_function('bestly-fb-poster', jsonb_build_object('action','drain'), 5000); v_bad := v_bad || (n || ' Facebook post(s) more than 30 minutes past their slot — drain kicked'); end if;
  -- auto-retry once: a Facebook post that failed gets exactly one more round of attempts before a person hears about it
  update social_posts set status = 'queued', max_attempts = max_attempts + 1, error = 'auto-retried once: ' || coalesce(error, '')
   where platform = 'facebook' and status = 'failed' and updated_at > now() - interval '24 hours' and max_attempts <= 3
     and exists (select 1 from social_accounts fa where fa.brand = social_posts.brand and fa.platform = 'facebook' and fa.active);
  get diagnostics n = row_count;
  if n > 0 then perform invoke_edge_function('bestly-fb-poster', jsonb_build_object('action','drain'), 5000); v_fixed := v_fixed || (n || ' failed Facebook post(s) re-queued for one more try'); end if;
  select count(*) into n from social_accounts where platform = 'facebook' and not active and access_token is not null;
  if n > 0 then v_bad := v_bad || (n || ' Facebook Page(s) need a reconnect — queued Facebook posts are held'); end if;
  select count(*) into n from social_posts where platform = 'facebook' and status = 'failed' and max_attempts > 3 and updated_at > now() - interval '24 hours';
  if n > 0 then v_bad := v_bad || (n || ' Facebook post(s) failed even after the automatic retry'); end if;

  -- LinkedIn + Pinterest (2026-10-14) + YouTube (2026-10-15): same shape as Facebook, plus token refresh ahead of expiry (not for YouTube)
  foreach pl in array array['linkedin','pinterest','youtube'] loop
    fn := case pl when 'linkedin' then 'bestly-li-poster' when 'youtube' then 'bestly-yt-poster' else 'bestly-pin-poster' end;
    nm := case pl when 'linkedin' then 'LinkedIn' when 'youtube' then 'YouTube' else 'Pinterest' end;
    select count(*) into n from social_posts where status = 'queued' and scheduled_at < now() - interval '30 minutes' and platform = pl
       and (pl <> 'youtube' or coalesce(error, '') not ilike '%quota%');
    if n > 0 then perform invoke_edge_function(fn, jsonb_build_object('action','drain'), 5000); v_bad := v_bad || (n || ' ' || nm || ' post(s) more than 30 minutes past their slot — drain kicked'); end if;
    update social_posts set status = 'queued', max_attempts = max_attempts + 1, error = 'auto-retried once: ' || coalesce(error, '')
     where platform = pl and status = 'failed' and updated_at > now() - interval '24 hours' and max_attempts <= 3
       and exists (select 1 from social_accounts fa where fa.brand = social_posts.brand and fa.platform = pl and fa.active);
    get diagnostics n = row_count;
    if n > 0 then perform invoke_edge_function(fn, jsonb_build_object('action','drain'), 5000); v_fixed := v_fixed || (n || ' failed ' || nm || ' post(s) re-queued for one more try'); end if;
    select count(*) into n from social_accounts where platform = pl and not active and access_token is not null;
    if n > 0 then v_bad := v_bad || (n || ' ' || nm || ' account(s) need a reconnect — queued ' || nm || ' posts are held'); end if;
    select count(*) into n from social_posts where platform = pl and status = 'failed' and max_attempts > 3 and updated_at > now() - interval '24 hours';
    if n > 0 then v_bad := v_bad || (n || ' ' || nm || ' post(s) failed even after the automatic retry'); end if;
    select count(*) into n from social_accounts where active and access_token is not null and platform = pl and pl <> 'youtube' and token_expires_at is not null and token_expires_at < now() + interval '10 days';
    if n > 0 then perform invoke_edge_function(fn, jsonb_build_object('action','refresh'), 5000); v_fixed := v_fixed || (n || ' ' || nm || ' token(s) inside 10 days — refresh kicked'); end if;
    select count(*) into n from social_accounts where active and access_token is not null and platform = pl and refresh_expires_at is not null and refresh_expires_at < now() + interval '14 days';
    if n > 0 then v_bad := v_bad || (n || ' ' || nm || ' account(s) need a reconnect within 14 days (refresh token expiring)'); end if;
  end loop;

  select count(*) into n from social_accounts where active and access_token is not null and platform <> 'tiktok' and platform <> 'facebook' and platform <> 'youtube' and token_expires_at is not null and token_expires_at < now();
  if n > 0 then
    update social_accounts set active = false where active and access_token is not null and platform <> 'tiktok' and platform <> 'facebook' and platform <> 'youtube' and token_expires_at is not null and token_expires_at < now();
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

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Crons: copied from the Pinterest pair with the function name swapped (drain every 5 min, check every 6 h)
-- ---------------------------------------------------------------------------------------------------------------
select cron.schedule('social-drain-youtube', '5-59/5 * * * *',
  $c$select public.invoke_edge_function('bestly-yt-poster', '{"action":"drain"}'::jsonb, 120000)$c$);
select cron.schedule('social-check-youtube', '53 */6 * * *',
  $c$select public.invoke_edge_function('bestly-yt-poster', '{"action":"check"}'::jsonb, 60000)$c$);

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Team card (CLAUDE.md "Every bot gets a team card"): Studio Watch owns the studio:* alerts, so its pulse names the cron jobs.
--    The six Facebook / LinkedIn / Pinterest social crons were on nobody's card (the Recruiter's "schedules:social" finding), so they are named too.
-- ---------------------------------------------------------------------------------------------------------------
update public.bestly_agents
   set pulse = jsonb_set(coalesce(pulse, '{}'::jsonb), '{also}',
         (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from (
            select jsonb_array_elements_text(coalesce(pulse->'also', '[]'::jsonb)) as x
            union select unnest(array['social-drain-youtube', 'social-check-youtube',
                                      'social-drain-facebook', 'social-check-facebook',
                                      'social-drain-linkedin', 'social-check-linkedin',
                                      'social-drain-pinterest', 'social-check-pinterest'])) s), true),
       updated_at = now()
 where slug = 'studio-watch';
