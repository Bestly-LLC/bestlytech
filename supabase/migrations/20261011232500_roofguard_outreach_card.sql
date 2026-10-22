-- RoofGuard Outreach card: now runs on the Pi (cron job roofguard_outreach, weekdays 9:00 AM, free AI, DRAFT-ONLY). The Claude scheduled
-- task trig_01VAw9GEZHXnWp2SSb6Rn9ZD is disabled and kept as the fallback. Applied only after the first Pi run reported ok.
select public.team_onboard($j$[
 {"slug":"roofguard-outreach","name":"RoofGuard Outreach","role":"Business Development Rep","reports_to":"jared","dept":"sales","runs_on":"pi","icon":"mail-plus",
  "schedule":"Weekdays 9:00 AM","welcome":false,"admin_url":"/admin/roofguard-outreach",
  "what_it_does":"Weekday mornings writes partner-recruit emails to building-services companies and asks for an intro to Eli. It never sends: every draft waits on its page for Jared. It also reads replies, honors STOP, drafts the follow-ups and keeps the call sheet.",
  "pulse":{"src":"pi_job","key":"roofguard_outreach","gap":4400,"alert":true},
  "owns":["rg:booking","rgreply.","rgdrafts.","rgsupp."]}
]$j$::jsonb);

insert into public.notification_owners (prefix, agent_slug, note) values
  ('rgreply', 'roofguard-outreach', 'RoofGuard Outreach: someone wrote back, a reply draft is waiting'),
  ('rgdrafts', 'roofguard-outreach', 'RoofGuard Outreach: drafts queued for review'),
  ('rgsupp', 'roofguard-outreach', 'RoofGuard Outreach: opt-outs and bounces recorded')
on conflict (prefix) do update set agent_slug = excluded.agent_slug, note = excluded.note;
