-- Ares's Auto-Fixer also locks "SECURITY DEFINER writer callable by anon" findings (check anon_rpc_writers), the same
-- way it locks anon_rpc ones: revoke from public + anon, keep authenticated + service_role, undo saved. Found on the
-- 2026-10-06 self-check: ava_live_register() was handed to Jared because only anon_rpc was handled. Its only callers
-- are SECURITY DEFINER triggers on ava_calls / rg_calls, which run as the owner, so the lock is safe.
-- Writers already handed over with "no automatic fix" are picked up again on the next run.
create or replace function public.security_autofix() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  f record; p record; fn text; n int; done_ int := 0; dismissed int := 0; handed int := 0; days int;
  v_do text; v_undo text; v_undo_all text; v_names text;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') and not coalesce(has_role(auth.uid(), 'admin'), false) then
    raise exception 'not allowed';
  end if;
  if not coalesce((select enabled and security_autofix from autonomy_settings where id), false) then
    return '{"off":true}'::jsonb;
  end if;

  for f in select * from security_findings
            where status = 'open' and (coalesce(autofix->>'state', '') not in ('needs_person', 'watching_until')
                   or (check_name = 'anon_rpc_writers' and autofix->>'state' = 'needs_person' and coalesce(autofix->>'reason', '') !~ '^Ares tried'))
            order by severity desc, first_seen
  loop
    begin
      if f.check_name in ('anon_rpc', 'anon_rpc_writers') then
        fn := substring(f.title from '^([a-z0-9_]+)\(');
        if fn is null then
          update security_findings set autofix = jsonb_build_object('state', 'needs_person', 'at', now(),
            'reason', 'Ares could not read the function name from this finding.') where id = f.id;
          handed := handed + 1; continue;
        end if;
        if exists (select 1 from security_public_rpcs where security_public_rpcs.fn = substring(f.title from '^([a-z0-9_]+)\(')) then
          perform security_finding_set_status(f.id, 'dismissed',
            'Ares: public on purpose. Devices and guest pages call it with the public key, and it checks its own input.');
          insert into security_autofix_log (finding_key, action, ok, note) values (f.key, 'dismiss_public', true, fn);
          dismissed := dismissed + 1; continue;
        end if;
        n := 0; v_undo_all := '';
        for p in select pr.oid::regprocedure as sig from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
                  where ns.nspname = 'public' and pr.proname = fn
        loop
          v_do := format('revoke execute on function %s from public, anon; grant execute on function %s to authenticated, service_role', p.sig, p.sig);
          v_undo := format('grant execute on function %s to anon', p.sig);
          execute v_do;
          insert into security_autofix_log (finding_key, action, do_sql, undo_sql, ok, note) values (f.key, 'lock_anon', v_do, v_undo, true, fn);
          v_undo_all := v_undo_all || v_undo || '; ';
          n := n + 1;
        end loop;
        if n = 0 then
          perform security_finding_set_status(f.id, 'fixed', 'Ares: the function no longer exists.');
        else
          update security_findings set autofix = jsonb_build_object('state', 'fixed', 'at', now(), 'undo', v_undo_all) where id = f.id;
          perform security_finding_set_status(f.id, 'fixed', 'Ares locked ' || fn || '() so the public key can no longer run it. Undo: ' || v_undo_all);
          insert into admin_notifications (kind, title, body, url, severity, silent, agent_slug, dedupe_key)
          values ('security', 'Ares: locked ' || fn || '() from anonymous callers',
                  'Only signed-in admins and Bestly''s own servers can run it now. Undo is saved.', '/admin/security',
                  'success', true, 'security-auditor', 'ares.lock.' || fn || '.' || to_char(now(), 'YYYYMMDD'))
          on conflict (dedupe_key) do nothing;
        end if;
        done_ := done_ + 1;

      elsif f.check_name = 'advisor' and f.title ~* 'mutable search_path' then
        n := 0; v_names := '';
        for p in select pr.oid::regprocedure as sig, pr.proname from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
                  where ns.nspname = 'public' and pr.prokind = 'f'
                    and not exists (select 1 from pg_depend d where d.objid = pr.oid and d.deptype = 'e')
                    and not exists (select 1 from unnest(coalesce(pr.proconfig, '{}'::text[])) c where c like 'search_path=%')
        loop
          begin
            v_do := format('alter function %s set search_path = public, extensions, pg_temp', p.sig);
            v_undo := format('alter function %s reset search_path', p.sig);
            execute v_do;
            insert into security_autofix_log (finding_key, action, do_sql, undo_sql, ok, note) values (f.key, 'pin_search_path', v_do, v_undo, true, p.proname);
            n := n + 1;
          exception when others then
            insert into security_autofix_log (finding_key, action, do_sql, ok, note) values (f.key, 'pin_search_path', v_do, false, left(sqlerrm, 200));
          end;
        end loop;
        update security_findings set autofix = jsonb_build_object('state', 'fixed', 'at', now(), 'count', n) where id = f.id;
        perform security_finding_set_status(f.id, 'fixed', 'Ares pinned the search path on ' || n || ' functions (public, extensions). Undo per function in security_autofix_log.');
        insert into admin_notifications (kind, title, body, url, severity, silent, agent_slug, dedupe_key)
        values ('security', 'Ares: pinned the search path on ' || n || ' database functions',
                'Closes the "mutable search_path" warning. Behavior is unchanged; undo is saved for each one.', '/admin/security',
                'success', true, 'security-auditor', 'ares.searchpath.' || to_char(now(), 'YYYYMMDDHH24'))
        on conflict (dedupe_key) do nothing;
        done_ := done_ + 1;

      elsif f.check_name = 'domain_expiry' then
        days := nullif(substring(f.title from 'expires in ([0-9]+) day'), '')::int;
        if days is not null and days > 30 then
          update security_findings set autofix = jsonb_build_object('state', 'watching', 'at', now(),
            'reason', 'More than 30 days left. Ares will hand it to you at 30 days if auto-renew is still off.') where id = f.id;
        else
          update security_findings set autofix = jsonb_build_object('state', 'needs_person', 'at', now(),
            'reason', 'Turn on auto-renew at the registrar. Ares cannot sign in to the registrar.') where id = f.id;
          handed := handed + 1;
        end if;

      elsif f.nights_open >= 1 then
        update security_findings set autofix = jsonb_build_object('state', 'needs_person', 'at', now(),
          'reason', coalesce(f.proposed_fix, 'Ares has no automatic fix for this kind of finding yet.')) where id = f.id;
        handed := handed + 1;
      end if;
    exception when others then
      update security_findings set autofix = jsonb_build_object('state', 'needs_person', 'at', now(),
        'reason', 'Ares tried and hit an error: ' || left(sqlerrm, 200)) where id = f.id;
      insert into security_autofix_log (finding_key, action, ok, note) values (f.key, 'error', false, left(sqlerrm, 300));
      handed := handed + 1;
    end;
  end loop;

  if handed > 0 then
    perform scout_notify('Ares couldn''t fix a security issue',
      handed || ' item(s) need you. They are in Needs you with the exact step.', 'warning', true, '/admin/security',
      'ares.handed.' || to_char(now(), 'YYYYMMDDHH24'));
    update admin_notifications set agent_slug = 'security-auditor'
     where dedupe_key = 'ares.handed.' || to_char(now(), 'YYYYMMDDHH24');
  end if;

  perform agent_beat('security-auditor', true, format('Auto-fix: %s fixed, %s public on purpose, %s handed to Jared', done_, dismissed, handed), null);
  return jsonb_build_object('fixed', done_, 'dismissed_public', dismissed, 'handed_to_person', handed);
end $$;
