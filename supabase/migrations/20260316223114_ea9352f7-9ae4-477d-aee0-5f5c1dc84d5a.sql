
-- Fix search_path on all remaining functions

CREATE OR REPLACE FUNCTION public.get_unresolved_reports(p_limit integer DEFAULT 50)
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
  FROM (SELECT domain, report_count, has_working_pattern, last_reported, created_at
    FROM missed_banner_reports WHERE resolved = false
    ORDER BY report_count DESC, last_reported DESC LIMIT p_limit) t;
$function$;

CREATE OR REPLACE FUNCTION public.get_cmp_distribution()
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT cmp_fingerprint, count(*) AS pattern_count, count(DISTINCT domain) AS domain_count, round(avg(confidence)::numeric, 3) AS avg_confidence, CASE WHEN sum(report_count) > 0 THEN round((sum(success_count)::numeric / sum(report_count)::numeric) * 100, 1) ELSE 0 END AS success_rate FROM cookie_patterns GROUP BY cmp_fingerprint ORDER BY pattern_count DESC) t; $function$;

CREATE OR REPLACE FUNCTION public.get_community_overview()
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT json_build_object('total_patterns', (SELECT count(*) FROM cookie_patterns), 'total_domains', (SELECT count(DISTINCT domain) FROM cookie_patterns), 'high_confidence', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0.8), 'low_confidence', (SELECT count(*) FROM cookie_patterns WHERE confidence < 0.4), 'avg_confidence', (SELECT round(avg(confidence)::numeric, 3) FROM cookie_patterns), 'total_reports', (SELECT coalesce(sum(report_count), 0) FROM cookie_patterns), 'total_successes', (SELECT coalesce(sum(success_count), 0) FROM cookie_patterns), 'overall_success_rate', (SELECT CASE WHEN sum(report_count) > 0 THEN round((sum(success_count)::numeric / sum(report_count)::numeric) * 100, 1) ELSE 0 END FROM cookie_patterns), 'patterns_last_24h', (SELECT count(*) FROM cookie_patterns WHERE last_seen >= now() - interval '24 hours'), 'patterns_last_7d', (SELECT count(*) FROM cookie_patterns WHERE last_seen >= now() - interval '7 days'), 'new_domains_last_7d', (SELECT count(DISTINCT domain) FROM cookie_patterns WHERE created_at >= now() - interval '7 days'), 'stale_patterns', (SELECT count(*) FROM cookie_patterns WHERE last_seen < now() - interval '30 days')); $function$;

CREATE OR REPLACE FUNCTION public.get_daily_pattern_activity(p_days integer DEFAULT 30)
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT d::date AS date, (SELECT count(*) FROM cookie_patterns WHERE created_at::date = d::date) AS new_patterns, (SELECT count(DISTINCT domain) FROM cookie_patterns WHERE created_at::date = d::date) AS new_domains, (SELECT count(*) FROM cookie_patterns WHERE last_seen::date = d::date) AS active_patterns FROM generate_series((now() - make_interval(days => p_days))::date, now()::date, '1 day'::interval) AS d ORDER BY d) t; $function$;

CREATE OR REPLACE FUNCTION public.get_top_domains(p_limit integer DEFAULT 25)
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT domain, count(*) AS pattern_count, round(avg(confidence)::numeric, 3) AS avg_confidence, coalesce(sum(report_count), 0) AS total_reports, coalesce(sum(success_count), 0) AS total_successes, CASE WHEN sum(report_count) > 0 THEN round((sum(success_count)::numeric / sum(report_count)::numeric) * 100, 1) ELSE 0 END AS success_rate, max(last_seen) AS last_active FROM cookie_patterns GROUP BY domain ORDER BY pattern_count DESC LIMIT p_limit) t; $function$;

CREATE OR REPLACE FUNCTION public.get_recently_learned(p_limit integer DEFAULT 50)
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT domain, selector, action_type, cmp_fingerprint, confidence, report_count, success_count, source, created_at, last_seen FROM cookie_patterns ORDER BY created_at DESC LIMIT p_limit) t; $function$;

CREATE OR REPLACE FUNCTION public.get_pattern_issues(p_limit integer DEFAULT 50)
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT domain, selector, action_type, confidence, report_count, success_count, CASE WHEN sum(report_count) OVER () > 0 THEN round((success_count::numeric / NULLIF(report_count, 0)::numeric) * 100, 1) ELSE 0 END AS success_rate, last_seen, CASE WHEN confidence < 0.3 THEN 'very_low_confidence' WHEN report_count > 5 AND success_count = 0 THEN 'never_succeeds' WHEN last_seen < now() - interval '30 days' THEN 'stale' WHEN report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2 THEN 'low_success_rate' ELSE 'other' END AS issue_type FROM cookie_patterns WHERE confidence < 0.4 OR (report_count > 5 AND success_count = 0) OR last_seen < now() - interval '30 days' OR (report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2) ORDER BY confidence ASC, report_count DESC LIMIT p_limit) t; $function$;

CREATE OR REPLACE FUNCTION public.get_action_type_stats()
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT action_type, count(*) AS count, round(avg(confidence)::numeric, 3) AS avg_confidence, coalesce(sum(report_count), 0) AS total_reports, coalesce(sum(success_count), 0) AS total_successes FROM cookie_patterns GROUP BY action_type ORDER BY count DESC) t; $function$;

CREATE OR REPLACE FUNCTION public.get_confidence_distribution()
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT bucket, label, count FROM (VALUES (0, '0.0-0.2', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0.0 AND confidence < 0.2)), (1, '0.2-0.4', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0.2 AND confidence < 0.4)), (2, '0.4-0.6', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0.4 AND confidence < 0.6)), (3, '0.6-0.8', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0.6 AND confidence < 0.8)), (4, '0.8-1.0', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0.8 AND confidence <= 1.0))) AS v(bucket, label, count) ORDER BY bucket) t; $function$;

CREATE OR REPLACE FUNCTION public.get_source_breakdown()
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT source, count(*) AS count, round(avg(confidence)::numeric, 3) AS avg_confidence, count(DISTINCT domain) AS domain_count FROM cookie_patterns GROUP BY source ORDER BY count DESC) t; $function$;
