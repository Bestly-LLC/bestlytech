-- Tinker v3 fixer, part 3: tinker_page_check now watches all four of his tables (replaces 20261029062402 version).
-- ------------------------------------------------------------------ 3. Tinker checks all four of his tables (replaces the two-table version)
create or replace function public.tinker_page_check(p_still_failing boolean default false, p_load_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t text; pv text; v_missing text[]; v_pol boolean; v_rls boolean;
  v_checked text[] := '{}'; v_healed text[] := '{}'; v_problems text[] := '{}';
  v_do text; v_undo text;
  v_day text := to_char(now() at time zone 'America/Los_Angeles', 'YYYYMMDD');
  v_hour text := to_char(now() at time zone 'America/Los_Angeles', 'YYYYMMDDHH24');
  v_summary text;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or coalesce(public.has_role(auth.uid(), 'admin'::public.app_role), false)) then
    raise exception 'not allowed';
  end if;

  -- Only these four tables, ever. Nothing here takes a table name from the caller.
  foreach t in array array['ha_automations', 'ha_entity_catalog', 'ha_fixes', 'ha_inventory'] loop
    v_checked := v_checked || t;
    select c.relrowsecurity into v_rls from pg_class c where c.oid = ('public.' || quote_ident(t))::regclass;
    select exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = t and policyname = t || '_admin_all' and 'authenticated' = any (roles::text[])
    ) into v_pol;
    v_missing := '{}';
    foreach pv in array array['select', 'insert', 'update', 'delete'] loop
      if not has_table_privilege('authenticated', 'public.' || quote_ident(t), pv) then v_missing := v_missing || pv; end if;
    end loop;

    if not coalesce(v_rls, false) then
      v_problems := v_problems || (t || ': row security is switched off');
    elsif not v_pol then
      v_problems := v_problems || (t || ': the admin-only policy is missing');
    elsif cardinality(v_missing) > 0 then
      v_do := format('grant select, insert, update, delete on public.%I to authenticated', t);
      v_undo := format('revoke select, insert, update, delete on public.%I from authenticated', t);
      begin
        execute v_do;
        insert into public.security_autofix_log (finding_key, action, do_sql, undo_sql, ok, note)
        values ('grant_gap:' || t, 'grant_gap', v_do, v_undo, true,
                'Tinker page check: signed-in read permission was missing (' || array_to_string(v_missing, ', ') || '); the admin-only RLS policy is intact, so rows stay admin-only.');
        v_healed := v_healed || t;
      exception when others then
        insert into public.security_autofix_log (finding_key, action, do_sql, undo_sql, ok, note)
        values ('grant_gap:' || t, 'grant_gap', v_do, v_undo, false, left('Tinker page check could not restore the grant: ' || sqlerrm, 300));
        v_problems := v_problems || (t || ': the permission is missing and I could not restore it');
      end;
    end if;
  end loop;

  if cardinality(v_healed) > 0 then
    perform public.tinker_notify(
      p_title => 'I fixed my own page permission',
      p_body => 'The Automation Maker lost its read permission on ' || array_to_string(v_healed, ' and ') ||
                ' (a database default changed). I put back the same grant. Rows are still admin-only, and the undo is saved in the security log.',
      p_severity => 'success', p_url => '/admin/home-hub/automations', p_dedupe => 'pagecheck.heal.' || v_day);
  end if;

  if cardinality(v_problems) > 0 then
    perform public.tinker_notify(
      p_title => 'Security risk on my own page',
      p_body => 'Tinker couldn''t fix this security problem himself, and he did not grant anything: ' || array_to_string(v_problems, '; ') ||
                '. The Automation Maker page may not load until it is looked at.',
      p_severity => 'warning', p_url => '/admin/security', p_dedupe => 'pagecheck.problem.' || v_day);
  elsif p_still_failing and cardinality(v_healed) = 0 then
    perform public.tinker_notify(
      p_title => 'My page would not load for Jared',
      p_body => 'The permissions and policies on my four tables look right, but the page still could not read them. Last error: ' ||
                left(regexp_replace(coalesce(p_load_error, 'none given'), '\s+', ' ', 'g'), 160) || '. I am checking again on my next round.',
      p_severity => 'warning', p_url => '/admin/home-hub/automations', p_dedupe => 'pagecheck.load.' || v_hour);
  end if;

  v_summary := case
    when cardinality(v_problems) > 0 then 'page check found a problem: ' || array_to_string(v_problems, '; ')
    when cardinality(v_healed) > 0 then 'page check healed the grant on ' || array_to_string(v_healed, ' and ')
    else 'page check ok' end;

  return jsonb_build_object('ok', cardinality(v_problems) = 0, 'checked', to_jsonb(v_checked), 'healed', to_jsonb(v_healed),
                            'problems', to_jsonb(v_problems), 'summary', v_summary);
end $$;

revoke all on function public.tinker_page_check(boolean, text) from public, anon;
grant execute on function public.tinker_page_check(boolean, text) to authenticated, service_role;

