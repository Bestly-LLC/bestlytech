do $m$
declare d text := pg_get_functiondef('public.security_check'::regproc);
begin
  d := replace(d,
$a$    return public.security_check(p_run, p_key || ':unreachable', 'yellow', p_layer, p_asset, p_check,
      coalesce(p_title, 'Couldn''t check: ' || p_check), p_detail, p_fix, p_evidence);$a$,
$b$    v_out := public.security_check(p_run, p_key || ':unreachable', 'yellow', p_layer, p_asset, p_check,
      coalesce(p_title, 'Couldn''t check: ' || p_check), p_detail, p_fix, p_evidence);
    -- the nested call counted this check a second time, as a yellow
    update security_audit_runs set checks_total = checks_total - 1, checks_warn = checks_warn - 1 where id = p_run;
    return v_out;$b$);
  if position('checks_warn = checks_warn - 1' in d) = 0 then raise exception 'patch did not apply'; end if;
  execute d;
end $m$;