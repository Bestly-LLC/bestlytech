-- Pi Job Runner (pi-runner, pulse src pi_any) went red for ANY enabled job with consecutive_failures > 0.
-- The content makers (bestly_social, hoku_maker, cy_maker) miss one AI draft most days and each already has its
-- own employee card, so one bad draft kept the runner red until that job next succeeded (cy_maker is weekly: 7 days).
-- New rule: the runner is unhealthy when a job is in a real streak, 3+ failures in a row, the same line
-- pi_job_report uses to escalate to Scout. Single misses are still counted in the summary, never hidden.
do $mig$
declare d text; nd text;
begin
  d := pg_get_functiondef('public.team_pulses'::regproc);
  nd := replace(d,
$o$          select max(last_run_at), bool_and(coalesce(consecutive_failures, 0) = 0),
                 count(*) filter (where enabled) || ' jobs, ' || count(*) filter (where enabled and coalesce(consecutive_failures,0) > 0) || ' failing'$o$,
$n$          select max(last_run_at), bool_and(coalesce(consecutive_failures, 0) < 3),
                 count(*) filter (where enabled) || ' jobs, ' || count(*) filter (where enabled and coalesce(consecutive_failures,0) >= 3) || ' failing'
                 || case when count(*) filter (where enabled and coalesce(consecutive_failures,0) between 1 and 2) > 0
                         then ', ' || count(*) filter (where enabled and coalesce(consecutive_failures,0) between 1 and 2) || ' with a single miss'
                         else '' end$n$);
  if nd = d then raise exception 'team_pulses pi_any block not found; nothing changed'; end if;
  execute nd;
end $mig$;
