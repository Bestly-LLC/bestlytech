-- Cookie Yeti public dashboard stats — corrected "sites analyzed" + CMP count.
--
-- Supersedes 20260529160000_cookie_yeti_public_dashboard_stats.sql. That version
-- computed sites_analyzed as count(DISTINCT domain) over ai_generation_log alone,
-- which under-counts: it ignores the domains where users successfully dismissed a
-- banner (dismissal_reports), the offender leaderboard (missed_banner_reports),
-- and shipped patterns (cookie_patterns). The true reach of the network is the
-- UNION of unique domains across all four tables (excluding the internal
-- '_system' sentinel). dismissal_reports is admin-read-only under RLS, so this
-- definer function is the ONLY way the public page can count those domains.
--
-- Also adds 'cmp_platforms_recognized': the number of consent-management
-- platforms the extension can fingerprint and auto-dismiss (OneTrust, Cookiebot,
-- Sourcepoint, Quantcast, TrustArc, Piano, Usercentrics, etc.). This is a product
-- capability constant, not telemetry — it conveys the SCOPE of protection, since
-- each platform is used by thousands of sites.

CREATE OR REPLACE FUNCTION public.get_cookie_yeti_public_stats()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'sites_analyzed', (
      SELECT count(*) FROM (
        SELECT lower(domain) AS d FROM cookie_patterns        WHERE domain IS NOT NULL AND domain <> '_system'
        UNION
        SELECT lower(domain)      FROM dismissal_reports       WHERE domain IS NOT NULL AND domain <> '_system'
        UNION
        SELECT lower(domain)      FROM missed_banner_reports   WHERE domain IS NOT NULL AND domain <> '_system'
        UNION
        SELECT lower(domain)      FROM ai_generation_log       WHERE domain IS NOT NULL AND domain <> '_system'
      ) all_domains
    ),
    'cmp_platforms_recognized', 17,
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
