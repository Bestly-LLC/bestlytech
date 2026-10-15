-- YouTube connector (2026-10-15), last step: offer YouTube to Elizabeth (Centering YOU).
-- Her tile shows "Soon" (available = false) until studio_yt_ready() is true, i.e. until the Google client id + secret are saved
-- on /connect/youtube-setup.html; her to-do then seeds itself (connect_todos_autoseed).
update public.social_brand_settings
   set platforms = coalesce(platforms, '{}'::jsonb) || '{"youtube_offered": true}'::jsonb
 where brand = 'client-centering-you';
