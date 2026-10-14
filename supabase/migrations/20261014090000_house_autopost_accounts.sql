-- House brands mirror Centering YOU's calendar autopost (Spark, 2026-10-14). Part 1 of 6: posting ACCOUNTS.
-- The weekly cap, day-taken test and week counts now work per Instagram ACCOUNT, not per client:
-- bestly-cloud + bestly-studio + bestly-agent share @bestly_llc (7 a week combined).
-- Plan + rollback: docs/house-autopost-opusplan.md.

-- 0. Nothing auto-posts before this moment (Jared: not tonight, earliest 9 AM PT Oct 14) ---------------
create table if not exists public.studio_autopost_floor (
  id int primary key default 1 check (id = 1),
  not_before timestamptz,
  note text
);
alter table public.studio_autopost_floor enable row level security;
insert into public.studio_autopost_floor (id, not_before, note)
values (1, '2026-10-14 16:00:00+00', 'House autopost: earliest slot 9:00 AM PT Oct 14 2026 (Jared 12:49 AM)')
on conflict (id) do update set not_before = excluded.not_before, note = excluded.note;

-- 1. Account helpers --------------------------------------------------------------------------------
create or replace function public.is_house_brand(p_brand text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.approval_client_accounts m join public.social_accounts a on a.id = m.account_id where a.brand = p_brand)
$$;

-- the Instagram target a client posts to (house: approval_client_accounts; others: their own brand account)
create or replace function public.studio_acct(p_client uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select x from jsonb_array_elements(public.house_post_targets(p_client)) x where x->>'platform' = 'instagram' limit 1), '{}'::jsonb)
$$;

-- the brand whose settings (cap, window, times) rule a client: the ACCOUNT's brand for house clients
create or replace function public.studio_brand_of(p_client uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select coalesce(nullif(public.studio_acct(p_client)->>'brand', ''), (select social_brand from public.approval_clients where id = p_client))
$$;

-- every client that shares this client's account (itself alone for Centering YOU)
create or replace function public.studio_group(p_client uuid) returns uuid[]
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select array_agg(c.id order by c.id::text) from public.approval_clients c
                    where (c.calendar_autopost or c.kind = 'house') and c.active
                      and public.studio_acct(c.id)->>'id' is not null
                      and public.studio_acct(c.id)->>'id' = public.studio_acct(p_client)->>'id'), array[p_client])
$$;

revoke all on function public.is_house_brand(text), public.studio_acct(uuid), public.studio_brand_of(uuid), public.studio_group(uuid) from public, anon, authenticated;

-- 2. Week definition, cap and counts follow the account ---------------------------------------------
create or replace function public.studio_client_tz(p_client uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select coalesce(nullif(c.tz, ''), nullif(s.tz, ''))
                     from public.approval_clients c left join public.social_brand_settings s on s.brand = public.studio_brand_of(c.id)
                    where c.id = p_client), 'America/Los_Angeles')
$$;

create or replace function public.studio_week_cap(p_client uuid) returns int
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select s.posts_per_week from public.social_brand_settings s where s.brand = public.studio_brand_of(p_client)), 5)
$$;

create or replace function public.studio_cal_week_count(p_client uuid, p_day date, p_skip uuid default null)
returns integer language sql stable security definer set search_path to 'public' as $$
  select count(*)::int from public.approval_items i
   where i.client_id = any(public.studio_group(p_client)) and i.id is distinct from p_skip
     and public.studio_item_day(p_client, i.posted_at, i.scheduled_at, i.scheduled_for)
         between public.studio_week_start(p_client, p_day) and public.studio_week_start(p_client, p_day) + 6
$$;

-- 3. Spread: posts of a house account with fewer than 6 a week are kept off back-to-back days -------
create or replace function public.studio_cal_has_post(p_client uuid, p_day date, p_skip uuid default null) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.approval_items i
                  where i.client_id = any(public.studio_group(p_client)) and i.id is distinct from p_skip
                    and public.studio_item_day(p_client, i.posted_at, i.scheduled_at, i.scheduled_for) = p_day)
$$;

-- words (4+ letters, minus filler) two titles share: the "no duplicate-looking posts" rule (Jared 10/12)
create or replace function public.studio_title_overlap(p_a text, p_b text) returns int
language sql immutable as $$
  select count(*)::int from (
    select distinct w from regexp_split_to_table(lower(coalesce(p_a, '')), '[^a-z0-9]+') w
     where length(w) >= 4 and w not in ('your','with','that','this','what','from','before','after','about','into','make','made','more','than','when','every','just')
    intersect
    select distinct w from regexp_split_to_table(lower(coalesce(p_b, '')), '[^a-z0-9]+') w where length(w) >= 4
  ) s
$$;

create or replace function public.studio_cal_day_check(p_client uuid, p_day date, p_skip uuid default null, p_relaxed boolean default false)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare c approval_clients%rowtype; st social_brand_settings%rowtype; v_tz text; n int; b text; v_brand text; v_at timestamptz; v_floor timestamptz; v_title text; cap int;
begin
  select * into c from approval_clients where id = p_client;
  v_brand := public.studio_brand_of(p_client);
  select * into st from social_brand_settings where brand = v_brand;
  v_tz := coalesce(st.tz, 'America/Los_Angeles');
  if p_day < (now() at time zone v_tz)::date then return 'past'; end if;
  v_at := public.studio_cal_time(v_brand, p_day);
  if v_at < now() + interval '30 minutes' then return 'too_soon'; end if;
  select f.not_before into v_floor from studio_autopost_floor f where f.id = 1;
  if v_floor is not null and v_at < v_floor then return 'too_soon'; end if;
  b := public.studio_cal_blocked(c.slug, p_day); if b is not null then return 'blackout: ' || b; end if;
  if st.days is not null and not (extract(dow from p_day)::int = any(st.days)) then return 'not_a_posting_day'; end if;
  if public.studio_cal_has_post(p_client, p_day, p_skip) then return 'day_taken'; end if;
  cap := public.studio_week_cap(p_client);
  if public.studio_cal_week_count(p_client, p_day, p_skip) >= cap then return 'week_full'; end if;
  if not p_relaxed and c.kind = 'house' then
    if cap <= 4 and (public.studio_cal_has_post(p_client, p_day - 1, p_skip) or public.studio_cal_has_post(p_client, p_day + 1, p_skip)) then return 'too_close'; end if;
    if cap = 5 and ((public.studio_cal_has_post(p_client, p_day - 1, p_skip) and public.studio_cal_has_post(p_client, p_day - 2, p_skip))
                 or (public.studio_cal_has_post(p_client, p_day + 1, p_skip) and public.studio_cal_has_post(p_client, p_day + 2, p_skip))
                 or (public.studio_cal_has_post(p_client, p_day - 1, p_skip) and public.studio_cal_has_post(p_client, p_day + 1, p_skip))) then return 'too_close'; end if;
    if p_skip is not null then
      select title into v_title from approval_items where id = p_skip;
      if exists (select 1 from approval_items o
                  where o.client_id = p_client and o.id <> p_skip
                    and public.studio_item_day(p_client, o.posted_at, o.scheduled_at, o.scheduled_for) between p_day - 3 and p_day + 3
                    and public.studio_title_overlap(v_title, o.title) >= 2) then return 'similar_nearby'; end if;
    end if;
  end if;
  return null;
end $$;

-- the old 3-argument entry point stays (the cap trigger and Studio call it); it is the strict check
create or replace function public.studio_cal_day_free(p_client uuid, p_day date, p_skip uuid default null)
returns text language sql stable security definer set search_path to 'public' as $$
  select public.studio_cal_day_check(p_client, p_day, p_skip, false)
$$;
