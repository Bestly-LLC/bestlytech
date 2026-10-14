-- House autopost part 6d: posts the OLD direct pipeline already sent this week still count against the weekly cap (Spark, 2026-10-14).
-- HOKU, InventoryProof and Cookie Yeti posted daily with no Studio item until tonight. Those posts have no approval item, so the cap
-- and the "one post a day" rule must also look at social_posts that no item owns. After tonight none are created (insert gate).

create or replace function public.studio_legacy_posts(p_client uuid, p_from date, p_to date) returns int
language sql stable security definer set search_path to 'public' as $$
  select count(*)::int from public.social_posts sp
   where sp.approval_item_id is null and sp.platform = 'instagram' and sp.status in ('posted', 'posting', 'queued')
     and sp.brand = public.studio_brand_of(p_client) and public.is_house_brand(sp.brand)
     and (coalesce(sp.posted_at, sp.scheduled_at) at time zone public.studio_client_tz(p_client))::date between p_from and p_to
$$;
revoke all on function public.studio_legacy_posts(uuid, date, date) from public, anon, authenticated;

create or replace function public.studio_cal_week_count(p_client uuid, p_day date, p_skip uuid default null) returns integer
language sql stable security definer set search_path to 'public' as $$
  select (count(*)::int) + public.studio_legacy_posts(p_client, public.studio_week_start(p_client, p_day), public.studio_week_start(p_client, p_day) + 6)
    from public.approval_items i
   where i.client_id = any(public.studio_group(p_client)) and i.id is distinct from p_skip
     and public.studio_item_day(p_client, i.posted_at, i.scheduled_at, i.scheduled_for)
         between public.studio_week_start(p_client, p_day) and public.studio_week_start(p_client, p_day) + 6
$$;

create or replace function public.studio_cal_has_post(p_client uuid, p_day date, p_skip uuid default null) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.approval_items i
                  where i.client_id = any(public.studio_group(p_client)) and i.id is distinct from p_skip
                    and public.studio_item_day(p_client, i.posted_at, i.scheduled_at, i.scheduled_for) = p_day)
      or public.studio_legacy_posts(p_client, p_day, p_day) > 0
$$;
