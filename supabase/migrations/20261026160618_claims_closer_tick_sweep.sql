-- Claims Closer return gate (2026-10-26), part 3: claims_tick runs claims_gate_sweep first.
-- Applied from chat on 2026-10-26 as version 20261026160618; this file is the recorded statement.
create or replace function public.claims_tick() returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare v_now_la timestamp := now() at time zone 'America/Los_Angeles'; v_daily boolean; v_work int; v_stuck int; v_open int;
begin
  begin perform public.claims_gate_sweep(); exception when others then null; end;
  select count(*) into v_open from claim_cases where status not in ('paid', 'closed');
  v_daily := extract(hour from v_now_la) >= 9 and exists (select 1 from claim_cases where status not in ('paid','closed')
             and (last_daily_at is null or last_daily_at < v_now_la::date));
  select count(*) into v_work from claim_cases where status not in ('paid', 'closed')
    and (needs_work or (follow_up_at is not null and follow_up_at <= now()) or (next_check_at is not null and next_check_at <= now()));
  select count(*) into v_stuck from claim_cases where status not in ('paid', 'closed') and needs_work
    and updated_at < now() - interval '15 minutes' and coalesce(last_run_at, 'epoch') < now() - interval '15 minutes';

  if v_daily then
    perform invoke_edge_function('claims-closer', '{"op":"daily"}'::jsonb, 120000);
  elsif v_work > 0 then
    perform invoke_edge_function('claims-closer', '{"op":"tick"}'::jsonb, 120000);
  elsif v_stuck = 0 then
    perform agent_beat('claims-closer', true, case when v_open = 0 then 'No open claims' else v_open || ' open claim' || case when v_open = 1 then '' else 's' end || ', nothing new' end);
  end if;
  if v_stuck > 0 then
    perform agent_beat('claims-closer', false, v_stuck || ' claim(s) waiting 15+ min; the worker is not running');
    perform bestly_raise('claims.stuck', 'problem', 'warning', 'Claims Closer is not working its cases',
      'claims-closer edge function has not run for 15+ minutes while a case waits.', 'turo', null, false);
  else
    perform bestly_raise('claims.stuck', 'resolved', 'info', 'Claims Closer is working its cases', null, 'turo', null, true);
  end if;
  return jsonb_build_object('work', v_work, 'daily', v_daily, 'stuck', v_stuck);
end $function$;
