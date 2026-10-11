-- Job Finder moves off the Claude scheduled task onto the Pi (Jared, 2026-10-11 2:20 PM): free, daily 7:00 AM PT.
--
-- Old home (Claude scheduled task, DISABLED once the Pi version ran OK, kept as the fallback):
--   trig_01W3dUTL4HFVoCcfRYFAW8GG  "Job Finder"   (slug job-finder)
-- New home: Pi cron job job_finder (tools/job-finder/). It reads the Nextcloud login from Vault (pi_secret), never from a file.
-- Dedupe needs no table of its own: the board's cards carry a <!-- linkedin-id: N --> marker.
-- No emails or phones are stored here, so nothing for privacy_data_map. Service role only, so nothing for security_public_rpcs.

create table if not exists public.job_finder_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  max_per_tier integer not null default 8 check (max_per_tier between 1 and 20),
  updated_at timestamptz not null default now()
);
insert into public.job_finder_settings (id) values (true) on conflict (id) do nothing;
alter table public.job_finder_settings enable row level security;
revoke all on public.job_finder_settings from anon, authenticated;

create or replace function public.job_finder_gate() returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(s) - 'id' from job_finder_settings s where id
$$;
revoke all on function public.job_finder_gate() from public, anon, authenticated;
grant execute on function public.job_finder_gate() to service_role;

create or replace function public.job_finder_set(p_enabled boolean default null, p_max_per_tier integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'Admins only'; end if;
  if p_max_per_tier is not null and p_max_per_tier not between 1 and 20 then raise exception 'New cards per tier must be 1 to 20'; end if;
  update job_finder_settings set enabled = coalesce(p_enabled, enabled), max_per_tier = coalesce(p_max_per_tier, max_per_tier), updated_at = now() where id;
  return job_finder_gate();
end $$;
revoke all on function public.job_finder_set(boolean, integer) from public, anon;
grant execute on function public.job_finder_set(boolean, integer) to authenticated, service_role;

insert into public.pi_jobs (job, description, max_gap_min, enabled, replaced_claude_task) values
 ('job_finder', 'Job Finder: daily 7:00 AM search (account/CS/partnerships, forward deployed engineer, hospitality and concierge) onto the Nextcloud Job Search board; never overnight shifts', 1560, true, 'trig_01W3dUTL4HFVoCcfRYFAW8GG')
on conflict (job) do update set description = excluded.description, max_gap_min = excluded.max_gap_min, replaced_claude_task = excluded.replaced_claude_task;
