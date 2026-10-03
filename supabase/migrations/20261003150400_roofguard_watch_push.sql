-- rg_watch: a finder stalled 45+ min despite re-kicks is a real problem, so push it (not healed). (Spark, 2026-10-03)
create or replace function public.rg_watch()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_reset   int;
  v_left    int;
  v_last    timestamptz;
  v_recent  record;
  v_kicked  boolean := false;
begin
  update rg_leads set enrich_status = 'pending', claimed_at = null
   where enrich_status = 'working' and claimed_at < now() - interval '15 minutes';
  get diagnostics v_reset = row_count;

  select count(*) into v_left from rg_leads
   where enrich_status = 'pending' or (enrich_status = 'error' and enrich_attempts < 3);
  select max(started_at) into v_last from rg_enrich_runs;

  select coalesce(sum(claimed),0) claimed, coalesce(sum(errors),0) errors, count(*) runs
    into v_recent
    from rg_enrich_runs where started_at > now() - interval '1 hour';

  if v_left > 0 and (v_last is null or v_last < now() - interval '20 minutes') then
    perform invoke_edge_function('roofguard-enrich', '{"source":"watchdog"}'::jsonb, 150000);
    v_kicked := true;
  end if;

  if v_left > 0 and v_last is not null and v_last < now() - interval '45 minutes' then
    perform bestly_raise('roofguard.enrich', 'problem', 'warning',
      'RoofGuard phone finder stalled',
      format('No finder run in %s min with %s leads still to look up. Watchdog re-kicks every 10 min, but runs are not landing.',
             round(extract(epoch from now() - v_last) / 60), v_left),
      'roofguard', null, false);
  elsif v_recent.claimed >= 20 and v_recent.errors::numeric / v_recent.claimed > 0.5 then
    perform bestly_raise('roofguard.enrich', 'problem', 'warning',
      'RoofGuard phone finder failing',
      format('%s of %s lookups errored in the last hour. Retries are automatic (3 per lead).',
             v_recent.errors, v_recent.claimed),
      'roofguard', null, false);
  elsif v_recent.runs > 0 or v_left = 0 then
    perform bestly_raise('roofguard.enrich', 'resolved', 'info',
      'RoofGuard phone finder healthy again', null, 'roofguard');
  end if;

  return jsonb_build_object('reset', v_reset, 'left', v_left, 'kicked', v_kicked, 'last_run', v_last);
end $$;
