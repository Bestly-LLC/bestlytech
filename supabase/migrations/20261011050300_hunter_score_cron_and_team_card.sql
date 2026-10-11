-- Hunter Phase 1.5: the nightly scoring job and the updated team cards.
--   hunter-score   every 10 min, 08:00-12:50 UTC (1:00-5:50 AM PDT): scores checked/queued Maya leads and callable Reese leads that have no
--                  score under 7 days old, capped per night (hunter_settings.score_cap_jev / score_cap_free). Jev when a key is saved, else the free AI.
--                  It sits ahead of the 5:30 AM hand-off (12:30 UTC) so the best leads are queued first. Scoring never blocks the night.
-- Zero Claude tokens: edge function hunter-score + pg_cron (the Pi and Mac mini are not reachable from the build session).

do $$ begin
  perform cron.unschedule('hunter-score') where exists (select 1 from cron.job where jobname = 'hunter-score');
end $$;
select cron.schedule('hunter-score', '*/10 8-12 * * *', $c$select public.invoke_edge_function('hunter-score', '{"op":"run"}'::jsonb, 150000)$c$);

select public.team_onboard($j$[
 {"slug":"hunter","name":"Hunter","role":"Lead Generation","dept":"sales","reports_to":"jared","runs_on":"cloud","icon":"search","sort":64,
  "admin_url":"/admin/leads/hunter","schedule":"nightly, 10 PM to 5:30 AM PT; scoring 1 to 5 AM; checks at 6 AM PT",
  "what_it_does":"Finds local service businesses for Maya every night: auto repair shops, hair and nail salons, home-service contractors and small clinics in LA County. Pulls public listings (City of LA business list, OpenStreetMap), cleans the phone numbers, skips anyone already in Maya's list, RoofGuard's list or the opt-out list, reads each website, and scores how well the Bestly Agent fits with free AI (one plain sentence on why). Checks the line type with Telnyx so only landlines are queued for calls; mobile numbers are kept for email only. Scores every lead a caller may dial (Maya's and Reese's) with Jev, or the free AI when no Jev key is saved: the odds a call reaches a decision maker, who picks up, the best time to call. The best leads are queued first; Reese's ranking is read-only until her dialer is wired in. Tops each campaign up to its daily target (30 a day across four campaigns) for Maya to call. Costs nothing but the Telnyx lookups and a few cents of Jev. Does not scrub the National Do Not Call Registry yet, so every lead is marked unchecked. If the queue runs under half of target, a source fails two nights in a row, scoring fails two nights, or Jev keeps failing, he retries once, falls back to the free AI, and tells you, signed Hunter.",
  "pulse":{"src":"at","table":"hunter_health","col":"checked_at","ok":"ok","sum":"case when ok then 'Queue OK' else 'Queue problem' end","where":"source = 'hunter'","gap":1560,"alert":true,"also":["hunter-find","hunter-find-late","hunter-tick","hunter-handoff","hunter-watch","hunter-score"]},
  "owns":["hunter"]},
 {"slug":"hunter-scorer","name":"Lead Scorer","role":"Call odds and priority","tool_of":"hunter","runs_on":"cloud","icon":"gauge","schedule":"every 10 min, 1 to 5 AM PT",
  "what_it_does":"Scores every lead Maya or Reese may call: the odds a call reaches a decision maker, how it is likely to end, who picks up and the best window. Uses Jev when a key is saved, otherwise the free AI, and says which on every lead.",
  "pulse":{"src":"cron","job":"hunter-score","gap":1560}}
]$j$::jsonb);
