-- Sidebar order stopped syncing between browsers (Jared, 2026-10-13: "we fixed this and it got reverted").
--
-- Why: admin_nav_prefs (20261005000000) has the right row rules for signed-in admins, but the table was never GRANTed to
-- `authenticated`. Since the 2026-09-16 lockdown, new public tables no longer get that grant by default, so every
-- read/write from the browser was refused. The sidebar swallowed the error and kept each browser's own localStorage
-- order, which looks exactly like "sync got reverted". The table has never had a row.
--
-- Fix: grant the three operations the row rules allow (they still decide who sees what: own row, admins only).
-- Self-heal: admin_nav_sync_watch (pg_cron hourly at :17) re-grants and re-adds the table to realtime if either ever goes
-- missing again, and tells System Monitor it healed (admin.nav.sync). The sidebar now reports a refused read/write to
-- Scout too (admin_report 'nav.sync') instead of failing silently.

grant select, insert, update on public.admin_nav_prefs to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.admin_nav_prefs;
exception when duplicate_object then null; when undefined_object then null;
end $$;

create or replace function public.admin_nav_sync_watch()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_grant boolean; v_rt boolean; v_fixed text[] := '{}';
begin
  v_grant := has_table_privilege('authenticated', 'public.admin_nav_prefs', 'SELECT')
         and has_table_privilege('authenticated', 'public.admin_nav_prefs', 'INSERT')
         and has_table_privilege('authenticated', 'public.admin_nav_prefs', 'UPDATE');
  if not v_grant then
    execute 'grant select, insert, update on public.admin_nav_prefs to authenticated';
    v_fixed := v_fixed || 'permission';
  end if;
  v_rt := exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'admin_nav_prefs');
  if not v_rt then
    begin
      execute 'alter publication supabase_realtime add table public.admin_nav_prefs';
      v_fixed := v_fixed || 'live updates';
    exception when others then null;
    end;
  end if;
  if array_length(v_fixed, 1) > 0 then
    perform bestly_raise('admin.nav.sync', 'problem', 'info', 'System Monitor: fixed sidebar sync between browsers',
      'The sidebar order couldn''t sync (' || array_to_string(v_fixed, ' and ') || ' was missing on admin_nav_prefs). ' ||
      'I put it back; open browsers pick up the shared order the next time they get focus.', 'admin', null, true);
  else
    perform bestly_raise('admin.nav.sync', 'resolved', 'info', null, 'Sidebar sync is healthy.', 'admin');
  end if;
  return jsonb_build_object('grant_ok', v_grant, 'realtime_ok', v_rt, 'fixed', v_fixed);
end $$;
revoke all on function public.admin_nav_sync_watch() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'admin-nav-sync-watch';
select cron.schedule('admin-nav-sync-watch', '17 * * * *', 'select public.admin_nav_sync_watch()');

-- Owned by System Monitor (admin.* alerts already route to it); Team roll-call knows the job.
update public.bestly_agents
   set pulse = jsonb_set(pulse, '{also}', coalesce(pulse->'also', '[]'::jsonb) || '["admin-nav-sync-watch"]'::jsonb), updated_at = now()
 where slug = 'system-monitor' and not coalesce(pulse->'also', '[]'::jsonb) ? 'admin-nav-sync-watch';
