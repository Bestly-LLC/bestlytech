-- 1 or 2 misses is not "single": say "recent miss".
do $mig$
declare d text; nd text;
begin
  d := pg_get_functiondef('public.team_pulses'::regproc);
  nd := replace(d, ' with a single miss''', ' with a recent miss''');
  if nd = d then raise exception 'wording not found'; end if;
  execute nd;
end $mig$;
