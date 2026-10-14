-- Register the Pi job that replaces the Claude task "Bestly - nightly security audit"
-- (trig_01HYfnxG2mTTdjo6hrZZKZaJ). Ares owns it; no new employee card.
--
-- enabled = false on purpose: the job stays dormant (no overdue alert) until Jared has pasted the two
-- tokens on /admin/security, the install has run on the Pi and one live run has been checked.
-- Then:  update public.pi_jobs set enabled = true where job = 'security-audit';
-- max_gap_min 1560 = 26 hours, the same grace the Claude task's team card used.
--
-- UNDO:
--   delete from public.pi_jobs where job = 'security-audit';
--   update public.bestly_agents set pulse = jsonb_set(pulse, '{also}', (pulse->'also') - 'security-audit'), updated_at = now()
--    where slug = 'security-auditor';

insert into public.pi_jobs (job, description, max_gap_min, enabled, replaced_claude_task)
values ('security-audit',
        'Ares: nightly security audit (websites, DNS and mail, Vercel, Supabase advisors, anon-callable writers, cron health) at 1 AM PT',
        1560, false, 'trig_01HYfnxG2mTTdjo6hrZZKZaJ')
on conflict (job) do update set
  description = excluded.description,
  max_gap_min = excluded.max_gap_min,
  replaced_claude_task = excluded.replaced_claude_task;

-- Ares's card. His pulse is src 'at' (security_audit_runs.finished_at), which the Pi job keeps fresh just as
-- the Claude task did. Adding the job to `also` stops team_discover from inventing a "pi-security-audit"
-- New hire card. runs_on / schedule stay as they are until the Claude task is retired.
-- team_onboard overwrites dept and reports_to, so both are passed; its insert needs name, role and what_it_does
-- up front, so every current value is passed back unchanged. welcome:false = no second welcome email.
select public.team_onboard(jsonb_build_array((
  select jsonb_build_object(
    'slug', a.slug, 'name', a.name, 'role', a.role, 'what_it_does', a.what_it_does, 'runs_on', a.runs_on,
    'schedule', a.schedule, 'admin_url', a.admin_url, 'icon', a.icon,
    'dept', 'ops', 'reports_to', 'jared', 'welcome', false,
    'pulse', a.pulse || jsonb_build_object('also', (
      select jsonb_agg(distinct x order by x)
      from jsonb_array_elements_text(coalesce(a.pulse->'also', '[]'::jsonb) || '["security-audit"]'::jsonb) x)))
  from public.bestly_agents a where a.slug = 'security-auditor')));
