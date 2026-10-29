-- Tinker v3 fixer, part 4 (applied with execute_sql, version recorded by hand): the watchdog cron and Tinker's team card.
-- The card goes through team_onboard (the official path); direct writes to bestly_agents are refused.
select cron.schedule('ha-fixer-watch', '2-59/5 * * * *',
  $c$select public.invoke_edge_function('ha-fixer', '{"op":"watch"}'::jsonb, 60000)$c$);


select public.team_onboard('[{
  "slug": "tinker", "name": "Tinker", "role": "Home Automation Engineer",
  "what_it_does": "Turns a sentence from Jared into a Home Assistant automation, and now also fixes the ones he already has. Say what went wrong (the bathroom lights got brighter on their own at 6 AM) and Tinker reads what Home Assistant recorded, finds the automation, script or package that did it, explains it in plain words with 12-hour times, and proposes a fix with a before and after. Nothing changes until Jared taps Apply; the old version is backed up on the Pi and every fix has an Undo. Free AI only (never paid); if it cannot be sure it says so and offers the Code Worker. Watchdogs every 5 minutes for stuck installs and fixes, drafts waiting on a free model, and his own page permissions.",
  "reports_to": "home-hub", "dept": "home", "runs_on": "supabase", "schedule": "on demand; watchdogs every 5 min", "icon": "wrench",
  "admin_url": "/admin/home-hub/automations", "sort": 56, "welcome": false,
  "pulse": {"src": "cron", "job": "ha-automator-watch", "gap": 20, "issues": ["tinker."], "also": ["ha-fixer-watch"]},
  "owns": ["tinker."]
}]'::jsonb);
