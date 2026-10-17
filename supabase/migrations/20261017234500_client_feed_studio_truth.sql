-- client-feed, corrected: the work page shows what WE posted, not her account.
--
-- The first version enumerated /me/media, so four of Centering You's own posts
-- sat on bestly.tech/work beside the four Bestly published. A portfolio page
-- claiming someone else's work is worse than a stale one.
--
-- social_posts (status 'posted', with a remote_id) is Studio's record of what
-- it actually published, so that is the truth. client_feed_posts drops to
-- being only the image mirror beside it.

alter table public.client_feed_posts
  add column if not exists studio_post_id uuid;

create index if not exists client_feed_posts_studio_idx
  on public.client_feed_posts (studio_post_id);

-- Anything cached that Studio did not publish.
delete from public.client_feed_posts cf
 where not exists (
   select 1 from public.social_posts sp
    where sp.brand = cf.brand
      and sp.platform = 'instagram'
      and sp.status   = 'posted'
      and sp.remote_id = cf.remote_id
 );

update public.client_feed_posts cf
   set studio_post_id = sp.id
  from public.social_posts sp
 where sp.brand = cf.brand
   and sp.platform = 'instagram'
   and sp.status   = 'posted'
   and sp.remote_id = cf.remote_id;

-- What the page reads. Driven by social_posts, so a post of ours stays listed
-- after it falls out of the newest-N window the Graph API would return, and a
-- post of hers can never appear at all.
create or replace view public.client_feed_public as
select sp.brand,
       sp.remote_id,
       coalesce(cf.permalink, sp.permalink)   as permalink,
       coalesce(cf.caption, sp.caption)       as caption,
       coalesce(cf.media_type, sp.media_type) as media_type,
       sp.posted_at,
       cf.image_url,
       sp.id as studio_post_id
  from public.social_posts sp
  join public.client_feed_brands b
    on b.brand = sp.brand and b.published
  left join public.client_feed_posts cf
    on cf.brand = sp.brand and cf.remote_id = sp.remote_id
 where sp.platform = 'instagram'
   and sp.status   = 'posted'
   and sp.remote_id is not null;
