-- Hunter: ask the map server more often overnight.
-- Each find call now reads the answer to the last request and fires exactly one new tile (the two-phase design in
-- 20261011040500_hunter_overpass_bridge.sql), so four calls a night found about four tiles. Every 4 minutes from 10 PM to
-- 5 AM PT gives about 100 chances; overpass-api.de answers roughly half, and the call is skipped while 120 unchecked leads
-- are waiting (backlog cap), so the night stops asking by itself once there is enough.
-- hunter-find-late keeps its name (the Hunter team card lists it) and becomes the final read-only pass at 5:02 AM PT that stores the last answer.
-- Append-only: the original schedules live in 20261011041000_hunter_cron_and_team_card.sql.

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'hunter-find'),
  schedule := '*/4 5-11 * * *',
  command := $c$select public.invoke_edge_function('hunter-run', '{"op":"find","limit":80}'::jsonb, 150000)$c$);

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'hunter-find-late'),
  schedule := '2 12 * * *',
  command := $c$select public.invoke_edge_function('hunter-run', '{"op":"find","limit":80,"fire":false}'::jsonb, 150000)$c$);

-- read and check keep running until the 5:30 AM PT hand-off so the 5:02 AM answer still gets scored and line-checked
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'hunter-tick'),
  schedule := '*/3 5-12 * * *');
