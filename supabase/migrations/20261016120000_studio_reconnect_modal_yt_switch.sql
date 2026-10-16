-- Reconnect pop-up (her board) + YouTube "unverified" step switch. Jared, 2026-10-16.
--
-- A) client_social_stop_platform(p_token, p_platform): the "We're no longer posting here" path of the reconnect
--    pop-up. Disconnects the account (social_disconnect: token nulled, inactive, queued posts held, not lost),
--    marks publishing_paused, turns the platform off in social_brand_settings.platforms and logs who/when in
--    posting_settings_log. Once the token is gone needs_attention is false, so the pop-up never comes back.
--    client_social_connect_link now turns a platform back on if (and only if) it was explicitly off, so a
--    client who stopped a platform and later connects it again actually posts there.
-- B) studio_flags row yt_google_verified (default false) + studio_yt_verified(). client_connect_tile adds the
--    "Google may say it hasn't verified Bestly Studio yet" step to the YouTube prep only while it is false.
--    The trouble-list Q/A in connect_platform_help is untouched either way.
--    Turn the step off the day Google approves:  update public.studio_flags set value = true, updated_at = now() where key = 'yt_google_verified';

create table if not exists public.studio_flags (
  key text primary key,
  value boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.studio_flags enable row level security;
revoke all on public.studio_flags from anon, authenticated;
insert into public.studio_flags (key, value, note)
values ('yt_google_verified', false, 'true once Google has verified the Bestly Studio OAuth app; hides the "Google may say it has not verified us" step on the YouTube connect prep')
on conflict do nothing;

create or replace function public.studio_yt_verified()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select value from public.studio_flags where key = 'yt_google_verified'), false);
$$;
revoke execute on function public.studio_yt_verified() from public, anon, authenticated;

-- client_connect_tile: unchanged except the marked block (YouTube unverified step).
CREATE OR REPLACE FUNCTION public.client_connect_tile(p_client uuid, p text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- YouTube unverified step (2026-10-16): shown only while studio_flags.yt_google_verified is false.
    if p = 'youtube' and not public.studio_yt_verified() and jsonb_typeof(v_prep->'steps') = 'array' then
      v_prep := jsonb_set(v_prep, '{steps}', (v_prep->'steps') || to_jsonb(
        'Google may say it hasn’t verified Bestly Studio yet.' || E'\n' || 'That’s expected while Google reviews us. Tap Advanced, then Continue.'::text));
      v_extra := jsonb_build_object('prep', v_prep);
    end if;
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

-- A) "We're no longer posting here"
create or replace function public.client_social_stop_platform(p_token text, p_platform text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c approval_caller; v_brand text; r jsonb; n int := 0;
begin
  c := approval_resolve_client(p_token);
  if public.client_viewer(p_token) is not null then return jsonb_build_object('ok', false, 'error', 'view_only'); end if;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_platform is null or p_platform not in ('instagram','facebook','tiktok','linkedin','pinterest','youtube') then
    return jsonb_build_object('ok', false, 'error', 'bad_platform');
  end if;
  select social_brand into v_brand from approval_clients where id = c.id;
  if v_brand is null then return jsonb_build_object('ok', false, 'error', 'no_brand'); end if;
  r := public.social_disconnect(c.id, p_platform, 'client');
  n := coalesce((r->>'held')::int, 0);
  update social_accounts set publishing_paused = true, updated_at = now() where brand = v_brand and platform = p_platform;
  update social_brand_settings set platforms = coalesce(platforms, '{}'::jsonb) || jsonb_build_object(p_platform, false) where brand = v_brand;
  insert into posting_settings_log (client_id, by_name, patch)
  values (c.id, coalesce(nullif(c.name, ''), 'client') || ' (her board)',
          jsonb_build_object('platforms', jsonb_build_object(p_platform, false), 'stopped', p_platform, 'reason', 'no_longer_posting', 'held', n));
  return jsonb_build_object('ok', true, 'held', n) || public.client_posting_state(c.id) || jsonb_build_object('viewer', false);
end $function$;
grant execute on function public.client_social_stop_platform(text, text) to anon, authenticated;
insert into public.security_public_rpcs (fn, why)
values ('client_social_stop_platform', 'Client board (token-bound, public key by design): the reconnect pop-up, she confirms she is no longer posting on a platform.')
on conflict do nothing;

-- A) connecting a platform she had turned off turns it back on (only when it was explicitly false).
create or replace function public.client_social_connect_link(p_token text, p_platform text default 'instagram'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c approval_caller; v_url text;
begin
  c := approval_resolve_client(p_token);
  if public.client_viewer(p_token) is not null then return jsonb_build_object('ok', false, 'error', 'view_only', 'message', 'You are viewing as the client. Nothing here is saved as them.'); end if;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not (p_platform = 'instagram' or (p_platform = 'tiktok' and public.studio_tiktok_ready()) or (p_platform = 'facebook' and public.studio_fb_ready() and exists (select 1 from approval_clients ac join social_brand_settings s on s.brand = ac.social_brand where ac.id = c.id and coalesce((s.platforms->>'facebook_offered')::boolean, false)))
          or (p_platform in ('linkedin', 'pinterest', 'youtube') and public.connect_platform_available(c.id, p_platform))) then return jsonb_build_object('ok', false, 'error', 'platform_not_ready'); end if;
  v_url := social_connect_mint(c.id, 'client', p_platform);
  update social_brand_settings set platforms = platforms || jsonb_build_object(p_platform, true)
   where brand = (select social_brand from approval_clients where id = c.id) and platforms->>p_platform = 'false';
  return jsonb_build_object('ok', true, 'url', v_url);
end $function$;

insert into public.bestly_memory (area, key, title, body, kind, written_by)
values ('studio', 'studio/youtube-verified-switch', 'YouTube unverified-step switch',
 'The YouTube connect prep on her board (and Studio) shows an extra step, "Google may say it hasn''t verified Bestly Studio yet. / That''s expected while Google reviews us. Tap Advanced, then Continue.", only while studio_flags.yt_google_verified is false (default). The day Google approves the OAuth app run: update public.studio_flags set value = true, updated_at = now() where key = ''yt_google_verified''; (step vanishes on next load; the trouble-list Q/A "Google says it hasn''t verified this app" stays either way). Flip back to false to bring it back. Reader: studio_yt_verified(), used by client_connect_tile. Add this to the follow-up list of studio/youtube-audit-submitted-2026-10-16: when OAuth verification passes, flip this switch (separate from studio_yt_live_set).',
 'runbook', 'claude')
on conflict do nothing;
