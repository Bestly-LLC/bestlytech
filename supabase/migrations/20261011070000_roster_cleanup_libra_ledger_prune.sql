-- Round 2, Worker C (Oct 11 2026, 12:12 AM PT ask: "fix the remaining AI-employee issues").
-- DB-only and inert: nothing here sends anything, files anything or spends anything.
--   1. Roster cleanup in bestly_agents: give the unassigned "New hire" cards a real title and boss. (Retiring the three duplicate cards is
--      in 20261011070100_retire_duplicate_team_cards.sql: a plain UPDATE, which the chat session was not allowed to run.)
--   2. Libra (Sales Tax Manager) gets her Team card. Her Claude scheduled task already existed (trig_01TzMEFBMfinF6GLmv1g5TrC,
--      3rd and 20th at 8:52 AM PT) and beats agent_beats slug 'cdtfa-filer', so the card slug IS 'cdtfa-filer' (team_pulses matches
--      agent_beats.slug = bestly_agents.slug). The task is not touched here.
--   3. Autonomy leftover: nightly prune of notify_ledger (keep 30 days).
--   4. privacy_data_map rows for Nickel's settlement_profile (Jared's own details, kept to file his own claims).
-- Applied to rcqfqhguwpmaarseifqg in pieces: team_cards_unassigned_and_libra, notify_ledger_prune_job, inbox_keeper_owns_ledger_prune,
-- penny_page_link_and_ledger_prune_time (Penny's admin_url and card text, same team_onboard call style).
--
-- UNDO
--   onboarded cards: profile->'before_roles' holds the previous role / reports_to / dept / status (team_onboard saves it).
--   prune job:      select cron.unschedule('notify-ledger-prune');
--   map rows:       delete from privacy_data_map where table_name = 'settlement_profile';

-- 1. Give the unassigned "New hire" cards a real title and a boss. They keep their own heartbeat (pulse is left alone).
--    tool_of makes them tools of an existing employee: dept follows the boss, no welcome message, no push.
select public.team_onboard($j$[
 {"slug":"pi-car-eta","name":"Return ETA","role":"Tells you when the car is coming home","tool_of":"turo-reader","runs_on":"pi","icon":"map-pin","sort":55,
  "schedule":"every few minutes on the Pi, only while a trip is active",
  "what_it_does":"Builds the Turo return card: live-traffic drive time home from where the guest is (TomTom) plus where the car is parked. Says so plainly when there are no active trips."},
 {"slug":"pi-penny-bank","name":"Bank Feed","role":"Weekly Mercury merchant totals","tool_of":"cost-cutter","runs_on":"pi","icon":"landmark","sort":55,
  "schedule":"Mondays 7:50 AM PT on the Pi",
  "what_it_does":"Reads Mercury read-only, adds up outgoing charges per merchant (no raw transactions, no account numbers are stored) and gives Penny the list of recurring bills she asks about. Waiting on a read-only Mercury token; until then it says so once a week and does nothing else."},
 {"slug":"pi-shower-watch","name":"Shower Watch","role":"Shower music and follow-me watch","tool_of":"home-hub","runs_on":"pi","icon":"droplets","sort":55,
  "schedule":"every 5 minutes on the Pi",
  "what_it_does":"Checks the Homebridge Shower Music switch and the Home Assistant watchdog fault, and notes when the away backup is on. Alerts are signed Home Hub Agent."}
]$j$::jsonb);

-- 2. Libra, Sales Tax Manager. Beat slug = card slug = cdtfa-filer. Runs on the 3rd and 20th, so the longest quiet stretch is
--    17 days (3rd to 20th); gap is 18 days in minutes. Alerts are titled "Libra (sales tax): ..." and owned by prefixes cdtfa / libra.
select public.team_onboard($j$[
 {"slug":"cdtfa-filer","name":"Libra","role":"Sales Tax Manager","dept":"accounting","reports_to":"mercury-sync","runs_on":"claude","icon":"scale","sort":60,
  "schedule":"3rd and 20th of the month, 8:52 AM PT",
  "what_it_does":"Files Bestly's California sales and use tax returns (CDTFA, seller's permit 261-060320) on time. Twice a month she checks whether a quarter has ended and is not filed yet; if nothing is due she says so and stops. Otherwise she adds up the period's sales from Mercury (Turo payouts are rental receipts, reported and deducted, so tax due is $0), writes the worksheet, files in the CDTFA portal, saves the stamped filing record to Nextcloud Bestly/Tax/Returns-Filed/ and tells you the confirmation number. She never pays and never guesses: if tax is due, or the portal shows a penalty, a notice or anything unexpected, she fills in what she can, stops, and asks you.",
  "pulse":{"src":"beat","gap":25920,"alert":true},
  "owns":["cdtfa","libra"]}
]$j$::jsonb);

-- 3. notify_ledger prune. Readers: notify_route (dedupe window of seconds to hours), autonomy_recap (last 7 days), the HA fallback and
--    Nickel's digest push only INSERT. 30 days is far past anything that reads it. Owner: Inbox Keeper (Autonomy), which already
--    watches the notify router; its pulse names the new job so the Roster Scanner sees it is owned.
create or replace function public.notify_ledger_prune()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  delete from public.notify_ledger where sent_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.notify_ledger_prune() from public, anon, authenticated;

-- 04:45 UTC = 9:45 PM PDT / 8:45 PM PST. Not run on a re-apply if the job already exists.
select cron.schedule('notify-ledger-prune', '45 4 * * *', $c$select public.notify_ledger_prune()$c$)
 where not exists (select 1 from cron.job where jobname = 'notify-ledger-prune');

select public.team_onboard($j$[
 {"slug":"inbox-keeper","name":"Inbox Keeper","role":"Keeps Needs you short and sends the evening recap","tool_of":"scout","runs_on":"cloud","icon":"inbox",
  "schedule":"every 10 min + 7 PM recap",
  "what_it_does":"Lets only four kinds of news reach Jared (security nobody could fix, money, a real person waiting, something down an hour). Closes stale and fixed alerts every 10 minutes, merges repeats into one card, signs every alert with its employee, sends the 7 PM recap of what the team got done, and has Scout look into it if Needs you grows past 5 cards or 2 days. Also prunes the notification ledger nightly at 9:45 PM PT, keeping 30 days.",
  "pulse":{"gap":30,"job":"autonomy-sweep","src":"cron","also":["autonomy-recap","autonomy-watch","notify-ledger-prune"]}}
]$j$::jsonb);

-- 4. Nickel's settlement_profile holds the operator's own contact details (used to fill his own claim forms). Keep, never auto-delete.
insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason) values
  ('settlement_profile', 'email',        'email', 'keep', 'Jared''s own details, used to file his own claims'),
  ('settlement_profile', 'paypal_email', 'email', 'keep', 'Jared''s own details, used to file his own claims'),
  ('settlement_profile', 'phone',        'phone', 'keep', 'Jared''s own details, used to file his own claims')
on conflict do nothing;
