-- Cookie Yeti admin numbers that were wrong or capped. Idempotent.
--
-- What counts as a real AI attempt (checked against live distinct ai_generation_log.status values):
--   success : success, success_cmp_fallback, success_cmp_fingerprint, success_failsafe,
--             success_failsafe_autocorrected, success_gemini_failsafe
--   failure : needs_manual_review, error, failed, failed_not_cookie_banner,
--             rejected_dangerous_selector, generation_failed
--   ignored : success_consensus (report-dismissal, no AI call), success_probe, no_candidates,
--             skipped_* (incl. skipped_no_html), permanently_failed (retry bookkeeping; the failure
--             itself is already logged)
-- Counted once per domain per day: a domain that failed twice and then succeeded that day is one
-- successful attempt.

-- 1) Operations page: AI success rate + breakdown and distinct patterns fixed, without the
--    1,000-row cap the client-side queries hit.
CREATE OR REPLACE FUNCTION public.cy_operations_stats(p_days integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d int;
  v_since timestamptz;
  v_success text[] := ARRAY['success', 'success_cmp_fallback', 'success_cmp_fingerprint', 'success_failsafe',
                            'success_failsafe_autocorrected', 'success_gemini_failsafe'];
  v_failure text[] := ARRAY['needs_manual_review', 'error', 'failed', 'failed_not_cookie_banner',
                            'rejected_dangerous_selector', 'generation_failed'];
  result json;
BEGIN
  PERFORM public._cy_analytics_guard();
  d := greatest(1, least(coalesce(p_days, 30), 365));
  v_since := now() - make_interval(days => d);

  WITH attempts AS (
    SELECT domain,
           (created_at AT TIME ZONE 'UTC')::date AS day,
           bool_or(status = ANY (v_success)) AS ok,
           (array_agg(status ORDER BY (status = ANY (v_success)) DESC, created_at DESC))[1] AS status
      FROM ai_generation_log
     WHERE created_at >= v_since
       AND (status = ANY (v_success) OR status = ANY (v_failure))
     GROUP BY 1, 2
  )
  SELECT json_build_object(
    'days', d,
    'ai_attempts', (SELECT count(*) FROM attempts),
    'ai_successes', (SELECT count(*) FROM attempts WHERE ok),
    'ai_breakdown', coalesce((
      SELECT json_agg(json_build_object('status', status, 'count', n) ORDER BY n DESC)
        FROM (SELECT status, count(*)::int AS n FROM attempts GROUP BY status) b
    ), '[]'::json),
    'patterns_fixed', (
      SELECT count(DISTINCT (domain, selector))
        FROM pattern_fix_log
       WHERE created_at >= v_since
         AND success
         AND domain <> '_system'
         AND action_taken <> 'skipped'
    )
  ) INTO result;
  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.cy_operations_stats(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cy_operations_stats(integer) TO authenticated, service_role;

-- 2) Community Learning: token total (client summed a 1,000-row capped select) and the number of
--    domains that are permanently failed and still unresolved (client counted all-time log rows).
CREATE OR REPLACE FUNCTION public.cy_community_ai_totals()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result json;
BEGIN
  PERFORM public._cy_analytics_guard();
  SELECT json_build_object(
    'prompt_tokens', coalesce(sum(prompt_tokens), 0),
    'completion_tokens', coalesce(sum(completion_tokens), 0),
    'total_tokens', coalesce(sum(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0)), 0),
    'total_runs', count(*),
    'perm_failed_domains', (
      SELECT count(DISTINCT l.domain)
        FROM ai_generation_log l
        JOIN missed_banner_reports m ON m.domain = l.domain AND m.resolved = false
       WHERE l.status = 'permanently_failed'
    )
  ) INTO result
  FROM ai_generation_log;
  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.cy_community_ai_totals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cy_community_ai_totals() TO authenticated, service_role;

-- 3) Pipeline health view (Auto-Fix page). Same columns, order and security_invoker as live.
--    resolved_24h: was "resolved AND last_reported in 24h" (a report bump, not a resolution);
--                  now uses resolved_at.
--    ai_success_24h / ai_fail_24h: were raw log rows with success% (incl. dismissal consensus) and
--                  permanently_failed bookkeeping; now distinct domains with a real AI attempt,
--                  and a domain that failed then succeeded counts only as a success.
CREATE OR REPLACE VIEW public.v_cookieyeti_pipeline_health
WITH (security_invoker = true) AS
 SELECT ( SELECT count(*) AS count
           FROM missed_banner_reports
          WHERE NOT missed_banner_reports.resolved) AS unresolved_total,
    ( SELECT count(*) AS count
           FROM missed_banner_reports
          WHERE NOT missed_banner_reports.resolved AND COALESCE(missed_banner_reports.ai_attempts, 0) < 4 AND COALESCE(missed_banner_reports.render_attempts, 0) < 3) AS in_progress,
    ( SELECT count(*) AS count
           FROM v_cookieyeti_needs_attention) AS needs_attention,
    ( SELECT count(*) AS count
           FROM missed_banner_reports
          WHERE missed_banner_reports.resolved AND missed_banner_reports.resolved_at > (now() - '24:00:00'::interval)) AS resolved_24h,
    ( SELECT count(*) AS count
           FROM cookie_patterns
          WHERE cookie_patterns.is_active AND cookie_patterns.confidence >= 0.3::double precision) AS patterns_serving,
    ( SELECT count(*) AS count
           FROM cookie_patterns
          WHERE cookie_patterns.validation_status = 'passed'::text) AS patterns_validated,
    ( SELECT count(*) AS count
           FROM cookie_patterns
          WHERE cookie_patterns.validation_status = ANY (ARRAY['not_dismissed'::text, 'selector_not_found'::text])) AS patterns_pulled,
    ( SELECT count(DISTINCT ai_generation_log.domain) AS count
           FROM ai_generation_log
          WHERE ai_generation_log.created_at > (now() - '24:00:00'::interval)
            AND ai_generation_log.status = ANY (ARRAY['success'::text, 'success_cmp_fallback'::text, 'success_cmp_fingerprint'::text, 'success_failsafe'::text, 'success_failsafe_autocorrected'::text, 'success_gemini_failsafe'::text])) AS ai_success_24h,
    ( SELECT count(DISTINCT f.domain) AS count
           FROM ai_generation_log f
          WHERE f.created_at > (now() - '24:00:00'::interval)
            AND f.status = ANY (ARRAY['needs_manual_review'::text, 'error'::text, 'failed'::text, 'failed_not_cookie_banner'::text, 'rejected_dangerous_selector'::text, 'generation_failed'::text])
            AND NOT EXISTS (
              SELECT 1 FROM ai_generation_log s
               WHERE s.domain = f.domain
                 AND s.created_at > (now() - '24:00:00'::interval)
                 AND s.status = ANY (ARRAY['success'::text, 'success_cmp_fallback'::text, 'success_cmp_fingerprint'::text, 'success_failsafe'::text, 'success_failsafe_autocorrected'::text, 'success_gemini_failsafe'::text]))) AS ai_fail_24h;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.v_cookieyeti_pipeline_health FROM anon, authenticated;
GRANT SELECT ON public.v_cookieyeti_pipeline_health TO authenticated;
