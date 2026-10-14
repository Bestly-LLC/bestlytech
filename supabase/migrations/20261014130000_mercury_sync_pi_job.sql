-- Mercury nextcloud sync moves off Claude onto the Pi (token-saving rule, Jared 2026-10-04).
-- Replaces the Claude scheduled task trig_012PN2BMkaL5eN1z4MhAPucf (Mondays 8:00 AM PT). Code: tools/mercury-sync/.
--
-- 1. pi_jobs heartbeat row. enabled = false until the install has had one good run
--    (then: update pi_jobs set enabled = true where job = 'mercury-sync'). max_gap_min 10200 = a week plus slack.
-- 2. Team card "Rolo". The slug 'mercury-sync' is already the Claude-run Bookkeeper card (Mondays, bank statements,
--    runs_on claude), so this bot gets its own slug 'rolo' and must not overwrite that one. The pulse reads the
--    pi_jobs row (src pi_job); src cron would look for a pg_cron job and show "schedule entry is gone".
--
-- No new table holds emails or phones (the Pi keeps only counts and Mercury customer ids in its state file), so no
-- privacy_data_map rows are needed. No Vault copy either: nextcloud_user / nextcloud_app_password / nextcloud_base_url
-- are already on the pi_secret allowlist and the Mercury token is Vault pi:mercury_api_token (pi_secret_get).
--
-- UNDO: delete from public.pi_jobs where job = 'mercury-sync'; update public.bestly_agents set status = 'retired' where slug = 'rolo';
--       delete from public.notification_owners where prefix = 'mercury-sync';

insert into public.pi_jobs (job, description, max_gap_min, enabled, replaced_claude_task)
values ('mercury-sync',
        'Rolo: Mondays 8:00 AM PT. Copies Mercury Invoicing customers missing from the Nextcloud address book into it (create only, matched by email, never updates or deletes). Pi worker tools/mercury-sync, replaces the Claude task Mercury nextcloud sync.',
        10200, false, 'trig_012PN2BMkaL5eN1z4MhAPucf')
on conflict (job) do update set description = excluded.description,
                                max_gap_min = excluded.max_gap_min,
                                replaced_claude_task = excluded.replaced_claude_task;

select public.team_onboard($j$[
 {"slug":"rolo","name":"Rolo","role":"Keeps Nextcloud contacts in step with Mercury","reports_to":"scout","runs_on":"pi","icon":"contact",
  "schedule":"Mondays 8:00 AM",
  "what_it_does":"Every Monday it lists the customers in Mercury Invoicing and checks the Nextcloud address book by email. Anyone missing gets a new contact tagged Mercury Customer. It only ever adds: it never edits or deletes a contact, and it adds at most 200 a run. If Mercury or Nextcloud cannot be read it says so and changes nothing.",
  "pulse":{"src":"pi_job","key":"mercury-sync","gap":10200,"alert":true},
  "owns":["mercury-sync"]}
]$j$::jsonb);
