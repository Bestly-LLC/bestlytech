-- Follow-up to 20261007210000: the net. block also matched only the bare form. "net"."http_request_queue"
-- (quoted, with spaces) slipped through, as it always did. Same function, regex widened. Test: refused.

create or replace function public.admin_sql_read(p_query text, p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_raw  text := btrim(regexp_replace(coalesce(p_query, ''), ';+\s*$', ''));
  v_code text;
  v_out  jsonb;
begin
  if auth.uid() is not null then
    perform public.admin_require_admin();
  end if;

  -- code-only copy: no strings, quoted identifiers or comments (see admin_sql_code_only)
  v_code := btrim(regexp_replace(public.admin_sql_code_only(coalesce(p_query, '')), ';[\s]*$', ''));

  if v_code !~* '^\s*(select|with)\s' then
    raise exception 'read-only: statement must start with SELECT or WITH';
  end if;
  if position(';' in v_code) > 0 then
    raise exception 'read-only: one statement at a time';
  end if;
  -- A CTE can hide a write. Only real code is scanned, so  WHERE kind = 'call'  is fine.
  if v_code ~* '\m(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|merge|refresh|reindex|vacuum|listen|notify|set|reset)\M' then
    raise exception 'read-only: that statement changes things';
  end if;
  -- Nothing here should ever touch secrets, and nothing may run SQL out of a string. These scan the
  -- FULL original text (strings and "quoted" names included) because that is where a name could hide.
  if v_raw ~* '\m(vault|decrypted_secrets|internal_fn_secrets|pg_read_file|pg_ls_dir|lo_import|dblink|pg_authid|pg_shadow)\M'
     or v_raw ~* '\mnet["\s]*\.'
     or v_raw ~* '\m(query_to_xml|query_to_xml_and_xmlschema|table_to_xml|schema_to_xml|database_to_xml|cursor_to_xml|xpath_table)\M'
     or v_code ~* 'U&' then
    raise exception 'that table is not readable from here';
  end if;

  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s' || E'\n' || ') q limit %s) t',
    v_raw, greatest(1, least(coalesce(p_limit, 100), 200))
  ) into v_out;

  return v_out;
end;
$function$;

-- same grants as before: postgres, authenticated, service_role (never anon / public)
revoke all on function public.admin_sql_read(text, integer) from public, anon;
grant execute on function public.admin_sql_read(text, integer) to authenticated, service_role;
