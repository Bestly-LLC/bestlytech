-- Job Finder card: now runs on the Pi (cron job job_finder, daily 7:00 AM, free AI), no longer on the Claude scheduled task
-- trig_01W3dUTL4HFVoCcfRYFAW8GG (disabled, kept as the fallback). First Pi run 2026-10-11 2:51 PM PT: 24 new cards, 6 closed Shortlist roles moved.
select public.team_onboard($j$[
 {"slug":"job-finder","name":"Job Finder","role":"Career Agent","reports_to":"jared","dept":"desk","runs_on":"pi","icon":"briefcase",
  "schedule":"Daily 7:00 AM","welcome":false,
  "what_it_does":"Every morning finds forward-deployed-engineer and hospitality or concierge roles near 90069, ranks them A, B or C, posts them to the Job Search board on cloud.bestly.tech, and moves closed Shortlist roles to Closed. Never overnight or graveyard shifts.",
  "pulse":{"src":"pi_job","key":"job_finder","gap":1560,"alert":true},
  "owns":["jobs."]}
]$j$::jsonb);

insert into public.notification_owners (prefix, agent_slug, note)
values ('jobs', 'job-finder', 'Job Finder: new roles on the board, source trouble')
on conflict (prefix) do update set agent_slug = excluded.agent_slug, note = excluded.note;
