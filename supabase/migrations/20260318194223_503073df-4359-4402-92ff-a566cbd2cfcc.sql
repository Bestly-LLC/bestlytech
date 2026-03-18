
-- Migrate confidence from 0-1 decimal to 1-10 integer scale

-- 1. Update existing data: multiply by 10 and round
UPDATE cookie_patterns SET confidence = ROUND(confidence * 10);
UPDATE ai_generation_log SET confidence = ROUND(confidence * 10) WHERE confidence IS NOT NULL;

-- 2. Change default on cookie_patterns
ALTER TABLE cookie_patterns ALTER COLUMN confidence SET DEFAULT 5;

-- 3. Update upsert_pattern: increment by 1 instead of 0.02, cap at 10
CREATE OR REPLACE FUNCTION public.upsert_pattern(_domain text, _selector text, _action_type text, _cmp_fingerprint text DEFAULT 'generic'::text, _source text DEFAULT 'community'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.cookie_patterns (domain, selector, action_type, cmp_fingerprint, source, last_seen)
  VALUES (_domain, _selector, _action_type, _cmp_fingerprint, _source, now())
  ON CONFLICT (domain, selector, action_type)
  DO UPDATE SET
    report_count = cookie_patterns.report_count + 1,
    confidence = LEAST(cookie_patterns.confidence + 1, 10),
    last_seen = now(),
    updated_at = now();
END;
$function$;

-- 4. Update record_pattern_success: increment by 1 instead of 0.03, cap at 10
CREATE OR REPLACE FUNCTION public.record_pattern_success(_domain text, _selector text, _action_type text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.cookie_patterns
  SET
    success_count = success_count + 1,
    confidence = LEAST(confidence + 1, 10),
    updated_at = now()
  WHERE domain = _domain
    AND selector = _selector
    AND action_type = _action_type;
END;
$function$;

-- 5. Update auto_fix_pattern_issues thresholds
CREATE OR REPLACE FUNCTION public.auto_fix_pattern_issues()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  result_details JSON[] := '{}';
  processed INT := 0;
  fixed INT := 0;
  failed INT := 0;
  action_desc TEXT;
  fix_success BOOLEAN;
  fix_error TEXT;
BEGIN
  FOR rec IN
    SELECT
      id, domain, selector, action_type, confidence,
      report_count, success_count, last_seen,
      CASE
        WHEN report_count > 5 AND success_count = 0 THEN 'never_succeeds'
        WHEN confidence < 3 THEN 'very_low_confidence'
        WHEN last_seen < now() - interval '30 days' THEN 'stale'
        WHEN report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2 THEN 'low_success_rate'
        ELSE 'other'
      END AS issue_type
    FROM cookie_patterns
    WHERE
      confidence < 4
      OR (report_count > 5 AND success_count = 0)
      OR last_seen < now() - interval '30 days'
      OR (report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2)
  LOOP
    processed := processed + 1;
    fix_success := true;
    fix_error := NULL;

    BEGIN
      CASE rec.issue_type
        WHEN 'stale' THEN
          DELETE FROM cookie_patterns WHERE id = rec.id;
          action_desc := 'deleted_stale';
        WHEN 'never_succeeds' THEN
          DELETE FROM cookie_patterns WHERE id = rec.id;
          action_desc := 'deleted_broken';
        WHEN 'very_low_confidence' THEN
          UPDATE cookie_patterns SET confidence = 0 WHERE id = rec.id;
          action_desc := 'confidence_zeroed';
        WHEN 'low_success_rate' THEN
          UPDATE cookie_patterns SET confidence = confidence / 2 WHERE id = rec.id;
          action_desc := 'confidence_halved';
        ELSE
          action_desc := 'skipped';
      END CASE;
      fixed := fixed + 1;
    EXCEPTION WHEN OTHERS THEN
      fix_success := false;
      fix_error := SQLERRM;
      failed := failed + 1;
      action_desc := rec.issue_type || '_fix_attempted';
    END;

    INSERT INTO pattern_fix_log (domain, selector, issue_type, action_taken, success, error_message)
    VALUES (rec.domain, rec.selector, rec.issue_type, action_desc, fix_success, fix_error);

    result_details := result_details || json_build_object(
      'domain', rec.domain, 'selector', rec.selector,
      'issue', rec.issue_type, 'action', action_desc,
      'success', fix_success, 'error', fix_error
    )::json;
  END LOOP;

  RETURN json_build_object(
    'processed', processed,
    'fixed', fixed,
    'failed', failed,
    'details', to_json(result_details)
  );
END;
$function$;

-- 6. Update get_community_overview thresholds
CREATE OR REPLACE FUNCTION public.get_community_overview()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT json_build_object(
  'total_patterns', (SELECT count(*) FROM cookie_patterns),
  'total_domains', (SELECT count(DISTINCT domain) FROM cookie_patterns),
  'high_confidence', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 8),
  'low_confidence', (SELECT count(*) FROM cookie_patterns WHERE confidence < 4),
  'avg_confidence', (SELECT round(avg(confidence)::numeric, 1) FROM cookie_patterns),
  'total_reports', (SELECT coalesce(sum(report_count), 0) FROM cookie_patterns),
  'total_successes', (SELECT coalesce(sum(success_count), 0) FROM cookie_patterns),
  'overall_success_rate', (SELECT CASE WHEN sum(report_count) > 0 THEN round((sum(success_count)::numeric / sum(report_count)::numeric) * 100, 1) ELSE 0 END FROM cookie_patterns),
  'patterns_last_24h', (SELECT count(*) FROM cookie_patterns WHERE last_seen >= now() - interval '24 hours'),
  'patterns_last_7d', (SELECT count(*) FROM cookie_patterns WHERE last_seen >= now() - interval '7 days'),
  'new_domains_last_7d', (SELECT count(DISTINCT domain) FROM cookie_patterns WHERE created_at >= now() - interval '7 days'),
  'stale_patterns', (SELECT count(*) FROM cookie_patterns WHERE last_seen < now() - interval '30 days')
);
$function$;

-- 7. Update get_confidence_distribution buckets for 1-10 scale
CREATE OR REPLACE FUNCTION public.get_confidence_distribution()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
FROM (SELECT bucket, label, count FROM (VALUES
  (0, '1-2', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0 AND confidence <= 2)),
  (1, '3-4', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 3 AND confidence <= 4)),
  (2, '5-6', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 5 AND confidence <= 6)),
  (3, '7-8', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 7 AND confidence <= 8)),
  (4, '9-10', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 9 AND confidence <= 10))
) AS v(bucket, label, count) ORDER BY bucket) t;
$function$;

-- 8. Update get_pattern_issues thresholds
CREATE OR REPLACE FUNCTION public.get_pattern_issues(p_limit integer DEFAULT 50)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
FROM (SELECT domain, selector, action_type, confidence, report_count, success_count,
  CASE WHEN sum(report_count) OVER () > 0 THEN round((success_count::numeric / NULLIF(report_count, 0)::numeric) * 100, 1) ELSE 0 END AS success_rate,
  last_seen,
  CASE
    WHEN confidence < 3 THEN 'very_low_confidence'
    WHEN report_count > 5 AND success_count = 0 THEN 'never_succeeds'
    WHEN last_seen < now() - interval '30 days' THEN 'stale'
    WHEN report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2 THEN 'low_success_rate'
    ELSE 'other'
  END AS issue_type
FROM cookie_patterns
WHERE confidence < 4
  OR (report_count > 5 AND success_count = 0)
  OR last_seen < now() - interval '30 days'
  OR (report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2)
ORDER BY confidence ASC, report_count DESC LIMIT p_limit) t;
$function$;

-- 9. Update process_user_reports threshold from 0.5 to 5 and 0.1 to 1
CREATE OR REPLACE FUNCTION public.process_user_reports()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  working_count INT;
  total_reports INT := 0;
  newly_resolved INT := 0;
  priority_domains JSON[];
BEGIN
  INSERT INTO missed_banner_reports (domain, report_count, last_reported)
  SELECT
    domain,
    count(*) AS report_count,
    max(last_seen) AS last_reported
  FROM cookie_patterns
  WHERE cmp_fingerprint = 'user_report'
  GROUP BY domain
  ON CONFLICT (domain)
  DO UPDATE SET
    report_count = EXCLUDED.report_count,
    last_reported = EXCLUDED.last_reported;

  FOR rec IN
    SELECT mbr.id, mbr.domain, mbr.report_count
    FROM missed_banner_reports mbr
    WHERE mbr.resolved = false
  LOOP
    total_reports := total_reports + 1;

    SELECT count(*) INTO working_count
    FROM cookie_patterns
    WHERE domain = rec.domain
      AND cmp_fingerprint != 'user_report'
      AND confidence >= 5
      AND success_count > 0;

    IF working_count > 0 THEN
      UPDATE missed_banner_reports
      SET resolved = true,
          resolved_at = now(),
          has_working_pattern = true
      WHERE id = rec.id;
      newly_resolved := newly_resolved + 1;

      UPDATE cookie_patterns
      SET confidence = LEAST(10, confidence + 1)
      WHERE domain = rec.domain
        AND cmp_fingerprint = 'user_report'
        AND success_count > 0;

      INSERT INTO pattern_fix_log (domain, selector, issue_type, action_taken, success)
      VALUES (rec.domain, 'user_report', 'user_reported_resolved', 'marked_resolved', true);
    ELSE
      UPDATE missed_banner_reports
      SET has_working_pattern = false
      WHERE id = rec.id;
    END IF;
  END LOOP;

  SELECT coalesce(array_agg(row_to_json(t)::json), '{}')
  INTO priority_domains
  FROM (
    SELECT domain, report_count, last_reported
    FROM missed_banner_reports
    WHERE resolved = false AND report_count >= 3
    ORDER BY report_count DESC
    LIMIT 20
  ) t;

  RETURN json_build_object(
    'total_unresolved', total_reports - newly_resolved,
    'newly_resolved', newly_resolved,
    'priority_domains', to_json(priority_domains)
  );
END;
$function$;

-- 10. Update find_dismissal_consensus threshold from 0.5 to 5
CREATE OR REPLACE FUNCTION public.find_dismissal_consensus()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT domain, clicked_selector, banner_selector, COUNT(*) as report_count
    FROM public.dismissal_reports
    WHERE domain NOT IN (
      SELECT DISTINCT domain FROM public.cookie_patterns
      WHERE confidence >= 5 AND source != 'user_consensus'
    )
    GROUP BY domain, clicked_selector, banner_selector
    HAVING COUNT(*) >= 3
    ORDER BY COUNT(*) DESC
    LIMIT 50
  ) t;
$function$;
