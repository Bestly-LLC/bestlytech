-- "Needs you" on every Cookie Yeti surface now counts only domains Auto-Fix already
-- tried and handed to a human; the rest are in autofix_queue and fix themselves.
create or replace view public.v_cookieyeti_pipeline_health with (security_invoker = true) as
 SELECT ( SELECT count(*) FROM missed_banner_reports WHERE NOT resolved) AS unresolved_total,
    ( SELECT count(*) FROM missed_banner_reports WHERE NOT resolved AND COALESCE(ai_attempts, 0) < 4 AND COALESCE(render_attempts, 0) < 3) AS in_progress,
    ( SELECT count(*) FROM v_cookieyeti_needs_attention WHERE autofix_outcome IN ('blocked','no_banner_seen','ai_failed','ai_wrong')) AS needs_attention,
    ( SELECT count(*) FROM missed_banner_reports WHERE resolved AND resolved_at > (now() - '24:00:00'::interval)) AS resolved_24h,
    ( SELECT count(*) FROM cookie_patterns WHERE is_active AND confidence >= (0.3)::double precision) AS patterns_serving,
    ( SELECT count(*) FROM cookie_patterns WHERE validation_status = 'passed'::text) AS patterns_validated,
    ( SELECT count(*) FROM cookie_patterns WHERE validation_status = ANY (ARRAY['not_dismissed'::text, 'selector_not_found'::text])) AS patterns_pulled,
    ( SELECT count(DISTINCT ai_generation_log.domain) FROM ai_generation_log
          WHERE ai_generation_log.created_at > (now() - '24:00:00'::interval) AND ai_generation_log.status = ANY (ARRAY['success'::text, 'success_cmp_fallback'::text, 'success_cmp_fingerprint'::text, 'success_failsafe'::text, 'success_failsafe_autocorrected'::text, 'success_gemini_failsafe'::text])) AS ai_success_24h,
    ( SELECT count(DISTINCT f.domain) FROM ai_generation_log f
          WHERE f.created_at > (now() - '24:00:00'::interval) AND f.status = ANY (ARRAY['needs_manual_review'::text, 'error'::text, 'failed'::text, 'failed_not_cookie_banner'::text, 'rejected_dangerous_selector'::text, 'generation_failed'::text])
            AND NOT EXISTS ( SELECT 1 FROM ai_generation_log s WHERE s.domain = f.domain AND s.created_at > (now() - '24:00:00'::interval) AND s.status = ANY (ARRAY['success'::text, 'success_cmp_fallback'::text, 'success_cmp_fingerprint'::text, 'success_failsafe'::text, 'success_failsafe_autocorrected'::text, 'success_gemini_failsafe'::text]))) AS ai_fail_24h,
    ( SELECT count(*) FROM v_cookieyeti_needs_attention WHERE autofix_outcome IS NULL OR autofix_outcome NOT IN ('blocked','no_banner_seen','ai_failed','ai_wrong')) AS autofix_queue;
grant select on public.v_cookieyeti_pipeline_health to authenticated;
