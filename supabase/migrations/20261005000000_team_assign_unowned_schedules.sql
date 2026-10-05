-- 2026-10-04 The Recruiter assigns the 30 groups of database schedules nobody owned (found by the Roster Scanner's
-- first run, baselined as "known"). Ownership only: each job is added to the owner's pulse.also, which team_pulses
-- ignores, so nobody's health changes. The owner (or the employee whose tool it is) answers for those jobs.
-- Groups whose jobs are all owned now are marked onboarded in team_roster_findings.

create or replace function public.team_assign_jobs(p jsonb) returns int
language plpgsql security definer set search_path to 'public' as $$
declare k text; v jsonb; n int := 0;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  for k, v in select * from jsonb_each(p) loop
    update bestly_agents
       set pulse = coalesce(pulse, '{"src":"none"}'::jsonb) || jsonb_build_object('also',
             (select coalesce(jsonb_agg(distinct x order by x), '[]'::jsonb)
                from (select jsonb_array_elements_text(coalesce(pulse->'also', '[]'::jsonb)) x
                      union select jsonb_array_elements_text(v)) u)),
           updated_at = now()
     where slug = k and status <> 'retired';
    if found then n := n + jsonb_array_length(v); end if;
  end loop;

  update team_roster_findings f set status = 'onboarded'
   where f.status in ('new','known') and f.kind = 'unowned_schedules'
     and not exists (select 1 from unnest(f.jobs) j
                      where not exists (select 1 from bestly_agents a where a.status <> 'retired'
                                          and (a.pulse->>'job' = j or coalesce(a.pulse->'also', '[]') ? j)));
  return n;
end $$;
revoke all on function public.team_assign_jobs(jsonb) from public, anon;
grant execute on function public.team_assign_jobs(jsonb) to authenticated, service_role;

select public.team_assign_jobs($j${
  "system-monitor":   ["admin-freshness-sweep","admin-freshness-watch","notify-errors-sweep","notify-quiet-watchdog"],
  "scout-daily":      ["admin-today-dismissed-prune","wall-one-thing","wall-one-thing-watchdog"],
  "chat-router":      ["ai-gate-prune","free-llm-canary","free-llm-watch","scout-paid-tick","scout-paid-watch","scout-free-watch"],
  "cy-pipeline":      ["ai-generate-patterns","cy-analytics-retention","cy-autofix-sweep","cy-site-guard-watch","process-dismissal-consensus"],
  "security-auditor": ["audit-quiet-begin","audit-quiet-end","ops-identity-audit","security-recheck","security-recheck-watchdog"],
  "car-guard":        ["car-cmd-watchdog","car-drivers-watchdog","car-protect-watchdog","car-wash-watchdog","car-watch",
                       "tesla-access-watchdog","tesla-climate-autooff","tesla-climate-autooff-watchdog","tesla-data-watchdog",
                       "tesla-refresh","tesla-worker-alive-watch","tesla-worker-version-watchdog"],
  "db-watch":         ["cleanup-activation-codes","cleanup-pihole-stats","cleanup-webauthn-challenges","ops-db-hygiene"],
  "spark":            ["client-feedback-watch","client-ideas-watch","shop-notify-sweep","shop-sync-pull","web-events-prune","web-events-rollup",
                       "studio-mail-watch","studio-mail-gap-check","studio-notify-drain"],
  "partner-scout":    ["demo-invites-watchdog","demo-key","demo-key-watchdog","partner-ai-drain","partner-ai-watchdog"],
  "ha-todo-sync":     ["ha-todo-sync-watch"],
  "home-narrator":    ["ha-incident-live","ha-push-dispatch"],
  "key-keeper":       ["key-hold-watchdog","key-lock-watchdog","key-rollover-watch","keyswitch-judge","keyswitch-watchdog"],
  "lax-concierge":    ["lax-ask-watchdog","lax-pass-reminder","lax-watchdog","trip-guest-push"],
  "mac-hands":        ["mac-agent-watchdog"],
  "mail-bridge":      ["mac-mail-drain","process-email-queue"],
  "scout-learner":    ["ops-learn"],
  "scout":            ["scout-file-watchdog","scout-files-prune"],
  "daily-post":       ["social-autoconnect","social-bank-tick","social-engine-watch"],
  "poster":           ["social-drain-tiktok","social-poll-tiktok","social-refresh-ig-tokens","social-refresh-tiktok"],
  "mercury-sync":     ["stripe-watchdog","stripe-watchdog-check"],
  "studio-watch":     ["studio-drift-check","studio-frames-check","studio-origin-watch","studio-state-check","studio-ui-contract-check","studio-ui-contract-request"],
  "todo-checker":     ["todo-check-drain","todo-check-prune","todo-check-watchdog","todo-owner-watchdog"],
  "trip-checker":     ["trip-changes-sync","trip-changes-watchdog","trip-return-detect","trip-ui-watchdog"],
  "turo-reader":      ["trip-charges","turo-reader-watchdog","turo-watchdog"],
  "wall":             ["wall-feeds-refresh","wall-feeds-tick","wall-feeds-watch","wall-geometry-watchdog","wall-r4admin-watchdog","wall-r4w2-watch","wall-sign-watchdog"]
}$j$::jsonb);

-- the 35 single schedules the scanner's 2+ rule didn't flag
select public.team_assign_jobs($j${
  "cy-pipeline":      ["auto-retry-failed-patterns","pattern-maintenance","render-missed-banners","validate-ai-patterns","reset-failed-domains"],
  "car-guard":        ["battery-health","extra-drivers-watchdog","find-car-watchdog","supercharge-audit","tezlab-watchdog"],
  "sweep-guard":      ["bluesteel-sweep-watch"],
  "system-monitor":   ["check-system-health","probe-external","vesta-watchdog"],
  "db-watch":         ["db-memory-watch"],
  "fix-ladder":       ["cron-rerun-failed"],
  "security-auditor": ["gh-pat-expiry-reminder"],
  "pi-runner":        ["pi-jobs-watch"],
  "home-hub":         ["home-hub-agent-offline-check","expire-stale-home-hub-commands"],
  "chat-router":      ["freellm-watch"],
  "transcoder":       ["ltx-watch","clips-watch"],
  "claims-closer":    ["claims-closer-tick"],
  "lax-concierge":    ["faq-premium-connectivity-end","guest-trace-watchdog"],
  "hoku-post-check":  ["hoku-content-tick"],
  "poster":           ["posting-pause-tick"],
  "turo-reader":      ["host-pickup-card"],
  "hr":               ["hr-weekly","reorg-weekly"],
  "improver":         ["improver-weekly"],
  "mail-bridge":      ["mail-enqueue-cleanup","sent-mail-watchdog"],
  "spark":            ["re-intake-guard"]
}$j$::jsonb);

-- every schedule has an owner now, so a single new unowned schedule is worth a ping (was 2+ to avoid first-run noise)
create or replace function public.team_roster_scan(p_quiet boolean default false) returns jsonb
language plpgsql security definer set search_path to 'public', 'cron' as $$
declare v_new int := 0; v_list text;
begin
  with covered as (
    select j.jobname from cron.job j
     where exists (select 1 from bestly_agents a where a.status <> 'retired'
                     and (a.pulse->>'job' = j.jobname or coalesce(a.pulse->'also', '[]') ? j.jobname))),
  fam as (
    select split_part(j.jobname, '-', 1) prefix, array_agg(j.jobname order by j.jobname) jobs
      from cron.job j
     where j.active and j.jobname not in (select jobname from covered)
     group by 1),
  found as (
    select 'schedules:' || prefix key, 'unowned_schedules' kind,
           case when cardinality(jobs) = 1 then 'A schedule nobody on the team owns: ' || jobs[1]
                else format('%s schedules nobody on the team owns: %s', cardinality(jobs), prefix || '-*') end title,
           'Database schedules ' || array_to_string(jobs, ', ') || ' are running but no bot on the Team page owns them.' detail, jobs
      from fam
    union all
    select 'open-role:' || a.slug, 'open_role_working',
           a.name || ' may already be working',
           format('%s is still an open role, but %s ran in the last day. If it is live, onboard it.', a.name, string_agg(distinct j.jobname, ', ')),
           array_agg(distinct j.jobname)
      from bestly_agents a
      join cron.job j on split_part(j.jobname, '-', 1) = split_part(a.slug, '-', 1) and j.active
      join lateral (select 1 from cron.job_run_details d where d.jobid = j.jobid and d.start_time > now() - interval '24 hours' limit 1) ran on true
     where a.status = 'planned' and a.kind = 'open_role' and not (a.profile ? 'hire_id')
       and a.created_at < now() - interval '6 hours'
       and j.jobname not in (select jobname from covered)
     group by a.slug, a.name)
  insert into team_roster_findings as f (key, kind, title, detail, jobs)
  select key, kind, title, detail, jobs from found
  on conflict (key) do update set title = excluded.title, detail = excluded.detail, jobs = excluded.jobs, last_seen = now(),
    status = case when f.status = 'onboarded' then 'new' else f.status end,
    notified_at = case when f.status = 'onboarded' then null else f.notified_at end;

  update team_roster_findings set status = 'onboarded'
   where status in ('new','known') and last_seen < now() - interval '2 hours';

  if p_quiet then
    update team_roster_findings set status = 'known', notified_at = now() where status = 'new' and notified_at is null;
  end if;
  select count(*), string_agg('- ' || title, E'\n') into v_new, v_list
    from team_roster_findings where status = 'new' and notified_at is null;
  if v_new > 0 then
    perform scout_notify(p_title => 'The Recruiter: I found work nobody on the team owns',
      p_body => v_list || E'\nOpen the Team page and tell me who it belongs to, or ask Scout to onboard it.',
      p_severity => 'info', p_push => true, p_url => '/admin/team', p_dedupe => 'roster-' || to_char(now(), 'YYYYMMDDHH24'));
    update team_roster_findings set notified_at = now() where status = 'new' and notified_at is null;
  end if;
  return jsonb_build_object('new', v_new, 'open', (select count(*) from team_roster_findings where status in ('new','known')));
end $$;
revoke all on function public.team_roster_scan(boolean) from public, anon, authenticated;
