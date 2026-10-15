-- Fix two failing pg_cron jobs (found in cron.job_run_details, last 24h, 2026-10-15).
--
-- 1. security-recheck (jobid 56) -> public.security_recheck_tick()
--    "malformed array literal: Content-Security-Policy": `text[] || 'literal'` makes Postgres read the
--    untyped literal as an ARRAY literal. Every append to v_missing now casts the literal to ::text.
--    Only bites when a probed site is missing a header, so it failed in bursts, not on every run.
--
-- 2. studio-autopost-tick (jobid 250): "operator does not exist: text ->> unknown" came from
--    studio_cal_clear_uncleared() (unparenthesised `m->>'who' || ': ' || m->>'what'`, where || and ->>
--    share precedence). The parenthesised fix already shipped in 20261014075500_studio_weekly_cap.sql and
--    is live; the job has succeeded on every run since 2026-10-14 07:50 UTC. Nothing to change here.
--
-- 3. studio-ui-contract-check (jobid 85) -> public.studio_ui_contract_check()
--    "function name public.studio_house_post is not unique": the check's self-heal ran
--    `grant execute on function public.%I` with no argument list, which is ambiguous while two
--    studio_house_post overloads exist. It now grants per overload (by regprocedure), and only on the
--    overload(s) whose parameter names cover every p_* key the page sends, so the legacy
--    (text, uuid, timestamptz, text) overload is NOT re-opened to anon. No overload is dropped here.
--
-- Signatures, SECURITY DEFINER, search_path and grants (postgres + service_role only) are unchanged.

create or replace function public.security_recheck_tick()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_pass    text[] := '{}';
  v_checked int := 0;
  v_sent    int := 0;
  v_run     uuid;
  v_red     int;
  v_yellow  int;
  f         security_findings;
  r         record;
  k         text;
  v_missing text[];
  v_csp     text;
  v_xfo     text;
  v_xcto    text;
  v_rp      text;
  v_spf_ok  boolean;
  v_dmarc_ok boolean;
  v_host    text;
  v_fn      text;
  v_id      bigint;
  v_summary jsonb;
begin
  if not (session_user in ('postgres','supabase_admin') or coalesce(auth.role(),'') = 'service_role') then
    raise exception 'not allowed';
  end if;

  -- 1. SQL-only class: anon-callable writer RPCs in THIS project.
  -- Pass ONLY when anon can no longer execute at all. has_function_privilege accounts
  -- for PUBLIC grants, which a proacl/aclexplode check misses. An in-body auth fix is
  -- left to the nightly, so the two can never disagree about the same finding.
  for r in
    select id, key from security_findings
    where status = 'open' and key like 'supa:Bestly:rpc:anon_writer:%'
  loop
    v_fn := substring(r.key from 'rpc:anon_writer:(.*)$');
    v_checked := v_checked + 1;
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_fn
        and has_function_privilege('anon', p.oid, 'EXECUTE')
    ) then
      v_pass := v_pass || r.key::text;
    end if;
  end loop;

  -- 2a. collect header probes
  for r in
    select pr.finding_key, resp.status_code, resp.headers, resp.timed_out, resp.error_msg
    from security_recheck_probe pr
    join net._http_response resp on resp.id = pr.request_id
    where pr.kind = 'header'
  loop
    v_checked := v_checked + 1;
    if r.timed_out or r.error_msg is not null or r.status_code is null
       or r.status_code < 200 or r.status_code >= 400 then
      continue;
    end if;
    v_csp  := r.headers->>'content-security-policy';
    v_xfo  := r.headers->>'x-frame-options';
    v_xcto := r.headers->>'x-content-type-options';
    v_rp   := r.headers->>'referrer-policy';
    v_missing := '{}';
    if v_csp is null or btrim(v_csp) = '' then
      v_missing := v_missing || 'Content-Security-Policy'::text; end if;
    if (v_xfo is null or btrim(v_xfo) = '')
       and (v_csp is null or position('frame-ancestors' in lower(v_csp)) = 0) then
      v_missing := v_missing || 'X-Frame-Options (or CSP frame-ancestors)'::text; end if;
    if v_xcto is null or lower(btrim(v_xcto)) not like 'nosniff%' then
      v_missing := v_missing || 'X-Content-Type-Options: nosniff'::text; end if;
    if v_rp is null or btrim(v_rp) = '' then
      v_missing := v_missing || 'Referrer-Policy'::text; end if;
    if coalesce(array_length(v_missing,1),0) = 0 then
      v_pass := v_pass || r.finding_key::text; end if;
  end loop;

  -- 2b. collect email-auth probes (needs BOTH answers before it may judge)
  for r in
    select pr.finding_key,
           bool_and(resp.status_code = 200 and not resp.timed_out and resp.error_msg is null) as clean,
           max(case when pr.kind='spf'   then resp.content end) as spf_body,
           max(case when pr.kind='dmarc' then resp.content end) as dmarc_body
    from security_recheck_probe pr
    join net._http_response resp on resp.id = pr.request_id
    where pr.kind in ('spf','dmarc')
    group by pr.finding_key
    having count(*) = 2
  loop
    v_checked := v_checked + 1;
    continue when not coalesce(r.clean, false);
    if (r.spf_body::jsonb->>'Status') <> '0' or (r.dmarc_body::jsonb->>'Status') <> '0' then
      continue; end if;
    select coalesce(bool_or(lower(btrim(replace(a->>'data','"',''))) like 'v=spf1%'), false) into v_spf_ok
      from jsonb_array_elements(coalesce(r.spf_body::jsonb->'Answer','[]'::jsonb)) a;
    select coalesce(bool_or(lower(btrim(replace(a->>'data','"',''))) like 'v=dmarc1%'), false) into v_dmarc_ok
      from jsonb_array_elements(coalesce(r.dmarc_body::jsonb->'Answer','[]'::jsonb)) a;
    if v_spf_ok and v_dmarc_ok then
      v_pass := v_pass || r.finding_key::text; end if;
  end loop;

  delete from security_recheck_probe pr
   where exists (select 1 from net._http_response resp where resp.id = pr.request_id)
      or pr.dispatched_at < now() - interval '10 minutes';

  -- 3. close what passed
  v_pass := array(select distinct unnest(v_pass));
  if coalesce(array_length(v_pass,1),0) > 0 then
    v_run := security_run_start('manual',
      jsonb_build_object('mode','continuous_recheck','scope','open findings only','automated',true));
    foreach k in array v_pass loop
      select * into f from security_findings where key = k and status = 'open';
      if f.id is not null then
        perform security_check(v_run, f.key, 'pass', f.layer, f.asset, f.check_name, f.title, null, null, '{}'::jsonb);
      end if;
    end loop;
    select count(*) filter (where severity='red'), count(*) filter (where severity='yellow')
      into v_red, v_yellow from security_findings where status = 'open';
    update security_audit_runs
       set finished_at = now(),
           status = case when v_red > 0 then 'red' when v_yellow > 0 then 'yellow' else 'green' end,
           open_red = v_red, open_yellow = v_yellow,
           summary = 'Automatic re-check (every 5 min, close-only): verified '
                     || array_length(v_pass,1) || ' finding(s) genuinely fixed and closed them.'
     where id = v_run;
    insert into security_audit_log(run_id, actor, action, after, note)
      values (v_run, 'audit', 'run_finished',
              jsonb_build_object('status', case when v_red>0 then 'red' when v_yellow>0 then 'yellow' else 'green' end,
                                 'open_red', v_red, 'open_yellow', v_yellow, 'fixed', array_length(v_pass,1)),
              'continuous re-check (close-only)');
    if v_red = 0 then
      perform bestly_raise('security.red','resolved','info','No red security findings', null, 'security');
    end if;
  end if;

  -- 4. dispatch next round
  for r in
    select key from security_findings
    where status = 'open'
      and (key like 'web:%:headers' or key like 'dns:%:email_auth')
      and not exists (
        select 1 from security_recheck_probe pr
        where pr.finding_key = security_findings.key
          and pr.dispatched_at > now() - interval '10 minutes')
    limit 40
  loop
    v_host := split_part(r.key, ':', 2);
    if v_host is null or v_host = '' then continue; end if;
    if r.key like 'web:%' then
      v_id := net.http_get('https://' || v_host || '/', timeout_milliseconds := 8000);
      insert into security_recheck_probe(request_id, finding_key, kind, target) values (v_id, r.key, 'header', v_host);
      v_sent := v_sent + 1;
    else
      v_id := net.http_get('https://dns.google/resolve?name=' || v_host || '&type=TXT', timeout_milliseconds := 8000);
      insert into security_recheck_probe(request_id, finding_key, kind, target) values (v_id, r.key, 'spf', v_host);
      v_id := net.http_get('https://dns.google/resolve?name=_dmarc.' || v_host || '&type=TXT', timeout_milliseconds := 8000);
      insert into security_recheck_probe(request_id, finding_key, kind, target) values (v_id, r.key, 'dmarc', v_host);
      v_sent := v_sent + 2;
    end if;
  end loop;

  v_summary := jsonb_build_object('checked', v_checked, 'closed', coalesce(array_length(v_pass,1),0),
    'closed_keys', to_jsonb(v_pass), 'probes_sent', v_sent,
    'open_after', (select count(*) from security_findings where status='open'));
  update security_recheck_state set last_ran_at = now(), last_summary = v_summary where id = true;
  return v_summary;
end $function$;

create or replace function public.studio_ui_contract_check()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; m text[]; v_name text; v_keys text[]; v_bad text[] := '{}'; v_fixed text[] := '{}';
        v_known text[]; v_n int; v_files int := 0; k text; o oid;
begin
  for r in select distinct on (f.file) f.file, h.content
             from public.studio_ui_contract_fetch f join net._http_response h on h.id = f.req
            where f.at > now() - interval '3 hours' and h.status_code = 200
            order by f.file, f.at desc loop
    v_files := v_files + 1;
    for m in select regexp_matches(r.content, 'rpc\("([a-z_0-9]+)",\s*\{([^{}]*)\}', 'g') loop
      v_name := m[1];
      select array_agg(distinct x[1]) into v_keys from regexp_matches(m[2], '(?:^|[,{\s])(p_[a-z_0-9]+)\s*(?=[:,}]|$)', 'g') x;
      select count(*) into v_n from pg_proc where proname = v_name and pronamespace = 'public'::regnamespace;
      if v_n = 0 then v_bad := v_bad || (v_name || ': no such function'); continue; end if;
      if v_n > 1 then v_bad := v_bad || (v_name || ': ' || v_n || ' overloads — calls can fail as ambiguous'); end if;
      -- Grant per overload (a bare name is ambiguous when overloads exist), and only on the overload(s)
      -- that accept every key the page sends, so an intentionally locked-down legacy overload stays locked.
      for o in
        select p.oid from pg_proc p
         where p.proname = v_name and p.pronamespace = 'public'::regnamespace
           and coalesce(p.proargnames, '{}'::text[]) @> coalesce(v_keys, '{}'::text[])
           and not has_function_privilege('anon', p.oid, 'execute')
      loop
        execute format('grant execute on function %s to anon, authenticated', o::regprocedure);
        v_fixed := v_fixed || (o::regprocedure::text || ': execute granted');
      end loop;
      select array_agg(distinct a) into v_known from pg_proc p, unnest(p.proargnames) a
       where p.proname = v_name and p.pronamespace = 'public'::regnamespace;
      foreach k in array coalesce(v_keys, '{}') loop
        if not (k = any(coalesce(v_known, '{}'))) then v_bad := v_bad || (v_name || ': the page sends ' || k || ', the function has no such parameter (' || r.file || ')'); end if;
      end loop;
    end loop;
  end loop;
  select array_agg(distinct x) into v_bad from unnest(v_bad) x;
  if v_files = 0 then
    perform public.bestly_raise('studio:ui-contract', 'problem', 'warn', 'UI contract check could not read the live files', 'studio_ui_contract_request fetched nothing in the last 3 hours.', 'ops');
  elsif coalesce(array_length(v_bad, 1), 0) > 0 then
    perform public.bestly_raise('studio:ui-contract', 'problem', 'warn',
      array_length(v_bad, 1) || ' Studio/board call(s) will fail', array_to_string(v_bad, E'\n'), 'ops');
  else
    perform public.bestly_raise('studio:ui-contract', 'resolved', 'info', 'Every Studio and board call matches the database', null, 'ops');
  end if;
  return jsonb_build_object('ok', true, 'files', v_files, 'problems', to_jsonb(coalesce(v_bad, '{}')), 'fixed', to_jsonb(v_fixed));
end $function$;
