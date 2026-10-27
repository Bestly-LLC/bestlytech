-- Vera becomes the Compliance Officer (2026-10-26). Team card via the onboarding protocol, same shape as Radar:
-- primary pulse = the daily Pi job (team_watch raises "gone quiet" through the Fix Ladder), the weekly job and her old 10-minute
-- privacy tick stay named in `also` so Roster Scanner does not make a "New hire" card for them. Two tool cards sit under her.
-- Append-only: onboard is an upsert, and her before-roles are kept in profile.before_roles by team_onboard itself.
select public.team_onboard('[
  {"slug":"privacy-clerk","name":"Vera","role":"Compliance Officer","reports_to":"security-auditor","dept":"ops",
   "what_it_does":"Checks every Bestly website, app and phone agent against the privacy, advertising, recording, texting and filing rules, every morning at 6:20 AM, for free. Reads the regulators and the App Store and Chrome rules every Monday and says in plain words what a change means for us. Keeps the list of everything still to fix, with the worst first, and the dates things are due. Quietly tells you when a check starts failing, then again at 3, 6 and 9 days. Still handles the data requests Maya takes on the phone.",
   "runs_on":"pi","schedule":"Daily 6:20 AM, law watch Mondays 6:40 AM, data requests every 10 min","icon":"shield","admin_url":"/admin/security","sort":50,
   "pulse":{"src":"pi_job","key":"compliance_daily","gap":1560,"also":["privacy-clerk","compliance_weekly"],"alert":true,"issues":["compliance."]},
   "owns":["privacy","compliance"],"welcome":false},
  {"slug":"privacy-desk","name":"Privacy Desk","role":"Handles data requests","tool_of":"privacy-clerk",
   "what_it_does":"Emails the person a one-tap link to confirm a data request, finds every record we hold on them and shows you the list before anything is removed.",
   "runs_on":"cloud","schedule":"every 10 min","icon":"shield","admin_url":"/admin/maya",
   "pulse":{"src":"cron","job":"privacy-clerk","gap":30,"alert":true}},
  {"slug":"law-watch","name":"Law Watch","role":"Reads the regulators","tool_of":"privacy-clerk",
   "what_it_does":"Every Monday reads the FTC, FCC, California privacy and tax agencies, Apple and Chrome rule pages, and checks domain and App Store dates. A free AI says what a change means for Bestly.",
   "runs_on":"pi","schedule":"Mondays 6:40 AM","icon":"scale","admin_url":"/admin/security",
   "pulse":{"src":"pi_job","key":"compliance_weekly","gap":11520,"alert":true,"issues":["compliance."]}}
]'::jsonb);

-- Her 10-minute data-request tick used to be her whole pulse; the daily job now checks it too, so it can never go quiet unseen.
insert into public.compliance_checks (id, area, title, kind, target, params, every)
select 'agents.privacy-clerk.ticking', 'agents', 'The data-request clerk ticked in the last 30 minutes', 'sql_true',
       'select coalesce(max(last_tick_at) > now() - interval ''30 minutes'', false) from privacy_clerk_state', '{}'::jsonb, 'daily'
 where not exists (select 1 from public.compliance_checks where id = 'agents.privacy-clerk.ticking');
