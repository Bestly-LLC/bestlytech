-- 2026-09-23 9:45 PM PDT (Cowork): three watchdogs were raising false alarms. Applied live as migrations
-- keyswitch_judge_before_purge, ops_db_hygiene_keep_responses_75min, tesla_access_watchdog_ignore_driver_side.

-- 1. Hourly watchdogs judge net._http_response an hour after firing; a 20-minute purge made them read "no answer".
create or replace function public.ops_db_hygiene()
 returns jsonb language plpgsql security definer set search_path to 'public', 'net', 'cron'
as $function$
declare v_net int := 0; v_cron int := 0;
begin
  perform set_config('statement_timeout', '25s', true);
  with r as (select ctid from net._http_response where created < now() - interval '75 minutes' limit 20000)
  delete from net._http_response t using r where t.ctid = r.ctid;
  get diagnostics v_net = row_count;
  with r as (select ctid from cron.job_run_details where end_time < now() - interval '2 days' limit 20000)
  delete from cron.job_run_details t using r where t.ctid = r.ctid;
  get diagnostics v_cron = row_count;
  return jsonb_build_object('net_deleted', v_net, 'cron_deleted', v_cron);
end $function$;

-- 2. Judge the key-switch probes 5 minutes after they fire (:17), not an hour later.
create or replace function public.keyswitch_judge()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r record; bad text[] := '{}'; n int := 0;
begin
  for r in select p.id, p.probe, p.expect, h.status_code from keyswitch_probes p
           left join net._http_response h on h.id = p.request_id
           where p.checked_at is null and p.created_at < now() - interval '2 minutes' loop
    update keyswitch_probes set got = r.status_code, ok = (r.status_code = r.expect), checked_at = now() where id = r.id;
    n := n + 1;
    if r.status_code is distinct from r.expect then bad := bad || (r.probe || ' got ' || coalesce(r.status_code::text,'no answer') || ', expected ' || r.expect); end if;
  end loop;
  if array_length(bad,1) > 0 then
    perform scout_notify(p_title := 'New Supabase keys: a check failed',
      p_body := array_to_string(bad, E'\n') || E'\nIf the legacy keys were just turned off, turn them back on in Supabase > Settings > API Keys, then tell Scout.',
      p_severity := 'warning', p_push := true, p_url := '/admin', p_dedupe := 'keyswitch.' || to_char(now(),'YYYYMMDDHH24'));
  end if;
  return jsonb_build_object('judged', n, 'failed', bad);
end $$;
revoke all on function public.keyswitch_judge() from public, anon, authenticated;
update keyswitch_probes set checked_at = now() where checked_at is null and created_at < now() - interval '30 minutes';
select cron.unschedule(jobid) from cron.job where jobname = 'keyswitch-judge';
select cron.schedule('keyswitch-judge', '22 * * * *', 'select public.keyswitch_judge()');

-- 3. Tesla's driver-side notices ("You now have access to Jared's Model 3") name nobody; don't alarm on them.
create or replace function public.tesla_access_watchdog()
 returns text language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  perform tesla_app_access_parse(m) from bestly_mail m
   where m.from_addr = 'noreply@tesla.com' and m.subject ilike '%Vehicle App Access%' and m.ingested_at > now() - interval '2 days'
     and not exists (select 1 from tesla_app_access a where a.mail_id = m.id);
  select count(*) into n from bestly_mail m
   where m.from_addr = 'noreply@tesla.com' and m.subject ilike '%Vehicle App Access%' and m.ingested_at > now() - interval '2 days'
     and not exists (select 1 from tesla_app_access a where a.mail_id = m.id)
     and regexp_replace(coalesce(m.body_text, ''), '\s+', ' ', 'g') !~* '(You now have access to .{0,40}(Model|Tesla)|Your driver access has been removed)';
  if n > 0 then
    perform scout_notify('Can''t read Tesla "app access" emails', n || ' Tesla access email(s) didn''t match the expected wording, so guest A/C buttons can''t tell when a phone key is connected.', 'warning', true, '/admin/turo/lax-pass#tesla', 'tesla-access-parse-' || to_char(now(), 'YYYY-MM-DD'));
    return 'unparsed ' || n;
  end if;
  return 'ok';
end $function$;
