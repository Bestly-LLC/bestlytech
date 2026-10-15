-- YouTube connector (2026-10-15), step 1 of 2: allow platform 'youtube' on the two posting tables.
-- (Applied to production first, on its own, because DROP CONSTRAINT can come back "cancelled" from the MCP.)
alter table public.social_accounts drop constraint if exists social_accounts_platform_check;
alter table public.social_accounts add constraint social_accounts_platform_check
  check (platform = any (array['instagram'::text, 'tiktok'::text, 'facebook'::text, 'linkedin'::text, 'pinterest'::text, 'youtube'::text]));

alter table public.social_posts drop constraint if exists social_posts_platform_check;
alter table public.social_posts add constraint social_posts_platform_check
  check (platform = any (array['instagram'::text, 'tiktok'::text, 'facebook'::text, 'linkedin'::text, 'pinterest'::text, 'youtube'::text]));
