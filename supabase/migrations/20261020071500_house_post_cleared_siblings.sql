-- 2026-10-20: sibling platforms of an already-posted item can be claimed again.
-- trg_social_posted_to_item stamps approval_items.posted_at when the FIRST platform posts, after which studio_clear_state
-- returns 'already_posted' and house_post_cleared() was false for every other queued post of that item, so Instagram/TikTok/Threads
-- rows (and any retry) were never claimed once Bluesky had posted. Now a still-queued post passes when the item's approval still
-- stands (internal_status 'approved', post content_version = item content_version, not expired). All other checks unchanged.
create or replace function public.house_post_cleared(p_post uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce((select
                     case when (cs.j->>'error') = 'already_posted'
                          then coalesce(i.internal_status, '') = 'approved' and sp.status = 'queued'
                          else coalesce((cs.j->>'ok')::boolean, false) end
                          and sp.content_version is not distinct from i.content_version
                          and not public.mnd_item_expired(i.id)
                     from public.social_posts sp
                     join public.approval_items i on i.id = sp.approval_item_id
                    cross join lateral (select public.studio_clear_state(i.id) as j) cs
                    where sp.id = p_post), false)
$function$;
