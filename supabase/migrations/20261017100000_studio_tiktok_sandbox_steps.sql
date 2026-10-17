-- TikTok sandbox pre-steps for the connect tile + to-do (Jared, 2026-10-17).
-- TikTok production review was REJECTED Oct 13, so Studio runs on the SANDBOX app (client key sbawnzlu7uoxt067kn). An account can only connect
-- after it becomes a sandbox target user: the person logs in once via TikTok's add-account link. Centering YOU (@centeringyoudeck) is not one yet,
-- so her Connect TikTok fails with non_sandbox_target. While studio_flags.tt_production_approved is false client_connect_tile (TikTok) adds
-- `pre` {steps[], link{url,label}, link_at}, `trouble` and `trouble_title`; board.html draws them (connStepsHTML/connTailHTML), so the Settings
-- tile and the to-do (which both render client_connect_tile) show identical steps. client_connect_tile is otherwise unchanged.
-- Flip when TikTok approves production:  update public.studio_flags set value = true, updated_at = now() where key = 'tt_production_approved';

insert into public.studio_flags (key, value, note)
values ('tt_production_approved', false, 'true once TikTok approves Bestly Studio for production; hides the one-time sandbox setup steps on the TikTok connect tile and to-do')
on conflict do nothing;

create or replace function public.studio_tt_approved()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select value from public.studio_flags where key = 'tt_production_approved'), false);
$$;
revoke execute on function public.studio_tt_approved() from public, anon, authenticated;

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
  -- TikTok sandbox pre-steps (2026-10-17): shown only while studio_flags.tt_production_approved is false. `pre` = steps + one link
  -- button (rendered by the board's connStepsHTML), `trouble` = Q/A for the tile's "Having trouble?" (no prep row exists for TikTok).
  if p = 'tiktok' and not public.studio_tt_approved() then
    v_extra := v_extra || jsonb_build_object(
      'pre', jsonb_build_object(
        'steps', jsonb_build_array(
          'First, a one-time TikTok step, because TikTok is still reviewing Bestly Studio.',
          'It logs you out of TikTok on the web, then asks you to log in as ' || coalesce(v_handle, 'your TikTok account') || ' and accept TikTok’s developer terms.',
          'Wait about an hour, then come back and tap Connect TikTok.'),
        'link', jsonb_build_object('url', 'https://www.tiktok.com/logout?redirect_url=https%3A%2F%2Fwww.tiktok.com%2Flogin%3Fredirect_url%3Dhttps%253A%252F%252Fwww.tiktok.com%252Fauth%252Ftt4d%253Fclient_key%253Dsbawnzlu7uoxt067kn%2526developer_id%253D7656563099889550343%2526app_name%253DBestly%2520Studio%2526app_id%253D7656531505153427476', 'label', 'Open TikTok setup'),
        'link_at', 1),
      'trouble', jsonb_build_array(jsonb_build_object('q', 'TikTok says the account isn’t allowed', 'a', 'Do the one-time TikTok setup above, wait an hour, then tap Connect again.')),
      'trouble_title', 'Having trouble?');
  end if;
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


insert into public.bestly_memory (area, key, title, body, kind, written_by)
values ('studio', 'studio/tiktok-approved-switch', 'TikTok sandbox-steps switch',
 'While TikTok production is not approved, the TikTok connect tile and to-do (same client_connect_tile) show three extra steps first: a one-time TikTok setup link (add-account flow for the sandbox app, app_name=Bestly%2520Studio), wait about an hour, then Connect. Also a trouble Q/A "TikTok says the account isn''t allowed". The day TikTok approves production run: update public.studio_flags set value = true, updated_at = now() where key = ''tt_production_approved''; (steps vanish on next load; flip back to false to bring them back). Reader: studio_tt_approved(), used by client_connect_tile. Board support: tools/studio-tiktok-sandbox-steps/.',
 'runbook', 'claude')
on conflict do nothing;
