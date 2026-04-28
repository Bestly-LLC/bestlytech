-- ============================================================================
-- COOKIE YETI PIPELINE REPAIR (2026-04-28)
--
-- Already applied to prod via Supabase Management API. Mirroring here so future
-- supabase db push stays in sync.
--
-- Fixes uncovered after AI Generator went silent for 4+ days:
--   1. Off-by-one in get_ai_generation_candidates (ai_attempts < 3 vs the edge
--      function's >= 4 sentinel). Domains at exactly ai_attempts=3 became
--      invisible forever.
--   2. auto_fix_pattern_issues never detected pipeline stalls; now resets
--      stuck candidates and surfaces silent generators.
--   3. Reset stuck domains so the system actually tries them again.
--   4. Added hysteresis tracking columns to system_alert_state.
--   5. Repointed pg_cron health check from SQL function to edge function (which
--      has set-diff alerting, hysteresis, quiet hours, and issue-only SMS).
-- ============================================================================

-- ---------- 1. Fix candidate selection ------------------------------------
DROP FUNCTION IF EXISTS public.get_ai_generation_candidates(int);

CREATE OR REPLACE FUNCTION public.get_ai_generation_candidates(_limit int)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (
    SELECT id, domain, report_count, banner_html, page_url, cmp_fingerprint, ai_attempts, last_reported
    FROM missed_banner_reports
    WHERE resolved = false
      AND (ai_processed_at IS NULL OR ai_processed_at < now() - interval '24 hours')
      -- Was: ai_attempts < 3 (off-by-one against the function's permanent_failed >= 4 threshold).
      -- Now: < 5, matching auto-retry-failed-patterns and reset_failed_domains_cron.
      AND ai_attempts < 5
    ORDER BY
      CASE WHEN banner_html IS NOT NULL THEN 0 ELSE 1 END,
      report_count DESC,
      last_reported DESC
    LIMIT _limit
  ) t;
$$;

COMMENT ON FUNCTION public.get_ai_generation_candidates IS
  'Picks unresolved missed banner reports for ai-generate-pattern. Threshold raised 2026-04-28 from <3 to <5.';

-- ---------- 2. Hysteresis tracking columns on system_alert_state ----------
ALTER TABLE public.system_alert_state
  ADD COLUMN IF NOT EXISTS pending_systems text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pending_match_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_alerted_systems text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_alert_at timestamptz;

COMMENT ON COLUMN public.system_alert_state.pending_systems IS
  'Names (no timestamp) flagged as down on the most recent check; used for hysteresis.';
COMMENT ON COLUMN public.system_alert_state.pending_match_count IS
  'Consecutive checks where pending_systems did not change. >=2 confirms a state.';
COMMENT ON COLUMN public.system_alert_state.last_alerted_systems IS
  'Down-systems set in the last SMS we sent. Diff against current to compute newly_down / newly_up.';
COMMENT ON COLUMN public.system_alert_state.last_alert_at IS
  'Wall-clock of the most recent SMS we successfully sent.';

-- ---------- 3. Unstick currently-stranded domains -------------------------
UPDATE public.missed_banner_reports
   SET ai_attempts = 0,
       ai_processed_at = NULL
 WHERE resolved = false
   AND ai_attempts >= 3
   AND ai_attempts < 5;

-- ---------- 4. AI fixer learns to repair pipeline stalls ------------------
CREATE OR REPLACE FUNCTION public.auto_fix_pattern_issues()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- New: pipeline-stall repair
  WITH stuck AS (
    UPDATE missed_banner_reports
       SET ai_attempts = 0,
           ai_processed_at = NULL
     WHERE resolved = false
       AND ai_attempts >= 3
       AND ai_attempts < 5
       AND (ai_processed_at IS NULL OR ai_processed_at < now() - interval '7 days')
    RETURNING domain
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
$$;

COMMENT ON FUNCTION public.auto_fix_pattern_issues IS
  'Repairs bad patterns AND pipeline stalls. 2026-04-28: added stuck-candidate reset (ai_attempts in [3,5) for >7d) + ai-generator stall detection.';

-- ---------- 5. Repoint pg_cron job at the edge function -------------------
-- Original: every 15 min ran check_system_health_sql() (no SMS, no hysteresis)
-- Now: every 15 min invokes the check-system-health edge function.

DO $$
BEGIN
  PERFORM cron.unschedule('check-system-health');
EXCEPTION WHEN OTHERS THEN
  -- ignore if it doesn't exist
  NULL;
END $$;

SELECT cron.schedule(
  'check-system-health',
  '*/15 * * * *',
  $$ SELECT public.invoke_edge_function('check-system-health'); $$
);

COMMENT ON FUNCTION public.check_system_health_sql IS
  'LEGACY (2026-04-28). Logic moved to the check-system-health edge function for set-diff alerting + hysteresis. This SQL function is no longer scheduled but kept for diagnostics.';
