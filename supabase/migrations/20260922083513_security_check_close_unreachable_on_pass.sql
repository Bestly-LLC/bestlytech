do $m$
declare d text := pg_get_functiondef('public.security_check'::regproc);
begin
  d := replace(d,
$a$  if p_result = 'pass' then
    if f.id is not null$a$,
$b$  if p_result in ('pass','red','yellow') and p_key not like '%:unreachable' then
    -- a check that ran again closes its old "couldn't check" finding
    update security_findings set status='fixed', resolved_at=now(), last_run_id=p_run, updated_at=now()
      where key = p_key || ':unreachable' and status='open';
    if found then
      insert into security_audit_log(run_id, finding_key, actor, action, asset, note)
        values (p_run, p_key || ':unreachable', 'audit', 'fixed', p_asset, 'check reachable again');
    end if;
  end if;

  if p_result = 'pass' then
    if f.id is not null$b$);
  if position('check reachable again' in d) = 0 then raise exception 'patch did not apply'; end if;
  execute d;
end $m$;