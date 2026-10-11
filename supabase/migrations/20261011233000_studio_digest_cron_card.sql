-- 2026-10-11 Studio notification digests, part 4: schedules, the Team card, the baseline.
-- Free, in the database (pg_cron): no claude.ai scheduled task, nothing on the Pi.
--   studio-digest-tick   3,18,33,48 * * * *  sends whoever's local time has come: producers about 6:45 PM
--                                            Pacific, a client about 8:45 AM in her own day (tz column on
--                                            approval_clients; empty = Pacific). DST-proof: it compares local time.
--   studio-talk-rollup   23 * * * *          one team-room roll-up post per hour, 7 AM to 10 PM Pacific
--   studio-digest-watch  34 * * * *          watchdog: re-runs a missed digest once, raises studio.digest otherwise
select cron.schedule('studio-digest-tick',  '3,18,33,48 * * * *', $$select public.studio_digest_tick()$$);
select cron.schedule('studio-talk-rollup',  '23 * * * *',         $$select public.studio_talk_rollup()$$);
select cron.schedule('studio-digest-watch', '34 * * * *',         $$select public.studio_digest_watch()$$);

-- Team card (CLAUDE.md: every bot gets a card the day it goes live). A tool of Spark, who already owns the drain.
select public.team_onboard('[{
  "slug": "studio-digest",
  "name": "Studio Digest",
  "role": "Daily digest sender",
  "what_it_does": "Folds Studio''s per-item notifications into one email a day: one for each client (only when something is waiting on her, about 8:45 AM her time) and one for each producer (about 6:45 PM Pacific, skipped when nothing happened). Also posts one roll-up an hour to the team Talk room instead of a line per event. Watches itself and re-runs a missed digest once.",
  "tool_of": "spark",
  "runs_on": "cloud",
  "schedule": "client email 8:45 AM her time, producers 6:45 PM Pacific, Talk roll-up hourly 7 AM to 10 PM",
  "icon": "mail",
  "pulse": {"src": "cron", "job": "studio-digest-tick", "gap": 30,
            "also": ["studio-talk-rollup", "studio-digest-watch"], "issues": ["studio.digest"]},
  "owns": ["studio.digest"]
}]'::jsonb);

-- baseline: Elizabeth has no "last email" on record, so without this her first morning email would be the old
-- backlog (3 recordings, 4 to-dos). Seeding today as already-sent means her next email comes when something NEW
-- lands for her, or after client_repeat_days of still-waiting.
insert into public.studio_digest_log (kind, subject_id, day, status, detail, sent_at)
select 'client', c.id, (now() at time zone coalesce(c.tz, s.client_default_tz))::date, 'baseline',
       'seeded at rollout so the old backlog is not sent as a first email', now()
  from public.approval_clients c, public.studio_digest_settings s
 where c.slug = 'centering-you'
on conflict (kind, subject_id, day) do nothing;
