-- Nickel's lock-screen "Yes, file all" listener (2026-10-10). Runs on the Pi as bestly-settle-actions
-- (tools/settlement-digest/ha_action_listener.py): hears Home Assistant's mobile_app_notification_action
-- SETTLE_YES_<digest uuid> and calls settlement_digest_action_t. It heartbeats pi_job_report('settle-actions') every
-- 10 minutes, ok only while its Home Assistant websocket is connected; 30 quiet minutes alerts Scout.
-- No DROP / UPDATE / DELETE: insert-if-missing and team_onboard only.

insert into public.pi_jobs (job, description, max_gap_min, enabled)
values ('settle-actions', 'Yes Button: Pi service that hears the lock-screen Yes, file all tap on Nickel''s digest (beats every 10 min while connected to Home Assistant)', 30, true)
on conflict (job) do nothing;

select public.team_onboard($j$[
 {"slug":"settle-actions","name":"Yes Button","role":"Hears your lock-screen Yes","tool_of":"settlements","runs_on":"pi","icon":"bell-ring",
  "schedule":"always on",
  "what_it_does":"When you tap Yes, file all on Nickel's morning notification, this hears the tap and approves exactly the settlements that notification named.",
  "pulse":{"src":"pi_job","key":"settle-actions","gap":30,"alert":true}}
]$j$::jsonb);
