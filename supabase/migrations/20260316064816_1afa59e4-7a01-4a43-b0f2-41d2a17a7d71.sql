
-- Add columns to missed_banner_reports
ALTER TABLE missed_banner_reports
  ADD COLUMN IF NOT EXISTS banner_html TEXT,
  ADD COLUMN IF NOT EXISTS page_url TEXT,
  ADD COLUMN IF NOT EXISTS ai_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cmp_fingerprint TEXT DEFAULT 'unknown';

-- Create ai_generation_log table
CREATE TABLE IF NOT EXISTS ai_generation_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  domain TEXT NOT NULL,
  status TEXT NOT NULL,
  selector_generated TEXT,
  action_type TEXT,
  confidence REAL,
  ai_model TEXT DEFAULT 'claude-sonnet',
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  error_message TEXT,
  html_source TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_gen_log_created ON ai_generation_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_gen_log_domain ON ai_generation_log (domain);

ALTER TABLE ai_generation_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon read on ai_generation_log" ON ai_generation_log FOR SELECT TO anon USING (true);
CREATE POLICY "Allow service role all on ai_generation_log" ON ai_generation_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- RPC: report_missed_banner_with_html
CREATE OR REPLACE FUNCTION report_missed_banner_with_html(_domain TEXT, _page_url TEXT DEFAULT NULL, _banner_html TEXT DEFAULT NULL, _cmp_fingerprint TEXT DEFAULT 'unknown') RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO missed_banner_reports (domain, page_url, banner_html, cmp_fingerprint, report_count, last_reported)
  VALUES (_domain, _page_url, left(_banner_html, 5000), _cmp_fingerprint, 1, now())
  ON CONFLICT (domain) DO UPDATE SET
    report_count = missed_banner_reports.report_count + 1,
    last_reported = now(),
    page_url = COALESCE(EXCLUDED.page_url, missed_banner_reports.page_url),
    cmp_fingerprint = CASE WHEN EXCLUDED.cmp_fingerprint != 'unknown' THEN EXCLUDED.cmp_fingerprint ELSE missed_banner_reports.cmp_fingerprint END,
    banner_html = CASE WHEN length(COALESCE(EXCLUDED.banner_html, '')) > length(COALESCE(missed_banner_reports.banner_html, '')) THEN left(EXCLUDED.banner_html, 5000) ELSE missed_banner_reports.banner_html END,
    resolved = CASE WHEN missed_banner_reports.resolved = true AND missed_banner_reports.resolved_at < now() - interval '7 days' THEN false ELSE missed_banner_reports.resolved END;
END;
$$;

GRANT EXECUTE ON FUNCTION report_missed_banner_with_html(TEXT, TEXT, TEXT, TEXT) TO anon;

-- RPC: get_ai_generation_candidates
CREATE OR REPLACE FUNCTION get_ai_generation_candidates(_limit INTEGER DEFAULT 10) RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (
    SELECT id, domain, report_count, banner_html, page_url, cmp_fingerprint, ai_attempts, last_reported
    FROM missed_banner_reports
    WHERE resolved = false AND (ai_processed_at IS NULL OR ai_processed_at < now() - interval '24 hours') AND ai_attempts < 3
    ORDER BY CASE WHEN banner_html IS NOT NULL THEN 0 ELSE 1 END, report_count DESC, last_reported DESC
    LIMIT _limit
  ) t;
$$;

GRANT EXECUTE ON FUNCTION get_ai_generation_candidates(INTEGER) TO service_role;

-- RPC: mark_ai_processed
CREATE OR REPLACE FUNCTION mark_ai_processed(_domain TEXT, _resolved BOOLEAN DEFAULT true) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE missed_banner_reports SET ai_processed_at = now(), ai_attempts = ai_attempts + 1, resolved = _resolved, resolved_at = CASE WHEN _resolved THEN now() ELSE resolved_at END WHERE domain = _domain;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_ai_processed(TEXT, BOOLEAN) TO service_role;
