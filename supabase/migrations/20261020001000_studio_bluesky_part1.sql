-- Studio Bluesky posting, part 1 (2026-10-19): caps row, Vault accessors, a claim function that works for any platform.
-- Undo: see bestly_memory build/studio-bluesky-2026-10-19-undo.
-- Bluesky has no OAuth for this: the account's handle + an APP PASSWORD live in Supabase Vault (write-only through
-- studio_bluesky_cred_set), the session tokens live on social_accounts (access_token = accessJwt, refresh_token = refreshJwt),
-- the account DID (stable across handle changes) is social_accounts.remote_user_id.

-- 1. caps: Minute News Daily, Bluesky up to 5 a day, 6:00 AM to 9:00 PM Pacific, freshest first, 36 hour expiry
insert into public.social_platform_caps (brand, platform, per_day, window_start, window_end, tz, expire_hours, freshest_first, note)
values ('minutenewsdaily', 'bluesky', 5, '06:00', '21:00', 'America/Los_Angeles', 36, true,
        'Jared 2026-10-19: Bluesky up to 5 a day for Minute News Daily, 6:00 AM to 9:00 PM Pacific, freshest first, 36 hour expiry. Only Jared-approved items post.')
on conflict (brand, platform) do nothing;

-- 2. Vault accessors. Names: studio_bluesky_<brand>_handle and studio_bluesky_<brand>_app_password. Service role only.
create or replace function public.studio_bluesky_cred_set(p_brand text, p_handle text, p_app_password text) returns jsonb
language plpgsql security definer set search_path to 'public', 'vault', 'extensions' as $fn$
declare b text := regexp_replace(lower(coalesce(p_brand, '')), '[^a-z0-9]', '', 'g');
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','') <> 'service_role' then raise exception 'service role only'; end if;
  if length(b) < 2 then raise exception 'brand looks wrong'; end if;
  if length(coalesce(btrim(p_handle),'')) < 3 or length(coalesce(btrim(p_app_password),'')) < 10 then raise exception 'handle or app password looks too short'; end if;
  perform public.studio_vault_upsert('studio_bluesky_' || b || '_handle', btrim(p_handle), 'Bluesky handle for ' || b || ' (Bestly Studio)');
  perform public.studio_vault_upsert('studio_bluesky_' || b || '_app_password', btrim(p_app_password), 'Bluesky APP PASSWORD for ' || b || ' (Bestly Studio). Revoke in Bluesky: Settings, Privacy and security, App passwords.');
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.studio_bluesky_cred_get(p_brand text) returns jsonb
language plpgsql security definer set search_path to 'public', 'vault' as $fn$
declare b text := regexp_replace(lower(coalesce(p_brand, '')), '[^a-z0-9]', '', 'g');
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','') <> 'service_role' then raise exception 'service role only'; end if;
  return jsonb_build_object(
    'handle', (select decrypted_secret from vault.decrypted_secrets where name = 'studio_bluesky_' || b || '_handle'),
    'app_password', (select decrypted_secret from vault.decrypted_secrets where name = 'studio_bluesky_' || b || '_app_password'));
end $fn$;

-- when did this brand last save a password (the page can show "saved", never the value)
create or replace function public.studio_bluesky_cred_saved_at(p_brand text) returns timestamptz
language sql stable security definer set search_path to 'public', 'vault' as $fn$
  select updated_at from vault.secrets where name = 'studio_bluesky_' || regexp_replace(lower(coalesce(p_brand, '')), '[^a-z0-9]', '', 'g') || '_app_password';
$fn$;

-- switch Bluesky on for a brand (merges one key; never replaces the settings), same shape as studio_threads_switch_on
create or replace function public.studio_bluesky_switch_on(p_brand text, p_account uuid default null) returns void
language plpgsql security definer set search_path to 'public' as $fn$
begin
  update social_brand_settings set platforms = coalesce(platforms, '{}'::jsonb) || jsonb_build_object('bluesky', true) where brand = p_brand;
  if p_account is not null then
    insert into approval_client_accounts (client_id, account_id, sort, note)
    select c.id, p_account, coalesce((select max(m.sort) from approval_client_accounts m where m.client_id = c.id), 0) + 1, 'Bluesky (added when it was connected)'
      from approval_clients c
     where c.social_brand = p_brand
       and exists (select 1 from approval_client_accounts m where m.client_id = c.id)
       and not exists (select 1 from approval_client_accounts m where m.client_id = c.id and m.account_id = p_account);
  end if;
end $fn$;

-- 3. one claim function for any platform that has its own poster + a social_platform_caps row (Threads, Bluesky).
--    Same gates as before: expiry first, then only Jared-approved items for house brands (house_post_cleared),
--    the brand's posting window, per-day cap, freshest first.
create or replace function public.claim_next_platform_post(p_platform text) returns setof public.social_posts
language plpgsql security definer set search_path to 'public' as $fn$
begin
  update public.social_posts sp
     set status = 'canceled', error = 'Not posted: waited more than ' || c.expire_hours || ' hours in the queue (' || p_platform || ' expiry rule).'
    from public.social_platform_caps c
   where sp.platform = p_platform and sp.status = 'queued' and c.brand = sp.brand and c.platform = p_platform
     and c.expire_hours is not null and sp.scheduled_at < now() - make_interval(hours => c.expire_hours);

  return query
  update public.social_posts sp
     set status = 'posting', attempts = sp.attempts + 1, claimed_at = now()
   where sp.id = (
     select s.id
       from public.social_posts s
       join public.social_accounts a on a.brand = s.brand and a.platform = s.platform and a.active
        and not a.publishing_paused and a.access_token is not null and a.remote_user_id is not null
       left join public.social_platform_caps c on c.brand = s.brand and c.platform = s.platform
      where s.platform = p_platform and s.status = 'queued' and s.scheduled_at <= now()
        and not coalesce((public.posting_paused(s.brand)->>'paused')::boolean, false)
        and (not (public.is_house_brand(s.brand) or exists (select 1 from public.approval_clients ac where ac.social_brand = s.brand and ac.kind = 'house'))
             or (s.approval_item_id is not null and public.house_post_cleared(s.id)))
        and (c.brand is null or (
              (now() at time zone c.tz)::time between c.window_start and c.window_end
          and (c.per_day is null or (select count(*) from public.social_posts p
                  where p.brand = s.brand and p.platform = p_platform and p.status in ('posted', 'posting')
                    and (coalesce(p.posted_at, p.claimed_at) at time zone c.tz)::date = (now() at time zone c.tz)::date) < c.per_day)))
      order by case when coalesce(c.freshest_first, false) then -extract(epoch from s.scheduled_at) else extract(epoch from s.scheduled_at) end
      limit 1
        for update of s skip locked)
  returning sp.*;
end $fn$;

-- Threads keeps its old entry point; it now just calls the shared function (same behavior).
create or replace function public.claim_next_threads_post() returns setof public.social_posts
language plpgsql security definer set search_path to 'public' as $fn$
begin
  return query select * from public.claim_next_platform_post('threads');
end $fn$;

create or replace function public.claim_next_bluesky_post() returns setof public.social_posts
language plpgsql security definer set search_path to 'public' as $fn$
begin
  return query select * from public.claim_next_platform_post('bluesky');
end $fn$;

revoke all on function public.claim_next_platform_post(text) from public, anon, authenticated;
revoke all on function public.claim_next_threads_post() from public, anon, authenticated;
revoke all on function public.claim_next_bluesky_post() from public, anon, authenticated;
revoke all on function public.studio_bluesky_cred_set(text, text, text) from public, anon, authenticated;
revoke all on function public.studio_bluesky_cred_get(text) from public, anon, authenticated;
revoke all on function public.studio_bluesky_cred_saved_at(text) from public, anon, authenticated;
revoke all on function public.studio_bluesky_switch_on(text, uuid) from public, anon, authenticated;
