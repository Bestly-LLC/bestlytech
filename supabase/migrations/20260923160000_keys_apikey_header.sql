-- Key switch, phase 1 (2026-09-23). Vault service_role_key already holds a new sb_secret_ key, but the
-- three database callers send it only as "Authorization: Bearer", which works today only because the
-- gateway swaps it for the legacy JWT. Once legacy keys are off, new keys must travel on the apikey
-- header. Add it now (alongside the Bearer, so nothing changes today).
do $$
declare f text;
begin
  foreach f in array array['invoke_edge_function(text,jsonb,integer)', 'admin_git_call(jsonb)',
                           'push_web_send(text,text,text,text,text,text,uuid)'] loop
    execute replace(replace(replace(pg_get_functiondef(('public.' || f)::regprocedure),
      $a$'Authorization', 'Bearer ' || service_key$a$, $a$'Authorization', 'Bearer ' || service_key, 'apikey', service_key$a$),
      $a$'Authorization','Bearer '||v_key$a$, $a$'Authorization','Bearer '||v_key,'apikey',v_key$a$),
      $a$'Authorization', 'Bearer ' || v_key$a$, $a$'Authorization', 'Bearer ' || v_key, 'apikey', v_key$a$);
  end loop;
end $$;
