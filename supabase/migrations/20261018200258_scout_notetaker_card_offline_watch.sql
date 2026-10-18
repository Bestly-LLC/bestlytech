-- Lane M (2026-10-18): the Scout Notetaker card names the recorder's new database schedule, so the Recruiter's Roster Scanner does
-- not report recorder-offline-watch as a schedule nobody owns (every bot's card must list the cron jobs it owns: CLAUDE.md).
-- recorder-offline-watch (every 5 minutes, recorder_offline_watch()) raises recorder.offline when the Mac mini's recorder has not
-- polled for 15 minutes. Same slug as the existing card, so the card is changed in place: same name, role, pulse; one schedule added.
-- Rollback: run this again without the "also" entry.
select public.team_onboard($j$[
 {"slug":"scout-notetaker","name":"Scout Notetaker","role":"Call recorder and notes","tool_of":"scout","dept":"scout","runs_on":"mac_mini","icon":"notebook-pen",
  "welcome":false,"schedule":"always on","admin_url":"/admin/meetings","sort":14,
  "what_it_does":"Joins your Talk calls, records them, names who spoke, and writes the transcript.",
  "pulse":{"src":"at","table":"meeting_recorder_state","col":"last_seen_at","gap":20,"sum":"'Recorder is ' || coalesce(status, '?')","issues":["recorder"],"also":["recorder-offline-watch"]},
  "owns":["recorder"]}
]$j$::jsonb);
