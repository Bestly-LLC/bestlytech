-- Every cron job was firing on the same minute.
--
-- The monitor alerted that bestly-monitor was failing. It was, but so were fourteen other
-- jobs: 324 failures in six hours, every single one "job startup timeout" and not one
-- application error. monitor_tick() was fine - it succeeded on every run that actually
-- got a worker. bestly-monitor was simply the job that noticed.
--
-- The cause: almost every recurring job was written as */N, and */N means "on the hour,
-- then every N" - so they all share minute 0. 756 of 1129 runs in that window landed on a
-- minute divisible by 5, which is two thirds of the work crammed into a fifth of the
-- available minutes. At :00 roughly seventeen jobs started at once, exhausted the pg_cron
-- worker pool, and the ones that lost the race never started.
--
-- The fix is offsets, not frequency: every job keeps its period and its cadence, it just
-- starts on a different minute. cy-autofix-sweep (7-59/15) and fix-ladder (3-59/10) were
-- already written this way; this brings the rest in line.
--
-- Raising pg_cron.max_running_jobs would also have worked, but it needs a database restart
-- and only raises the ceiling this pile-up would eventually hit again.
select cron.alter_job(25, schedule := '1-59/2 * * * *');     -- studio-notify-drain: odd minutes, off :00

select cron.alter_job(33, schedule := '0-59/5 * * * *');     -- bestly-monitor
select cron.alter_job(30, schedule := '1-59/5 * * * *');     -- home-hub-agent-offline-check
select cron.alter_job(17, schedule := '1-59/5 * * * *');     -- social-autoconnect
select cron.alter_job(27, schedule := '2-59/5 * * * *');     -- expire-stale-home-hub-commands
select cron.alter_job(23, schedule := '2-59/5 * * * *');     -- social-drain-instagram
select cron.alter_job(10, schedule := '3-59/5 * * * *');     -- probe-external
select cron.alter_job(24, schedule := '4-59/5 * * * *');     -- shop-notify-sweep

select cron.alter_job(13, schedule := '6-59/10 * * * *');    -- render-missed-banners
select cron.alter_job(31, schedule := '8-59/10 * * * *');    -- mac-mail-drain

select cron.alter_job(9,  schedule := '5-59/15 * * * *');    -- check-system-health
select cron.alter_job(14, schedule := '9-59/15 * * * *');    -- validate-ai-patterns
select cron.alter_job(32, schedule := '12-59/15 * * * *');   -- mac-agent-watchdog
select cron.alter_job(19, schedule := '13-59/15 * * * *');   -- shop-sync-pull

select cron.alter_job(2,  schedule := '14-59/30 * * * *');   -- cleanup-webauthn-challenges
select cron.alter_job(40, schedule := '29-59/30 * * * *');   -- studio-drift-check
