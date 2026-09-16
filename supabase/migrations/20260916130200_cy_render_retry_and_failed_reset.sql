-- Cookie Yeti "Needs you" could never be cleared. Idempotent; reset_failed_domains_cron is based on
-- the LIVE definition.
--
-- All open needs-attention rows are render_exhausted (render_attempts = 3). render-banner and
-- get_render_queue only pick rows with render_attempts < 3 and nothing ever reset the counter, so
-- the render stage has had an empty queue since mid-July.

-- 1) Admin "Retry render" for one domain.
CREATE OR REPLACE FUNCTION public.reset_render_attempts(p_domain text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  PERFORM public._cy_admin_or_internal_guard();
  IF p_domain IS NULL OR length(trim(p_domain)) = 0 THEN
    RAISE EXCEPTION 'domain is required' USING errcode = '22023';
  END IF;

  UPDATE missed_banner_reports
     SET render_attempts = 0,
         render_last_at = NULL
   WHERE domain = lower(trim(p_domain))
     AND resolved = false
     AND coalesce(render_attempts, 0) > 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    INSERT INTO pattern_fix_log (domain, selector, issue_type, action_taken, success)
    VALUES (lower(trim(p_domain)), '_render', 'render_retry_requested', 'render_attempts reset by admin', true);
  END IF;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.reset_render_attempts(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_render_attempts(text) TO authenticated, service_role;

-- 2) Weekly / manual "Reset failed domains".
--    - Also resets render_exhausted rows whose last render attempt is 30+ days old.
--    - AI reset keyed on the last permanently_failed log being 30+ days old, not on when the report
--      was first created. Every open report is older than 30 days, so the old condition reset the
--      same failed domains every Sunday (20 permanently_failed logs in 30 days for 5 domains).
--      It also covers domains that were marked permanently failed but whose ai_attempts counter was
--      pushed back below 5 by the stuck-candidate reset.
CREATE OR REPLACE FUNCTION public.reset_failed_domains_cron()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  reset_count int := 0;
  render_reset_count int := 0;
  cleaned_logs int := 0;
  rec RECORD;
BEGIN
  PERFORM public._cy_admin_or_internal_guard();
  -- Reset domains that have been permanently failed for 30+ days
  -- but still have no working pattern
  FOR rec IN
    SELECT m.domain
    FROM missed_banner_reports m
    WHERE m.resolved = false
      AND (
        m.ai_attempts >= 5
        OR EXISTS (SELECT 1 FROM ai_generation_log l WHERE l.domain = m.domain AND l.status = 'permanently_failed')
      )
      AND m.created_at < now() - interval '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM ai_generation_log l
         WHERE l.domain = m.domain
           AND l.status = 'permanently_failed'
           AND l.created_at >= now() - interval '30 days'
      )
  LOOP
    -- Check if domain now has a high-confidence active pattern
    IF NOT EXISTS (
      SELECT 1 FROM cookie_patterns
      WHERE domain = rec.domain
        AND is_active = true
        AND confidence >= 7
    ) THEN
      -- Reset for retry
      UPDATE missed_banner_reports
      SET ai_attempts = 0, ai_processed_at = NULL
      WHERE domain = rec.domain;
      reset_count := reset_count + 1;
    ELSE
      -- Domain has a good pattern now, mark as resolved
      UPDATE missed_banner_reports
      SET resolved = true, resolved_at = now()
      WHERE domain = rec.domain;
    END IF;
  END LOOP;

  -- Give render_exhausted domains another render after 30 days.
  UPDATE missed_banner_reports
     SET render_attempts = 0, render_last_at = NULL
   WHERE resolved = false
     AND coalesce(render_attempts, 0) >= 3
     AND (render_last_at IS NULL OR render_last_at < now() - interval '30 days');
  GET DIAGNOSTICS render_reset_count = ROW_COUNT;

  -- Clean old failed AI generation logs (30+ days) so domains become candidates again
  DELETE FROM ai_generation_log
  WHERE status IN ('permanently_failed', 'generation_failed', 'skipped_no_html')
    AND created_at < now() - interval '30 days';
  GET DIAGNOSTICS cleaned_logs = ROW_COUNT;

  RETURN jsonb_build_object(
    'reset_domains', reset_count,
    'reset_render', render_reset_count,
    'cleaned_logs', cleaned_logs,
    'ran_at', now()
  );
END;
$function$;
