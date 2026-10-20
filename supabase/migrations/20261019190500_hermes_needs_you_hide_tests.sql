-- Test alerts (hermes_mailroom --test-alert) never show up as asks in Needs you.
do $p$
declare d text; a text := E'   where a.status = ''proposed'' and a.proposed_at > now() - interval ''14 days'' and s.enabled';
begin
  select pg_get_functiondef('public.admin_today_rows()'::regprocedure) into d;
  if position('not i.is_test and a.status' in d) = 0 then
    if position(a in d) = 0 then raise exception 'admin_today_rows changed shape'; end if;
    d := replace(d, a, E'   where not i.is_test and a.status = ''proposed'' and a.proposed_at > now() - interval ''14 days'' and s.enabled');
    execute d;
  end if;
end $p$;
