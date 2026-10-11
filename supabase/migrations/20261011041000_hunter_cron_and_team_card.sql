-- Hunter: the nightly schedule and the team card.
-- Where it runs: the hunter-run edge function, kicked by pg_cron (the Pi and Mac mini are not reachable from the build
-- session, so this is the cloud fallback; still zero Claude tokens). Times are UTC; the PT time is in each comment (PDT now,
-- the hours slide one hour later in PT after November 1, which is fine for an overnight job).
--
--   hunter-find     05:00, 05:20, 05:40, 06:00 UTC  (10:00-11:00 PM PT)  four passes over fresh map tiles
--   hunter-tick     every 3 min 05:00-11:59 UTC     (10 PM-5 AM PT)      read sites + fit score, Telnyx line type, hand off when drained
--   hunter-handoff  12:30 UTC                       (5:30 AM PT)         tops every campaign up to its daily target
--   hunter-watch    13:00 UTC                       (6:00 AM PT)         watchdog: queue under half of target, sources failing, nothing queued

do $$
declare j text;
begin
  foreach j in array array['hunter-find', 'hunter-find-late', 'hunter-tick', 'hunter-handoff', 'hunter-watch'] loop
    perform cron.unschedule(j) where exists (select 1 from cron.job where jobname = j);
  end loop;
end $$;

select cron.schedule('hunter-find', '0,20,40 5 * * *', $c$select public.invoke_edge_function('hunter-run', '{"op":"find","limit":80,"tiles":3}'::jsonb, 150000)$c$);
select cron.schedule('hunter-find-late', '0 6 * * *', $c$select public.invoke_edge_function('hunter-run', '{"op":"find","limit":80,"tiles":3}'::jsonb, 150000)$c$);
select cron.schedule('hunter-tick', '*/3 5-11 * * *', $c$select public.invoke_edge_function('hunter-run', '{"op":"tick"}'::jsonb, 150000)$c$);
select cron.schedule('hunter-handoff', '30 12 * * *', $c$select public.invoke_edge_function('hunter-run', '{"op":"handoff"}'::jsonb, 60000)$c$);
select cron.schedule('hunter-watch', '0 13 * * *', $c$select public.invoke_edge_function('hunter-run', '{"op":"watch"}'::jsonb, 170000)$c$);

-- Team card. Reports to Jared like Maya and Reese; the watchdog row was first meant for ava_line_health, which only allows phone lines, so 20261011043000_hunter_health.sql moves it to hunter_health.
select public.team_onboard($j$[
 {"slug":"hunter","name":"Hunter","role":"Lead Generation","dept":"sales","reports_to":"jared","runs_on":"cloud","icon":"search","sort":64,
  "admin_url":"/admin/hunter","schedule":"nightly, 10 PM to 5:30 AM PT; checks at 6 AM PT",
  "what_it_does":"Finds local service businesses for Maya every night: auto repair shops, hair and nail salons, home-service contractors and small clinics in LA County. Pulls public listings (City of LA business list, OpenStreetMap), cleans the phone numbers, skips anyone already in Maya's list, RoofGuard's list or the opt-out list, reads each website, and scores how well the Bestly Agent fits with free AI (one plain sentence on why). Checks the line type with Telnyx so only landlines are queued for calls; mobile numbers are kept for email only. Tops each campaign up to its daily target (30 a day across four campaigns) for Maya to call. Costs nothing but the Telnyx lookups. Does not scrub the National Do Not Call Registry yet, so every lead is marked unchecked. If the queue runs under half of target, a source fails two nights in a row, or nothing is queued, he retries once and then tells you, signed Hunter.",
  "pulse":{"src":"at","table":"ava_line_health","col":"checked_at","ok":"ok","sum":"case when ok then 'Queue OK' else 'Queue problem' end","where":"source = 'hunter'","gap":1560,"alert":true,"also":["hunter-find","hunter-find-late","hunter-tick","hunter-handoff","hunter-watch"]},
  "owns":["hunter"]}
]$j$::jsonb);
