-- Ava's team card, updated for the two new jobs (2026-10-05): answering Jared's missed cell calls (forwarded to her line)
-- and gathering spam-call evidence for Do Not Call claims. No new cron jobs: the evidence retry and the spam recount ride on
-- ava-watch (every 10 minutes), which the card already lists. Same slug as the original card, so this updates it in place.
select public.team_onboard($j$[
 {"slug":"ava","name":"Ava","role":"Personal Assistant","reports_to":"jared","dept":"desk","runs_on":"cloud","icon":"hand-helping","welcome":false,
  "schedule":"answers (816) 429-9495 any time","admin_url":"/admin/ava","sort":5,
  "what_it_does":"Answers your personal line, (816) 429-9495. Takes messages (your mom can call any time), greets people she knows by name, makes calls for you, and can connect a call to your cell. Also answers calls you miss on your own cell (forwarded to her line), as your assistant on a recorded line, in your voice if you turn that on. Plays along with spam callers for up to two minutes, keeps the recording, and tracks each company so you can file a Do Not Call complaint or draft a demand letter after two calls.",
  "pulse":{"src":"at","table":"ava_line_health","col":"checked_at","ok":"ok","sum":"case when ok then 'Line OK' else 'Line problem' end","where":"source = 'ava'","gap":30,"alert":true,"also":["ava-watch","ava-followups"]},
  "owns":["ava"]}
]$j$::jsonb);
