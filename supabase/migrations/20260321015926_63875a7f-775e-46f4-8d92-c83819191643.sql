
CREATE OR REPLACE FUNCTION public.get_daily_pattern_activity(p_days integer DEFAULT 30)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT
      d::date AS date,
      (SELECT count(*) FROM cookie_patterns WHERE created_at::date = d::date) AS new_patterns,
      (SELECT count(DISTINCT domain) FROM cookie_patterns WHERE created_at::date = d::date) AS new_domains,
      (SELECT count(*) FROM cookie_patterns WHERE last_seen::date = d::date) AS active_patterns,
      (SELECT coalesce(sum(report_count), 0) FROM missed_banner_reports WHERE last_reported::date = d::date) AS reports
    FROM generate_series(
      (now() - make_interval(days => p_days))::date,
      now()::date,
      '1 day'::interval
    ) AS d
    ORDER BY d
  ) t;
$$;
