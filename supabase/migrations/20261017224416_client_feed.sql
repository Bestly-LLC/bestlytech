-- client-feed — a client's public posts, mirrored, so /work is never stale.
--
-- Background: the Centering You block on /work shipped with two post URLs typed
-- into the HTML. She posted on 2026-10-17 and the page did not change, because
-- nothing was ever watching. This gives that section a worker and a watchdog.
--
-- Shape:
--   client_feed_brands  which brands are published, and the health of each sync
--   client_feed_posts   the mirrored posts themselves
--   storage: client-feed   our copy of each thumbnail (Instagram's CDN URLs expire)
--
-- Token rotation stays with bestly-ig-poster's existing refresh cron. This adds
-- no second roller; it only reports a token that stopped working.

create table if not exists public.client_feed_brands (
  -- Matches social_accounts.brand. No FK: that table is keyed by (brand, platform),
  -- so brand alone is not unique there.
  brand                text primary key,
  published            boolean      not null default false,
  label                text,
  last_ok_at           timestamptz,
  last_error           text,
  last_error_at        timestamptz,
  consecutive_failures integer      not null default 0,
  -- How long the page may go without a successful sync before the watchdog speaks.
  stale_after_hours    integer      not null default 6,
  created_at           timestamptz  not null default now()
);

create table if not exists public.client_feed_posts (
  brand       text        not null,
  remote_id   text        not null,
  permalink   text        not null,
  caption     text,
  media_type  text,
  posted_at   timestamptz,
  image_url   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (brand, remote_id)
);

create index if not exists client_feed_posts_brand_posted_idx
  on public.client_feed_posts (brand, posted_at desc);

alter table public.client_feed_brands enable row level security;
alter table public.client_feed_posts  enable row level security;
-- No policies: only the service role (the edge function) touches these. The
-- public reads through client-feed's GET, which picks the columns by hand.

-- Our own copy of each thumbnail. Public read, service-role write.
insert into storage.buckets (id, name, public)
values ('client-feed', 'client-feed', true)
on conflict (id) do update set public = true;

-- Record a failed sync without blanking what is already on the page.
create or replace function public.client_feed_note_failure(p_brand text, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.client_feed_brands
     set last_error           = left(p_error, 300),
         last_error_at        = now(),
         consecutive_failures = consecutive_failures + 1
   where brand = p_brand;
$$;

revoke all on function public.client_feed_note_failure(text, text) from public, anon, authenticated;

-- The watchdog. A stale client feed is not one of the four things that may
-- interrupt Jared, so this goes out as a routed note: silent bell plus the 7 PM
-- recap. It names the brand and the reason so it can be acted on directly.
create or replace function public.client_feed_watch()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r      record;
  n      integer := 0;
  v_why  text;
begin
  for r in
    select b.brand,
           coalesce(b.label, b.brand) as label,
           b.last_ok_at,
           b.last_error,
           b.consecutive_failures,
           b.stale_after_hours,
           a.handle,
           a.token_expires_at
      from public.client_feed_brands b
      join public.social_accounts a
        on a.brand = b.brand and a.platform = 'instagram'
     where b.published
  loop
    v_why := null;

    if r.last_ok_at is null then
      v_why := 'it has never completed a sync';
    elsif r.last_ok_at < now() - make_interval(hours => r.stale_after_hours) then
      v_why := 'the last good sync was ' ||
               to_char(r.last_ok_at at time zone 'America/Los_Angeles', 'Mon FMDD at FMHH12:MI AM');
    elsif r.token_expires_at is not null and r.token_expires_at < now() + interval '7 days' then
      v_why := 'the Instagram token expires ' ||
               to_char(r.token_expires_at at time zone 'America/Los_Angeles', 'Mon FMDD');
    end if;

    if v_why is not null then
      perform public.notify_route(
        p_title  := 'Client feed stale: ' || r.label,
        p_body   := coalesce(r.handle, r.brand) || ' is not updating on bestly.tech/work because ' || v_why ||
                    case when r.last_error is null then '.'
                         else '. Last error: ' || r.last_error end,
        p_level  := 'active',
        p_source := 'Client Feed',
        p_url    := 'https://www.bestly.tech/work/',
        p_tag    := 'client-feed-' || r.brand
      );
      n := n + 1;
    end if;
  end loop;

  return n;
end;
$$;

revoke all on function public.client_feed_watch() from public, anon;

-- Publish Centering You. Her account is already connected in social_accounts.
insert into public.client_feed_brands (brand, published, label)
values ('client-centering-you', true, 'Centering You')
on conflict (brand) do update set published = true, label = excluded.label;

-- Sync hourly at :09; watch every six hours at :39 so it never lands on the
-- same minute as the sync it is judging.
select cron.schedule(
  'client-feed-sync', '9 * * * *',
  $$select public.invoke_edge_function('client-feed', '{"action":"sync"}'::jsonb, 120000)$$
);
select cron.schedule('client-feed-watch', '39 */6 * * *', $$select public.client_feed_watch()$$);

select public.team_onboard('[{
  "slug": "client-feed",
  "name": "Client Feed",
  "role": "Keeps client social on the work page current",
  "what_it_does": "Pulls each published client''s latest Instagram posts every hour, copies the thumbnails into our own storage, and serves them to the Centering You section on bestly.tech/work. We mirror the images because Instagram''s CDN links expire within days and their embed script is blocked for a good share of our audience, so our copy keeps working and sends no visitor data to Meta. It never blanks the page: a failed sync leaves the last good posts up and raises the failure count instead. Token rotation is not its job, bestly-ig-poster''s refresh cron already rolls every token nearing expiry. Its watchdog runs every six hours and routes a quiet note if a feed has gone more than six hours without a good sync, has never synced, or the account token is within a week of expiring.",
  "reports_to": "jared",
  "runs_on": "cloud",
  "schedule": "sync hourly at :09, watchdog every 6h at :39",
  "icon": "rss",
  "admin_url": "/work/",
  "sort": 70,
  "owns": ["Client feed stale"],
  "pulse": {"src": "cron", "job": "client-feed-sync", "also": "client-feed-watch", "gap": 130}
}]'::jsonb);
