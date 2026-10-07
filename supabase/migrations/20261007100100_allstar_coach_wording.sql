-- Stella: clearer All-Star warning wording (same math).
create or replace function public.allstar_coach() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare s turo_host_stats; m jsonb := '[]'::jsonb; nk jsonb; n int; k int; thr numeric; allowed numeric; need int; v_rate numeric; v_metric text; v_label text;
  v_risk boolean := false; v_lines text[] := '{}'; v_cancel_n int; v_cancel_k int;
begin
  select * into s from turo_host_stats order by taken_at desc limit 1;
  if s.id is null then return jsonb_build_object('has_data', false); end if;
  foreach v_metric in array array['five_star', 'maintenance', 'cleanliness'] loop
    v_rate := case v_metric when 'five_star' then s.five_star_rate when 'maintenance' then s.maintenance_rate else s.cleanliness_rate end;
    select threshold, label into thr, v_label from turo_allstar_rules where metric = v_metric;
    nk := _rate_nk(v_rate, s.completed_trips);
    if nk is null or thr is null then continue; end if;
    n := (nk->>'n')::int; k := (nk->>'k')::int;
    allowed := floor(k * 100.0 / thr - n);                       -- extra trips that are NOT 5-star before the rate falls under the line
    need := case when v_rate >= thr then 0 else ceil((thr * n - 100.0 * k) / (100.0 - thr))::int end;  -- extra 5-star trips to get back to the line
    m := m || jsonb_build_array(jsonb_build_object('metric', v_metric, 'label', v_label, 'rate', v_rate, 'threshold', thr, 'ok', v_rate >= thr,
        'trips_used', n, 'five_star_trips', k, 'misses_allowed', greatest(allowed, 0), 'five_stars_needed', need,
        'at_risk', v_rate >= thr and allowed <= 1));
    if v_rate < thr then
      v_risk := true; v_lines := v_lines || format('%s is %s%%, under the %s%% line: %s more 5-star trips fixes it.', v_label, v_rate, thr, need);
    elsif allowed <= 1 then
      v_risk := true; v_lines := v_lines || case when allowed <= 0
        then format('%s is %s%% (line %s%%): the next trip that is not 5-star drops it under. Every trip needs a 5.', v_label, v_rate, thr)
        else format('%s is %s%% (line %s%%): one more non-5-star trip is all it can take. Every trip needs a 5.', v_label, v_rate, thr) end;
    end if;
  end loop;
  -- cancellations: host cancels / all trips must stay <= 3%
  select threshold into thr from turo_allstar_rules where metric = 'cancellation';
  if s.cancellation_rate is not null and s.completed_trips is not null then
    v_cancel_n := s.completed_trips + greatest(coalesce(s.host_cancels_365, 1), 1);
    v_cancel_k := greatest(coalesce(s.host_cancels_365, round(s.cancellation_rate * v_cancel_n / 100.0)::int), 0);
    allowed := floor((thr / 100.0 * v_cancel_n - v_cancel_k) / (1 - thr / 100.0));
    m := m || jsonb_build_array(jsonb_build_object('metric', 'cancellation', 'label', 'Cancellation rate', 'rate', s.cancellation_rate, 'threshold', thr,
        'ok', s.cancellation_rate <= thr, 'host_cancels', v_cancel_k, 'cancels_allowed', greatest(allowed, 0), 'at_risk', s.cancellation_rate > thr or allowed <= 0));
    if s.cancellation_rate > thr or allowed <= 0 then
      v_risk := true; v_lines := v_lines || format('Cancellation rate is %s%% (line %s%%): do not host-cancel anything.', s.cancellation_rate, thr);
    end if;
  end if;
  select threshold into thr from turo_allstar_rules where metric = 'trips';
  m := m || jsonb_build_array(jsonb_build_object('metric', 'trips', 'label', 'Completed trips', 'rate', s.completed_trips, 'threshold', thr, 'ok', coalesce(s.completed_trips, 0) >= thr, 'at_risk', false));
  return jsonb_build_object('has_data', true, 'taken_at', s.taken_at, 'all_star', s.all_star, 'status', s.all_star_status, 'next_assessment', s.next_assessment,
    'window', s.window_label, 'metrics', m, 'at_risk', v_risk, 'message', array_to_string(v_lines, ' '));
end $$;
revoke all on function public.allstar_coach() from anon, public;
grant execute on function public.allstar_coach() to authenticated, service_role;
