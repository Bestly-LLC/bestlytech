-- Public Cookie Yeti dashboard stats.
--
-- Powers the no-login marketing/investor dashboard at /cookie-yeti/dashboard.
-- SECURITY DEFINER + granted to anon, so the page works without auth and never
-- exposes raw rows or PII (device emails, dismissal selectors, banner HTML) —
-- only aggregate counts, the non-sensitive offender leaderboard, the AI status
-- breakdown, and a weekly success-rate trend. Same shape as get_public_status().
--
-- Most source tables already allow anon SELECT (missed_banner_reports,
-- ai_generation_log, cookie_patterns, device_registrations), but dismissal_reports
-- is admin-read-only, so the live "banners dismissed" count is only reachable
-- through this definer function. The frontend prefers this RPC and falls back to
-- direct anon table queries if it isn't deployed yet.

CREATE OR REPLACE FUNCTION public.get_cookie_yeti_public_stats()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'sites_analyzed', (SELECT count(DISTINCT domain) FROM ai_generation_log),
    'ai_generations', (SELECT count(*) FROM ai_generation_log),
    'ai_success', (SELECT count(*) FROM ai_generation_log WHERE status = 'success'),
    'banners_dismissed', (SELECT count(*) FROM dismissal_reports),
    'devices_protected', (SELECT count(*) FROM device_registrations),
    'active_patterns', (SELECT count(*) FROM cookie_patterns),
    'offenders', (
      SELECT coalesce(json_agg(row_to_json(o)), '[]'::json)
      FROM (
        SELECT domain, report_count, cmp_fingerprint, has_working_pattern, resolved
        FROM missed_banner_reports
        ORDER BY report_count DESC
        LIMIT 10
      ) o
    ),
    'ai_status_breakdown', (
      SELECT coalesce(json_agg(row_to_json(s)), '[]'::json)
      FROM (
        SELECT status, count(*)::int AS count
        FROM ai_generation_log
        GROUP BY status
        ORDER BY count DESC
      ) s
    ),
    'ai_weekly', (
      SELECT coalesce(json_agg(row_to_json(w) ORDER BY w.week), '[]'::json)
      FROM (
        SELECT
          to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week,
          count(*)::int AS total,
          count(*) FILTER (WHERE status IN ('success', 'success_cmp_fallback'))::int AS success
        FROM ai_generation_log
        GROUP BY date_trunc('week', created_at)
      ) w
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_cookie_yeti_public_stats() FROM public;
GRANT EXECUTE ON FUNCTION public.get_cookie_yeti_public_stats() TO anon;
GRANT EXECUTE ON FUNCTION public.get_cookie_yeti_public_stats() TO authenticated;
