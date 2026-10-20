-- Hermes' finished-work lines ("Filed a bill from ...", "Opened and scanned ...") are not fixes: keep them from getting the "fixed:" prefix in the evening recap.
do $p$
declare d text;
begin
  select pg_get_functiondef('public.autonomy_done_phrase(text)'::regprocedure) into d;
  if position('|filed|' in d) = 0 then
    if position('|connected|refreshed)' in d) = 0 then raise exception 'autonomy_done_phrase changed shape'; end if;
    d := replace(d, '|connected|refreshed)', '|connected|refreshed|filed|scanned|opened and scanned|deposit|blocked|caught|handled|shredded|recycled|forwarded)');
    execute d;
  end if;
end $p$;
