-- Dots are drawn out to the sky map radius (wall_state.airRadiusMi), not a fixed 1.25 mi (Jared, Oct 29 2026: alerts span the map).
-- Both the wall (citPaint: sn.dot_ft) and /admin Sky read dot_ft from this snapshot, so parity holds.
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.citizen_snapshot_json()'::regprocedure);
  if position('''dot_ft'', 6600' in d) = 0 then raise exception 'dot_ft literal not found'; end if;
  d := replace(d, '''dot_ft'', 6600',
    '''dot_ft'', coalesce((select round(greatest(1, least(30, coalesce(nullif(w.state->>''airRadiusMi'','''')::numeric, 10))) * 5280)::int from wall_state w limit 1), 52800)');
  execute d;
end $mig$;
