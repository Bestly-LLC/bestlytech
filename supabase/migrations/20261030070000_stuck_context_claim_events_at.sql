-- Command Center: "Prompt for Claude" and "Have Scout fix it" on a Claims Closer card threw
-- `column "created_at" does not exist`. stuck_context() read claim_events.created_at, but that
-- table's timestamp column is "at". Patch only those two references in the live definition.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.stuck_context(text)'::regprocedure);
  d := replace(d, 'stuck_when(e.created_at)', 'stuck_when(e.at)');
  d := replace(d, 'order by e.created_at desc)', 'order by e.at desc)');
  d := replace(d, 'from claim_events where case_id = nullif(substr(p_item_id, 7), '''')::uuid order by created_at desc limit 5', 'from claim_events where case_id = nullif(substr(p_item_id, 7), '''')::uuid order by at desc limit 5');
  if d ~ 'e\.created_at|claim_events[^;]*order by created_at' then raise exception 'stuck_context patch did not apply cleanly'; end if;
  execute d;
end $$;
