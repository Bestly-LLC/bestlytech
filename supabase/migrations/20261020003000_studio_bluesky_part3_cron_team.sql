-- Studio Bluesky, part 3 (2026-10-19): crons, alert owners, team card.
-- Undo: see bestly_memory build/studio-bluesky-2026-10-19-undo (fastest off switch: unschedule social-drain-bluesky).

-- 1. crons: drain every 5 minutes (offset so it never lands with the other posters), login health every 6 hours
select cron.schedule('social-drain-bluesky', '2-59/5 * * * *',
  $c$select public.invoke_edge_function('bestly-bluesky-poster', '{"action":"drain"}'::jsonb, 120000)$c$);
select cron.schedule('social-check-bluesky', '31 */6 * * *',
  $c$select public.invoke_edge_function('bestly-bluesky-poster', '{"action":"check"}'::jsonb, 60000)$c$);

-- 2. alerts: Minute News Daily's Bluesky problems are signed by Anchor (mnd.*), every other brand's by the Bluesky Poster card (studio:bluesky)
insert into public.notification_owners (prefix, agent_slug, note)
select 'mnd.bluesky', 'anchor', 'Minute News Daily Bluesky posting and login problems (Anchor), 2026-10-19'
 where not exists (select 1 from public.notification_owners o where o.prefix = 'mnd.bluesky');

-- 3. team card (reports to the same owner as threads-poster: poster), watches both cron jobs, owns studio:bluesky
select public.team_onboard('[{
  "slug": "bluesky-poster", "name": "Bluesky Poster", "role": "Posts approved clips to Bluesky",
  "what_it_does": "Posts approved Studio items to a brand''s Bluesky account. Minute News Daily gets up to 5 a day between 6:00 AM and 9:00 PM Pacific, freshest first, nothing older than 36 hours, and only items Jared approved. Videos go through Bluesky''s own video service. A clip over Bluesky''s size or length limit is refused with a clear reason, never cut. Checks every Bluesky login every 6 hours and raises a reconnect alert (signed Anchor for Minute News Daily) when one stops working.",
  "tool_of": "poster", "runs_on": "cloud", "schedule": "every 5 min", "icon": "send", "admin_url": "/admin/team", "sort": 62,
  "pulse": {"src": "cron", "job": "social-drain-bluesky", "also": ["social-check-bluesky"], "gap": 15, "issues": ["studio:bluesky"]},
  "owns": ["studio:bluesky"]
}]'::jsonb);
