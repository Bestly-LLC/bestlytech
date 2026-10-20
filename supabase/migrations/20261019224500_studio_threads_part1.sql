-- Studio Threads posting, part 1 (2026-10-19): per-platform caps, Vault accessors, capped claim function.
-- Undo: see bestly_memory build/studio-threads-2026-10-19-undo.
-- (The two platform CHECK constraints need a separate statement, see part 2 note in tools/studio-threads/README.md.)

-- 1. caps per brand and platform. Studio's drain for a platform reads its row here (Threads first).
create table if not exists public.social_platform_caps (
  brand text not null,
  platform text not null,
  per_day int,                         -- posts per local day (null = no cap)
  window_start time not null default '06:00',
  window_end time not null default '21:00',
  tz text not null default 'America/Los_Angeles',
  expire_hours int,                    -- a queued post older than this is canceled, never posted late (null = never)
  freshest_first boolean not null default false,
  note text,
  updated_at timestamptz not null default now(),
  primary key (brand, platform)
);
alter table public.social_platform_caps enable row level security;

insert into public.social_platform_caps (brand, platform, per_day, window_start, window_end, tz, expire_hours, freshest_first, note)
values ('minutenewsdaily', 'threads', 5, '06:00', '21:00', 'America/Los_Angeles', 36, true,
        'Jared 2026-10-19: Threads up to 5 a day for Minute News Daily, 6:00 AM to 9:00 PM Pacific, freshest first, 36 hour expiry. Only Jared-approved items post.')
on conflict (brand, platform) do nothing;

-- 2. Vault: Threads app id (public, seeded) and secret (pasted once on the setup page, never anywhere else)
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'studio_threads_app_id') then
    perform vault.create_secret('1452662066744163', 'studio_threads_app_id', 'Threads app id (Meta app Bestly Cloud Social Engine, Threads API use case)');
  end if;
end $$;

create or replace function public.studio_threads_app_set(p_app_id text, p_app_secret text) returns jsonb
language plpgsql security definer set search_path to 'public', 'vault', 'extensions' as $fn$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','') <> 'service_role' then raise exception 'service role only'; end if;
  if length(coalesce(btrim(p_app_id),'')) < 5 or length(coalesce(btrim(p_app_secret),'')) < 16 then raise exception 'id or secret looks too short'; end if;
  perform public.studio_vault_upsert('studio_threads_app_id', btrim(p_app_id), 'Threads app id (Bestly Studio Threads connect)');
  perform public.studio_vault_upsert('studio_threads_app_secret', btrim(p_app_secret), 'Threads app secret (Bestly Studio Threads connect)');
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.studio_threads_app_get() returns jsonb
language plpgsql security definer set search_path to 'public', 'vault' as $fn$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','') <> 'service_role' then raise exception 'service role only'; end if;
  return jsonb_build_object(
    'app_id', (select decrypted_secret from vault.decrypted_secrets where name = 'studio_threads_app_id'),
    'app_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'studio_threads_app_secret'));
end $fn$;

create or replace function public.studio_threads_ready() returns boolean
language sql stable security definer set search_path to 'public', 'vault' as $fn$
  select exists (select 1 from vault.secrets where name = 'studio_threads_app_id') and exists (select 1 from vault.secrets where name = 'studio_threads_app_secret');
$fn$;

-- switch Threads on for a brand. Merges one key (never replaces the settings). When the brand's house client already maps its
-- accounts (approval_client_accounts), the Threads account joins that list; a client with no mapping keeps the Instagram fallback.
create or replace function public.studio_threads_switch_on(p_brand text, p_account uuid default null) returns void
language plpgsql security definer set search_path to 'public' as $fn$
begin
  update social_brand_settings set platforms = coalesce(platforms, '{}'::jsonb) || jsonb_build_object('threads', true) where brand = p_brand;
  if p_account is not null then
    insert into approval_client_accounts (client_id, account_id, sort, note)
    select c.id, p_account, coalesce((select max(m.sort) from approval_client_accounts m where m.client_id = c.id), 0) + 1, 'Threads (added when it was connected)'
      from approval_clients c
     where c.social_brand = p_brand
       and exists (select 1 from approval_client_accounts m where m.client_id = c.id)
       and not exists (select 1 from approval_client_accounts m where m.client_id = c.id and m.account_id = p_account);
  end if;
end $fn$;

-- 3. the Threads drain's claim: same gates as claim_next_social_post, plus the brand's cap row.
--    Master rule: a house brand's post only goes out when house_post_cleared (Jared approved this exact version).
--    Brand is "house" when it is mapped (is_house_brand) OR its client is kind 'house' (Minute News Daily is not mapped yet).
create or replace function public.claim_next_threads_post() returns setof public.social_posts
language plpgsql security definer set search_path to 'public' as $fn$
begin
  -- expiry first: a post that waited longer than its brand's expire_hours is never posted late
  update public.social_posts sp
     set status = 'canceled', error = 'Not posted: waited more than ' || c.expire_hours || ' hours in the queue (Threads expiry rule).'
    from public.social_platform_caps c
   where sp.platform = 'threads' and sp.status = 'queued' and c.brand = sp.brand and c.platform = 'threads'
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
      where s.platform = 'threads' and s.status = 'queued' and s.scheduled_at <= now()
        and not coalesce((public.posting_paused(s.brand)->>'paused')::boolean, false)
        and (not (public.is_house_brand(s.brand) or exists (select 1 from public.approval_clients ac where ac.social_brand = s.brand and ac.kind = 'house'))
             or (s.approval_item_id is not null and public.house_post_cleared(s.id)))
        and (c.brand is null or (
              (now() at time zone c.tz)::time between c.window_start and c.window_end
          and (c.per_day is null or (select count(*) from public.social_posts p
                  where p.brand = s.brand and p.platform = 'threads' and p.status in ('posted', 'posting')
                    and (coalesce(p.posted_at, p.claimed_at) at time zone c.tz)::date = (now() at time zone c.tz)::date) < c.per_day)))
      order by case when coalesce(c.freshest_first, false) then -extract(epoch from s.scheduled_at) else extract(epoch from s.scheduled_at) end
      limit 1
        for update of s skip locked)
  returning sp.*;
end $fn$;

revoke all on function public.claim_next_threads_post() from public, anon, authenticated;
revoke all on function public.studio_threads_app_set(text, text) from public, anon, authenticated;
revoke all on function public.studio_threads_app_get() from public, anon, authenticated;
