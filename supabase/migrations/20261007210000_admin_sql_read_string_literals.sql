-- Scout's run_sql kept refusing plain SELECTs: admin_sql_read scanned the raw query text for write
-- keywords, string literals included, so  WHERE kind = 'call'  was refused with "that statement changes
-- things" (13+ failures in 2 days, all scout_daily kind='call').
-- Plan: docs/scout-free-parity-opusplan.md Part A. Same signature and grants as before.
--
-- 1. admin_sql_code_only(text): returns the query with everything that cannot be code removed
--    (single-quoted strings incl. E'' and '' escapes, dollar-quoted strings, double-quoted identifiers,
--    -- and nested /* */ comments). Each removed span becomes one space.
-- 2. admin_sql_read scans that copy for the write keywords and the one-statement rule, and still runs the
--    ORIGINAL text. The secret-table / net. / string-exec checks keep scanning the FULL original text on
--    purpose (strings and quoted identifiers included): query_to_xml('select * from vault.secrets', ...) and
--    "vault"."secrets" hide the name inside a string or quotes, so those checks must not skip them.
-- 3. Belt and braces kept: execution wraps the query as select * from (...) q, which Postgres refuses for
--    INSERT/UPDATE/DELETE and for data-modifying CTEs. The closing paren now sits on its own line so a
--    trailing -- comment can't swallow it.
-- 4. Provider table: gemini and openrouter train on prompts, so private_ok = false for both (the note on each
--    row always said so; the live rows disagreed). Their enabled flag is left alone.

create or replace function public.admin_sql_code_only(p_sql text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  n      int := coalesce(length(p_sql), 0);
  i      int := 1;
  c      text;
  c2     text;
  prev   text := ' ';
  out    text := '';
  depth  int;
  tag    text;
  m      text[];
  j      int;
begin
  while i <= n loop
    c  := substr(p_sql, i, 1);
    c2 := substr(p_sql, i, 2);

    -- line comment
    if c2 = '--' then
      j := position(E'\n' in substr(p_sql, i));
      if j = 0 then i := n + 1; else i := i + j - 1; end if;  -- keep the newline itself
      out := out || ' '; prev := ' ';

    -- block comment (Postgres nests them)
    elsif c2 = '/*' then
      depth := 1; i := i + 2;
      while i <= n and depth > 0 loop
        c2 := substr(p_sql, i, 2);
        if c2 = '/*' then depth := depth + 1; i := i + 2;
        elsif c2 = '*/' then depth := depth - 1; i := i + 2;
        else i := i + 1; end if;
      end loop;
      out := out || ' '; prev := ' ';

    -- E'...' string: backslash escapes the next character
    elsif (c = 'e' or c = 'E') and substr(p_sql, i + 1, 1) = '''' and prev !~ '[A-Za-z0-9_$]' then
      i := i + 2;
      while i <= n loop
        c := substr(p_sql, i, 1);
        if c = '\' then i := i + 2;
        elsif c = '''' then
          if substr(p_sql, i + 1, 1) = '''' then i := i + 2; else i := i + 1; exit; end if;
        else i := i + 1; end if;
      end loop;
      out := out || ' '; prev := ' ';

    -- plain string: '' is an escaped quote
    elsif c = '''' then
      i := i + 1;
      while i <= n loop
        if substr(p_sql, i, 1) = '''' then
          if substr(p_sql, i + 1, 1) = '''' then i := i + 2; else i := i + 1; exit; end if;
        else i := i + 1; end if;
      end loop;
      out := out || ' '; prev := ' ';

    -- double-quoted identifier: "" is an escaped quote
    elsif c = '"' then
      i := i + 1;
      while i <= n loop
        if substr(p_sql, i, 1) = '"' then
          if substr(p_sql, i + 1, 1) = '"' then i := i + 2; else i := i + 1; exit; end if;
        else i := i + 1; end if;
      end loop;
      out := out || ' '; prev := ' ';

    -- dollar-quoted string, bare or tagged (not numbered parameters, not a dollar inside an identifier)
    elsif c = '$' and prev !~ '[A-Za-z0-9_$]'
          and substr(p_sql, i) ~ '^\$([A-Za-z_][A-Za-z0-9_]*)?\$' then
      m   := regexp_match(substr(p_sql, i), '^(\$([A-Za-z_][A-Za-z0-9_]*)?\$)');
      tag := m[1];
      j   := position(tag in substr(p_sql, i + length(tag)));
      if j = 0 then i := n + 1; else i := i + length(tag) + j - 1 + length(tag); end if;
      out := out || ' '; prev := ' ';

    else
      out := out || c; prev := c; i := i + 1;
    end if;
  end loop;
  return out;
end;
$$;

revoke all on function public.admin_sql_code_only(text) from public, anon, authenticated;
grant execute on function public.admin_sql_code_only(text) to service_role;

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
     or v_raw ~* '\mnet\s*\.'
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

-- provider privacy: these two train on prompts
update public.llm_providers
   set private_ok = false, updated_at = now()
 where name in ('gemini', 'openrouter') and private_ok;
