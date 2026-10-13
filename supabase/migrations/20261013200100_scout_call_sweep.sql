-- Scout's call debrief sweep (2026-10-13).
-- scout-daily v19 chunks long transcripts and saves progress in meeting_recordings.summary {status:"partial"}.
-- This cron finishes whatever is unprocessed, still partial, or was saved as a template echo ("2 sentences"),
-- max 2 recordings per run, oldest first, only calls that stopped 10+ minutes ago in the last 3 days.
-- UNDO: select cron.unschedule('scout-call-sweep');

do $$ begin perform cron.unschedule('scout-call-sweep'); exception when others then null; end $$;
select cron.schedule('scout-call-sweep', '5,25,45 * * * *',
  $$select public.invoke_edge_function('scout-daily', '{"op":"call_sweep"}'::jsonb, 150000)$$);

-- Team card: Scout Daily (same slug) owns the new job. Same pattern as the Leo update in 20261012060100:
-- keep its existing pulse and add the job to "also".
select public.team_onboard($j$[
 {"slug":"scout-daily","name":"Scout Daily","role":"Daily planner","reports_to":"scout","dept":"scout","runs_on":"cloud","icon":"calendar-check","welcome":false,
  "schedule":"every hour; call debrief sweep every 20 min","admin_url":"/admin","sort":11,
  "what_it_does":"Picks your Today's 3 and the one thing on the wall. After a recorded call he reads the transcript in small pieces, keeps only to-dos that are backed by words actually said, and puts them on the Bestly Ops Deck board. Every 20 minutes he finishes any call that is still unprocessed or half done (2 per pass, calls that ended 10+ minutes ago in the last 3 days).",
  "pulse":{"src":"cron","job":"scout-daily-tick","gap":70,
           "also":["admin-today-dismissed-prune","wall-one-thing","wall-one-thing-watchdog","scout-call-sweep"]}}
]$j$::jsonb);
