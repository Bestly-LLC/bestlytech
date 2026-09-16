-- Cookie Yeti Auto-Fix: before a stuck domain is shown to a human, cy-autofix
-- renders it (fra1 Chromium), feeds the AI, and tests the result. These columns
-- record what that run found so the admin can say exactly what to do next.
alter table public.missed_banner_reports
  add column if not exists autofix_last_at timestamptz,
  add column if not exists autofix_outcome text,
  add column if not exists autofix_note text,
  add column if not exists autofix_runs integer not null default 0;

comment on column public.missed_banner_reports.autofix_outcome is
  'Last cy-autofix result: fixed | fixed_unverified | wrong_site | blocked | no_banner_seen | ai_failed | ai_wrong | running';

create or replace view public.v_cookieyeti_needs_attention with (security_invoker = true) as
select id, domain, report_count, ai_attempts, render_attempts, last_reported, page_url,
  case
    when coalesce(render_attempts, 0) >= 3 then 'render_exhausted'
    when coalesce(ai_attempts, 0) >= 4 then 'ai_exhausted'
    else 'stuck'
  end as reason,
  autofix_outcome, autofix_note, autofix_last_at, autofix_runs
from public.missed_banner_reports r
where resolved = false
  and coalesce(has_working_pattern, false) = false
  and (coalesce(ai_attempts, 0) >= 4 or coalesce(render_attempts, 0) >= 3
       or autofix_outcome in ('blocked', 'no_banner_seen', 'ai_failed', 'ai_wrong'));
grant select on public.v_cookieyeti_needs_attention to authenticated;

-- Stuck domains the sweep should try next: never auto-fixed, or last tried over a week ago
-- with an outcome a fresh try could change.
create or replace function public.cy_autofix_candidates(p_limit int default 1)
returns setof text language sql stable security definer set search_path = public
as $$
  select domain from public.v_cookieyeti_needs_attention
  where autofix_outcome is null
     or (autofix_outcome = 'running' and autofix_last_at < now() - interval '10 minutes')
     or (autofix_outcome in ('blocked','no_banner_seen','ai_failed','ai_wrong') and autofix_last_at < now() - interval '7 days')
  order by (autofix_outcome is null) desc, report_count desc
  limit greatest(1, least(p_limit, 5))
$$;
revoke all on function public.cy_autofix_candidates(int) from public, anon, authenticated;
grant execute on function public.cy_autofix_candidates(int) to service_role;

-- A real report with banner HTML from someone's browser is the thing Auto-Fix asked
-- for: give the domain a clean slate so it leaves "Your turn" and the AI retries.
CREATE OR REPLACE FUNCTION public.report_missed_banner_with_html(_domain text, _page_url text DEFAULT NULL::text, _banner_html text DEFAULT NULL::text, _cmp_fingerprint text DEFAULT 'unknown'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- CY-PRIV: strip any path/query/fragment so only the site origin is persisted.
  IF _page_url IS NOT NULL AND btrim(_page_url) <> '' THEN
    IF _page_url ~ '://' THEN
      _page_url := regexp_replace(_page_url, '^([a-zA-Z][a-zA-Z0-9+.-]*://[^/?#]+).*$', '\1');
    ELSE
      _page_url := regexp_replace(_page_url, '^([^/?#]+).*$', '\1');
    END IF;
  ELSE
    _page_url := NULL;
  END IF;

  INSERT INTO missed_banner_reports (domain, page_url, banner_html, cmp_fingerprint, report_count, last_reported)
  VALUES (_domain, _page_url, left(_banner_html, 5000), _cmp_fingerprint, 1, now())
  ON CONFLICT (domain) DO UPDATE SET
    report_count = missed_banner_reports.report_count + 1,
    last_reported = now(),
    page_url = COALESCE(EXCLUDED.page_url, missed_banner_reports.page_url),
    cmp_fingerprint = CASE WHEN EXCLUDED.cmp_fingerprint != 'unknown' THEN EXCLUDED.cmp_fingerprint ELSE missed_banner_reports.cmp_fingerprint END,
    banner_html = CASE WHEN length(COALESCE(EXCLUDED.banner_html, '')) > length(COALESCE(missed_banner_reports.banner_html, '')) THEN left(EXCLUDED.banner_html, 5000) ELSE missed_banner_reports.banner_html END,
    resolved = false,
    has_working_pattern = false;

  IF _banner_html IS NOT NULL AND LENGTH(TRIM(_banner_html)) > 50 THEN
    DELETE FROM ai_generation_log
    WHERE domain = _domain
    AND status = 'skipped_no_html';

    UPDATE missed_banner_reports
    SET ai_attempts = 0, ai_processed_at = NULL, render_attempts = 0,
        autofix_outcome = NULL, autofix_note = NULL
    WHERE domain = _domain
    AND (ai_attempts > 0 OR render_attempts > 0 OR autofix_outcome IS NOT NULL);
  END IF;
END;
$function$;

-- Sweep: one stuck domain every 15 minutes gets the full render -> AI -> test pass.
select cron.unschedule('cy-autofix-sweep') where exists (select 1 from cron.job where jobname = 'cy-autofix-sweep');
select cron.schedule('cy-autofix-sweep', '7-59/15 * * * *',
  $$ select public.invoke_edge_function('cy-autofix', '{"sweep":true}'::jsonb, 150000) $$);
