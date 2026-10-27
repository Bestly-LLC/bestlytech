-- Vera: a check with no finding behind it (domain expiry, listing) that fails on its very first run is news, not a baseline.
-- Same function as before with one condition added: f.key is null.
create or replace function public.compliance_check_report(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; c public.compliance_checks; f public.compliance_findings; v_ok boolean; v_detail text;
  v_new text[] := '{}'; v_again text[] := '{}'; v_back text[] := '{}'; v_broke text[] := '{}';
  v_total int := 0; v_failed int := 0; v_err int := 0; v_base int := 0; v_days int; v_target int; v_name text;
  v_kind text := coalesce(p->>'kind', 'daily'); v_run bigint; v_fixed int := 0; v_reopened int := 0; k text; v_sum text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'not allowed';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p->'results', '[]'::jsonb)) loop
    select * into c from public.compliance_checks where id = r->>'id';
    if not found then continue; end if;
    v_total := v_total + 1;
    v_ok := case when r->>'ok' is null or r->>'ok' = 'null' then null else (r->>'ok')::boolean end;
    v_detail := left(coalesce(r->>'detail', ''), 600);
    v_name := coalesce(c.finding_key || ' ', '') || c.title;
    select * into f from public.compliance_findings where key = c.finding_key;

    if v_ok is null then                                  -- the check could not run (not a failure of the thing checked)
      v_err := v_err + 1;
      update public.compliance_checks set last_run_at = now(), last_detail = v_detail, errors = errors + 1 where id = c.id;
      if c.errors + 1 = 3 then v_broke := v_broke || (c.id); end if;
    elsif v_ok then
      if c.last_ok is false then v_back := v_back || v_name; end if;
      update public.compliance_checks set last_run_at = now(), last_ok = true, last_detail = v_detail, fails = 0, errors = 0,
             first_fail_at = null, alert_stage = 0, ok_since = case when c.last_ok then coalesce(c.ok_since, now()) else now() end
       where id = c.id;
    else
      v_failed := v_failed + 1;
      update public.compliance_checks set last_run_at = now(), last_ok = false, last_detail = v_detail, fails = fails + 1, errors = 0,
             first_fail_at = case when c.last_ok is false then coalesce(c.first_fail_at, now()) else now() end,
             ok_since = null
       where id = c.id;
      if f.status = 'accepted' then
        null;                                             -- Jared accepted this risk: record it, do not raise it
      elsif c.last_ok is null then                        -- first ever run: a known finding is a baseline, a fixed one is a regression
        if f.status = 'fixed' or f.key is null then   -- a regression, or a check with no known finding behind it: news
          v_new := v_new || v_name;
          update public.compliance_checks set alert_stage = 1 where id = c.id;
        else
          v_base := v_base + 1;
          update public.compliance_checks set alert_stage = 1 where id = c.id;
        end if;
      elsif c.last_ok then                                -- passing yesterday, failing today
        v_new := v_new || v_name;
        update public.compliance_checks set alert_stage = 1 where id = c.id;
      else                                                -- still failing: 3 / 6 / 9 days, then quiet
        v_days := floor(extract(epoch from (now() - coalesce(c.first_fail_at, now()))) / 86400);
        v_target := case when v_days >= 9 then 4 when v_days >= 6 then 3 when v_days >= 3 then 2 else 1 end;
        if v_target > c.alert_stage then
          v_again := v_again || (v_name || ' (' || v_days || ' days)');
          update public.compliance_checks set alert_stage = v_target where id = c.id;
        end if;
      end if;
    end if;
  end loop;

  -- findings follow their checks: a failing check on a fixed finding reopens it; 3 clean days turns watching into fixed
  for k in select distinct finding_key from public.compliance_checks where finding_key is not null and last_run_at > now() - interval '1 hour' loop
    select * into f from public.compliance_findings where key = k;
    if exists (select 1 from public.compliance_checks where finding_key = k and active and last_ok is false) then
      update public.compliance_findings set last_seen = now() where key = k;
      if f.status = 'fixed' then
        update public.compliance_findings set status = 'open', status_note = 'Reopened by Vera: its check failed again.', updated_at = now() where key = k;
        v_reopened := v_reopened + 1;
      end if;
    elsif not exists (select 1 from public.compliance_checks where finding_key = k and active and last_ok is not true) then
      update public.compliance_findings set last_check_ok_at = now() where key = k;
      if f.status = 'watching' and not exists (select 1 from public.compliance_checks
            where finding_key = k and active and (ok_since is null or ok_since > now() - interval '3 days')) then
        update public.compliance_findings set status = 'fixed', updated_at = now(),
               status_note = 'Vera: every check passed for 3 days in a row.' where key = k;
        v_fixed := v_fixed + 1;
      end if;
    end if;
  end loop;

  v_sum := format('%s checks: %s passing, %s failing (%s known), %s could not run; %s new, %s again, %s back; %s findings closed, %s reopened',
                  v_total, v_total - v_failed - v_err, v_failed, v_base, v_err, cardinality(v_new), cardinality(v_again),
                  cardinality(v_back), v_fixed, v_reopened);
  if not coalesce((p->>'dry')::boolean, false) then
    insert into public.compliance_runs (kind, started_at, finished_at, checks, failed, errored, summary)
    values (v_kind, coalesce((p->>'started_at')::timestamptz, now()), now(), v_total, v_failed, v_err, v_sum) returning id into v_run;

    if cardinality(v_new) > 0 then
      perform public.compliance_alert('compliance.new.' || to_char(now(), 'YYYYMMDDHH24'),
        cardinality(v_new) || ' compliance check(s) newly failing',
        array_to_string(v_new[1:6], E'\n') || case when cardinality(v_new) > 6 then E'\n+' || (cardinality(v_new) - 6) || ' more' else '' end
          || E'\nOpen Admin, Security, Compliance for what to do.');
    end if;
    if cardinality(v_again) > 0 then
      perform public.compliance_alert('compliance.again.' || to_char(now(), 'YYYYMMDD'),
        cardinality(v_again) || ' compliance check(s) still failing',
        array_to_string(v_again[1:6], E'\n') || E'\nI re-raise at 3, 6 and 9 days, then stay quiet.');
    end if;
    if cardinality(v_back) > 0 or v_fixed > 0 then
      perform public.compliance_alert('compliance.back.' || to_char(now(), 'YYYYMMDD'),
        'Good news: ' || (cardinality(v_back) + v_fixed) || ' compliance check(s) passing again',
        coalesce(array_to_string(v_back[1:6], E'\n'), ''));
    end if;
    if cardinality(v_broke) > 0 then
      perform public.compliance_alert('compliance.broken.' || to_char(now(), 'YYYYMMDD'),
        cardinality(v_broke) || ' compliance check(s) could not run 3 times in a row',
        array_to_string(v_broke[1:8], E', ') || E'\nThe page or API they read may have moved. I keep trying.');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'run', v_run, 'summary', v_sum, 'new', v_new, 'again', v_again, 'back', v_back,
                            'broke', v_broke, 'baseline', v_base);
end $$;
revoke all on function public.compliance_check_report(jsonb) from public, anon, authenticated;
grant execute on function public.compliance_check_report(jsonb) to service_role;
