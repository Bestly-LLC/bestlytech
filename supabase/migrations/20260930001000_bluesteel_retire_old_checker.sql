-- Street sweeping (2026-09-29), part 2: stand down the old Mon/Tue checker.
-- The two older "Street sweeping alert – Blue Steel" scheduled tasks call bluesteel_sweep_precheck() first and stop
-- (logging nothing) when la_now is outside Mon/Tue 6:50-9:59. They treat Melrose-Willoughby as one Mon/Tue block, so on
-- a Monday with the car on the 800 block's west curb they would send a wrong MOVE alert, and they would double the
-- pushes of bluesteel_sweep_tick(). Precheck now always reports a Wednesday midnight, so any copy still running exits
-- quietly. bluesteel_sweep_tick() (pg_cron, every 5 min) is the only checker.
create or replace function public.bluesteel_sweep_precheck()
returns jsonb
language sql
security definer
set search_path to 'public'
stable
as $$
  select jsonb_build_object(
    'alerts_enabled', c.alerts_enabled,
    'skipped_today', bluesteel_la_today() = any(c.skip_dates),
    'acked_today', exists(
      select 1 from bluesteel_sweep_acks a
      where (a.acked_at at time zone 'America/Los_Angeles')::date = bluesteel_la_today()
        and coalesce(a.via, '') not like 'test%'),
    'la_now', '3 00:00',
    'retired', 'Checks now run in the database (bluesteel_sweep_tick). Stop: outside sweeping window.'
  )
  from bluesteel_sweep_config c where c.id = 1
$$;
