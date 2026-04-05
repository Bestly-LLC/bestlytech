-- 1. Source check constraint (includes user_consensus)
ALTER TABLE cookie_patterns DROP CONSTRAINT IF EXISTS cookie_patterns_source_check;
ALTER TABLE cookie_patterns ADD CONSTRAINT cookie_patterns_source_check CHECK (source IN ('community', 'curated', 'manual', 'extension', 'ai_generated', 'user_consensus'));

-- 2. Add columns to missed_banner_reports (IF NOT EXISTS)
ALTER TABLE missed_banner_reports ADD COLUMN IF NOT EXISTS banner_html TEXT;
ALTER TABLE missed_banner_reports ADD COLUMN IF NOT EXISTS page_url TEXT;
DO $$ BEGIN
  ALTER TABLE missed_banner_reports ADD COLUMN cmp_fingerprint TEXT NOT NULL DEFAULT 'unknown';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE missed_banner_reports ADD COLUMN ai_attempts INTEGER NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 3. Index for AI candidates
CREATE INDEX IF NOT EXISTS idx_missed_banner_ai_candidates ON missed_banner_reports (resolved, ai_attempts, report_count DESC) WHERE resolved = false;

-- 4. ai_generation_log table (IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS ai_generation_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  domain TEXT NOT NULL,
  status TEXT NOT NULL,
  selector_generated TEXT,
  action_type TEXT,
  confidence REAL,
  ai_model TEXT,
  error_message TEXT,
  html_source TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ai_gen_log_domain ON ai_generation_log (domain);
CREATE INDEX IF NOT EXISTS idx_ai_gen_log_created ON ai_generation_log (created_at DESC);
ALTER TABLE ai_generation_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_generation_log' AND policyname = 'Allow anon read on ai_generation_log') THEN
    CREATE POLICY "Allow anon read on ai_generation_log" ON ai_generation_log FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_generation_log' AND policyname = 'Allow service role all on ai_generation_log') THEN
    CREATE POLICY "Allow service role all on ai_generation_log" ON ai_generation_log FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 5. Drop old function (returns json) and recreate with TABLE return
DROP FUNCTION IF EXISTS get_ai_generation_candidates(integer);
CREATE OR REPLACE FUNCTION get_ai_generation_candidates(_limit INTEGER DEFAULT 10)
RETURNS TABLE (id BIGINT, domain TEXT, report_count INTEGER, banner_html TEXT, page_url TEXT, cmp_fingerprint TEXT, ai_attempts INTEGER, last_reported TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, domain, report_count, banner_html, page_url, cmp_fingerprint, ai_attempts, last_reported
  FROM missed_banner_reports
  WHERE resolved = false
    AND (ai_processed_at IS NULL OR ai_processed_at < now() - interval '24 hours')
    AND ai_attempts < 3
  ORDER BY
    CASE WHEN banner_html IS NOT NULL THEN 0 ELSE 1 END,
    report_count DESC,
    last_reported DESC
  LIMIT _limit;
$$;
GRANT EXECUTE ON FUNCTION get_ai_generation_candidates(INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION get_ai_generation_candidates(INTEGER) TO service_role;

-- 6. Updated mark_ai_processed
CREATE OR REPLACE FUNCTION mark_ai_processed(_domain TEXT, _resolved BOOLEAN DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE missed_banner_reports
  SET ai_processed_at = now(),
      ai_attempts = ai_attempts + 1,
      resolved = _resolved,
      resolved_at = CASE WHEN _resolved THEN now() ELSE resolved_at END
  WHERE domain = _domain;
END;
$$;
GRANT EXECUTE ON FUNCTION mark_ai_processed(TEXT, BOOLEAN) TO anon;
GRANT EXECUTE ON FUNCTION mark_ai_processed(TEXT, BOOLEAN) TO service_role;

-- 7. Drop old upsert_pattern (5 params) and recreate with 6 params
DROP FUNCTION IF EXISTS upsert_pattern(text, text, text, text, text);
CREATE OR REPLACE FUNCTION upsert_pattern(
  _domain TEXT, _selector TEXT, _action_type TEXT,
  _cmp_fingerprint TEXT DEFAULT 'generic', _source TEXT DEFAULT 'community',
  _confidence REAL DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _trimmed_selector text;
  _trimmed_domain text;
  _effective_source text;
BEGIN
  _trimmed_selector := lower(trim(_selector));
  _trimmed_domain := lower(trim(_domain));

  IF _trimmed_selector IN ('body', 'html', 'head', 'body *', 'html *', '*') THEN
    RAISE WARNING 'Rejected dangerous selector "%" for domain "%"', _selector, _domain;
    RETURN;
  END IF;

  IF _trimmed_domain IN (
    'icloud.com', 'mail.google.com', 'drive.google.com', 'docs.google.com',
    'outlook.live.com', 'outlook.office.com', 'teams.microsoft.com',
    'accounts.google.com', 'appleid.apple.com'
  ) THEN
    RAISE WARNING 'Rejected pattern for excluded domain "%"', _domain;
    RETURN;
  END IF;

  _effective_source := CASE
    WHEN _source IN ('community','curated','manual','extension','ai_generated','user_consensus') THEN _source
    ELSE 'community'
  END;

  INSERT INTO public.cookie_patterns (domain, selector, action_type, cmp_fingerprint, source, confidence, report_count, last_seen)
  VALUES (_domain, _selector, _action_type, _cmp_fingerprint, _effective_source, COALESCE(_confidence, 5), 1, now())
  ON CONFLICT (domain, selector, action_type)
  DO UPDATE SET
    report_count = cookie_patterns.report_count + 1,
    confidence = CASE
      WHEN _confidence IS NOT NULL THEN _confidence
      ELSE LEAST(cookie_patterns.confidence + 1, 10)
    END,
    last_seen = now(),
    updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION upsert_pattern(TEXT, TEXT, TEXT, TEXT, TEXT, REAL) TO anon;
GRANT EXECUTE ON FUNCTION upsert_pattern(TEXT, TEXT, TEXT, TEXT, TEXT, REAL) TO service_role;