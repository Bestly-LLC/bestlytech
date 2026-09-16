-- Cookie Yeti pattern maintenance (auto_fix_pattern_issues), based on the LIVE definition. Idempotent.
--
-- 1) Stale patterns were DELETED every run (225 in 30 days). last_seen only moves when a pattern is
--    re-reported (upsert_pattern), not when it works, so "stale" often means "working fine". They are
--    now deactivated (is_active = false, logged as 'deactivated_stale') and kept.
--    Note: the extension fetches cookie_patterns?confidence=gte.0.3 and does not filter on is_active,
--    so a deactivated pattern keeps being served; it just stops counting as coverage for the AI
--    generator / report-dismissal "already covered" checks, same as a deleted one did.
-- 2) The "Auto fixes" count was ~7,000 a month for a few dozen real fixes: patterns already at
--    confidence 0 were zeroed (and logged) again every 3 hours, patterns in [3,4) were logged as
--    'skipped' every run, and inactive stale rows would have matched forever. Every branch now only
--    matches rows it will actually change.
-- 3) The stuck-candidate reset put ai_attempts back to 0 for domains the retry job had already marked
--    permanently_failed, so they were retried (and failed) again and again. Those are now left alone;
--    reset_failed_domains_cron decides when they get another try.
-- 4) Adds the admin/internal guard: this SECURITY DEFINER function was executable by any signed-in
--    user. pg_cron, service role and run_maintenance_cron (admin or cron) still pass.
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
  v_unstuck_count INT := 0;
  v_pipeline_stalled BOOLEAN := false;
  v_last_ai_gen TIMESTAMPTZ;
  v_unresolved_pending INT;
BEGIN
  PERFORM public._cy_admin_or_internal_guard();

  FOR rec IN
    SELECT * FROM (
      SELECT
        id, domain, selector, action_type, confidence,
        report_count, success_count, last_seen, is_active,
        CASE
          WHEN report_count > 5 AND success_count = 0 THEN 'never_succeeds'
          WHEN confidence > 0 AND confidence < 3 THEN 'very_low_confidence'
          WHEN is_active AND last_seen < now() - interval '30 days' THEN 'stale'
          WHEN confidence > 0 AND report_count >= 3
               AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2 THEN 'low_success_rate'
          ELSE 'other'
        END AS issue_type
      FROM cookie_patterns
    ) candidates
    WHERE issue_type <> 'other'
  LOOP
    processed := processed + 1;
    fix_success := true;
    fix_error := NULL;
    BEGIN
      CASE rec.issue_type
        WHEN 'stale' THEN
          UPDATE cookie_patterns SET is_active = false, updated_at = now() WHERE id = rec.id;
          action_desc := 'deactivated_stale';
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

  WITH stuck AS (
    UPDATE missed_banner_reports m
       SET ai_attempts = 0,
           ai_processed_at = NULL
     WHERE m.resolved = false
       AND m.ai_attempts >= 3
       AND m.ai_attempts < 5
       AND (m.ai_processed_at IS NULL OR m.ai_processed_at < now() - interval '7 days')
       AND NOT EXISTS (
         SELECT 1 FROM ai_generation_log l
          WHERE l.domain = m.domain AND l.status = 'permanently_failed'
       )
    RETURNING m.domain
  )
  SELECT count(*) INTO v_unstuck_count FROM stuck;

  IF v_unstuck_count > 0 THEN
    INSERT INTO pattern_fix_log (domain, selector, issue_type, action_taken, success)
    VALUES ('_system', '_pipeline', 'stuck_candidates_reset', 'reset ' || v_unstuck_count || ' domains', true);
  END IF;

  SELECT MAX(created_at) INTO v_last_ai_gen FROM ai_generation_log;
  SELECT count(*) INTO v_unresolved_pending
    FROM missed_banner_reports
   WHERE resolved = false
     AND ai_attempts < 5
     AND (ai_processed_at IS NULL OR ai_processed_at < now() - interval '24 hours');

  IF v_unresolved_pending > 0
     AND (v_last_ai_gen IS NULL OR v_last_ai_gen < now() - interval '24 hours') THEN
    v_pipeline_stalled := true;
    INSERT INTO pattern_fix_log (domain, selector, issue_type, action_taken, success)
    VALUES (
      '_system',
      '_pipeline',
      'ai_generator_stall',
      v_unresolved_pending || ' candidates pending, last gen ' ||
        coalesce(extract(epoch FROM (now() - v_last_ai_gen))::int / 3600 || 'h ago', 'never'),
      false
    );
  END IF;

  RETURN json_build_object(
    'processed', processed,
    'fixed', fixed,
    'failed', failed,
    'unstuck_candidates', v_unstuck_count,
    'pipeline_stalled', v_pipeline_stalled,
    'unresolved_pending', v_unresolved_pending,
    'details', to_json(result_details)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_fix_pattern_issues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_fix_pattern_issues() TO authenticated, service_role;
