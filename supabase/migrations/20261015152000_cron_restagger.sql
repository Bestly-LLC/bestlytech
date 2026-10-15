-- Re-stagger pg_cron schedules (ops:supabase:cron_startup).
-- Cadence is unchanged except two every-minute watchers (wall-geometry-watchdog,
-- studio-drift-check) that move to every 2 minutes. Only the minute offset moves for
-- the rest, so the */5, */10, */15 and :17 / :23 / :41 pile-ups stop landing on the
-- same minute and exhausting max_worker_processes. Peak per-minute load 71 -> 36.
-- Commands are untouched, no job is disabled, and time-critical jobs (car charge /
-- protect, handoff, calls, payments) are not listed here. Looked up by jobname.
-- Only alters a job whose schedule still equals the expected old value, so a
-- hand-tuned schedule is never overwritten.
do $$
declare
  r record;
  v_id bigint;
begin
  for r in
    select * from (values
    ('wall-geometry-watchdog', '* * * * *', '1-59/2 * * * *'),
    ('studio-drift-check', '* * * * *', '1-59/2 * * * *'),
    ('ava-followups', '*/5 * * * *', '1-59/5 * * * *'),
    ('tesla-climate-autooff-watchdog', '*/5 * * * *', '1-59/5 * * * *'),
    ('studio-thumb-repair', '*/5 * * * *', '4-59/5 * * * *'),
    ('turo-reader-watchdog', '*/5 * * * *', '1-59/5 * * * *'),
    ('db-memory-watch', '*/5 * * * *', '4-59/5 * * * *'),
    ('ltx-watch', '*/5 * * * *', '1-59/5 * * * *'),
    ('trip-guest-push', '*/5 * * * *', '4-59/5 * * * *'),
    ('montage-watch', '*/5 * * * *', '1-59/5 * * * *'),
    ('bluesteel-sweep-tick', '*/5 * * * *', '4-59/5 * * * *'),
    ('ha-todo-sync-watch', '*/5 * * * *', '1-59/5 * * * *'),
    ('trip-changes-sync', '*/5 * * * *', '3-59/5 * * * *'),
    ('wall-feeds-refresh', '*/5 * * * *', '0-59/5 * * * *'),
    ('tesla-worker-alive-watch', '*/5 * * * *', '4-59/5 * * * *'),
    ('studio-autopost-tick', '0-59/5 * * * *', '1-59/5 * * * *'),
    ('bestly-monitor', '0-59/5 * * * *', '3-59/5 * * * *'),
    ('scout-health-watch', '*/10 * * * *', '5-59/10 * * * *'),
    ('ava-watch', '*/10 * * * *', '9-59/10 * * * *'),
    ('scout-file-watchdog', '*/10 * * * *', '5-59/10 * * * *'),
    ('hunter-jev-mail', '*/10 * * * *', '9-59/10 * * * *'),
    ('freellm-watch', '*/10 * * * *', '5-59/10 * * * *'),
    ('social-poll-tiktok', '*/10 * * * *', '9-59/10 * * * *'),
    ('re-intake-guard', '*/10 * * * *', '2-59/10 * * * *'),
    ('scout-free-watch', '*/10 * * * *', '5-59/10 * * * *'),
    ('admin-freshness-sweep', '*/10 * * * *', '9-59/10 * * * *'),
    ('leo-early-return', '*/10 * * * *', '2-59/10 * * * *'),
    ('leo-health', '*/10 * * * *', '5-59/10 * * * *'),
    ('studio-links-watch', '*/10 * * * *', '8-59/10 * * * *'),
    ('scout-paid-watch', '*/10 * * * *', '9-59/10 * * * *'),
    ('posting-pause-tick', '*/10 * * * *', '2-59/10 * * * *'),
    ('social-engine-watch', '*/15 * * * *', '1-59/15 * * * *'),
    ('scout-reply-watch', '*/15 * * * *', '10-59/15 * * * *'),
    ('key-lock-watchdog', '*/15 * * * *', '1-59/15 * * * *'),
    ('studio-thumb-health', '*/15 * * * *', '10-59/15 * * * *'),
    ('free-llm-watch', '*/15 * * * *', '6-59/15 * * * *'),
    ('scout-reflect-watch', '*/30 * * * *', '2-59/30 * * * *'),
    ('admin-freshness-watch', '17 * * * *', '10 * * * *'),
    ('admin-nav-sync-watch', '17 * * * *', '35 * * * *'),
    ('card-qr-watch', '17 * * * *', '51 * * * *'),
    ('keyswitch-watchdog', '17 * * * *', '55 * * * *'),
    ('ava-admin-bridge-selftest', '17 * * * *', '59 * * * *'),
    ('org-chart-discover', '17 * * * *', '1 * * * *'),
    ('social-refresh-tiktok', '17 * * * *', '10 * * * *'),
    ('client-feedback-watch', '17 * * * *', '19 * * * *'),
    ('studio-mail-gap-check', '17 * * * *', '29 * * * *'),
    ('guest-trace-watchdog', '23 * * * *', '31 * * * *'),
    ('leo-demo-parity', '23 * * * *', '32 * * * *'),
    ('demo-invites-watchdog', '41 * * * *', '35 * * * *'),
    ('notify-errors-sweep', '41 * * * *', '43 * * * *')
    ) as t(jobname, old_schedule, new_schedule)
  loop
    v_id := null;
    select jobid into v_id from cron.job
      where jobname = r.jobname and schedule = r.old_schedule;
    if v_id is not null then
      perform cron.alter_job(v_id, schedule := r.new_schedule);
    end if;
  end loop;
end $$;
