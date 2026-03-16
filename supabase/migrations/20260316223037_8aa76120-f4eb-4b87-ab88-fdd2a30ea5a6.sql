
-- Fix mutable search_path on auto_fix_pattern_issues
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
        WHEN confidence < 0.3 THEN 'very_low_confidence'
        WHEN last_seen < now() - interval '30 days' THEN 'stale'
        WHEN report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2 THEN 'low_success_rate'
        ELSE 'other'
      END AS issue_type
    FROM cookie_patterns
    WHERE
      confidence < 0.4
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

-- Fix mutable search_path on process_user_reports
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
      AND confidence >= 0.5
      AND success_count > 0;

    IF working_count > 0 THEN
      UPDATE missed_banner_reports
      SET resolved = true,
          resolved_at = now(),
          has_working_pattern = true
      WHERE id = rec.id;
      newly_resolved := newly_resolved + 1;

      UPDATE cookie_patterns
      SET confidence = LEAST(1.0, confidence + 0.1)
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
