-- Ava's team card, updated for calendars, booking calls and next-action buttons (2026-10-05). No new cron jobs: the hourly
-- calendar check rides on ava-watch (every 10 minutes, already on the card); a failed check retries on the next run.
-- Same slug as the original card, so this updates it in place.
select public.team_onboard($j$[
 {"slug":"ava","name":"Ava","role":"Personal Assistant","reports_to":"jared","dept":"desk","runs_on":"cloud","icon":"hand-helping","welcome":false,
  "schedule":"answers (816) 429-9495 any time","admin_url":"/admin/ava","sort":5,
  "what_it_does":"Answers your personal line, (816) 429-9495, and the calls you miss on your own cell, casually and on a recorded line. Takes messages, makes calls for you, and can connect a call to your cell. After each call she suggests the next step as a button on the message: find times that work, call back, reply by call. Find times reads your iCloud and Nextcloud calendars (free or busy only, never the details; Turo trips block about an hour around pickup and return) and lists your next open slots. Nothing dials until you tap a slot and confirm; then she calls the person back, books the time, and adds it to the calendar you marked. Checks the calendar connections hourly (alert: Ava (assistant): calendar connection failed) and reports bookings (Ava (assistant): booked ... for ...). Plays along with spam callers for up to two minutes and tracks each company for Do Not Call claims.",
  "pulse":{"src":"at","table":"ava_line_health","col":"checked_at","ok":"ok","sum":"case when ok then 'Line OK' else 'Line problem' end","where":"source = 'ava'","gap":30,"alert":true,"also":["ava-watch","ava-followups"]},
  "owns":["ava"]}
]$j$::jsonb);
