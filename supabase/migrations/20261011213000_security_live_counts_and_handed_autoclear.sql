-- Security page goes live, and Ares's "couldn't fix" alert clears itself.
--
-- 1. "Ares couldn't fix a security issue" (dedupe ares.handed.*) stayed in Needs you after
--    the findings it was about got fixed. Now, whenever a finding changes, any unread
--    ares.handed alert whose findings are all closed (or back with Ares) is marked read.
--    A finding handed in that same run is matched by its autofix.at stamp (same transaction
--    as the alert, so equal timestamps; a 2 minute window covers clock skew between them).
-- 2. security_findings and security_audit_runs join the realtime publication so the
--    Security page and the Command Center chip update the moment Ares or the audit acts.
-- 3. One-time: clear today's stale alert (its 7 settlement findings are fixed).
--
-- UNDO: drop trigger security_findings_handed_autoclear on public.security_findings;
--       drop function public.security_handed_autoclear();
--       alter publication supabase_realtime drop table public.security_findings, public.security_audit_runs;

create or replace function public.security_handed_autoclear()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update admin_notifications n
     set read_at = now()
   where n.read_at is null
     and n.dedupe_key like 'ares.handed.%'
     and not exists (
       select 1 from security_findings f
        where f.status = 'open'
          and f.autofix->>'state' = 'needs_person'
          and (f.autofix->>'at')::timestamptz between n.created_at - interval '2 minutes'
                                                  and n.created_at + interval '2 minutes');
  return null;
exception when others then
  return null;  -- never block a finding update over an alert
end $$;

revoke execute on function public.security_handed_autoclear() from public, anon, authenticated;

create or replace trigger security_findings_handed_autoclear
  after update of status, autofix on public.security_findings
  for each statement execute function public.security_handed_autoclear();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'security_findings') then
    alter publication supabase_realtime add table public.security_findings;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'security_audit_runs') then
    alter publication supabase_realtime add table public.security_audit_runs;
  end if;
end $$;

-- 3. one-time (applied 2026-10-11 by id, outside this migration):
--    update admin_notifications set read_at = now() where id = '31d880ed-779c-4537-a869-532bad91dcc7';
