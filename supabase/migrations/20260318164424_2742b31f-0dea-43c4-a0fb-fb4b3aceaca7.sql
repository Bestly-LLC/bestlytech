
-- 1. Email normalization trigger function
CREATE OR REPLACE FUNCTION public.lowercase_subscription_email()
RETURNS TRIGGER AS $$
BEGIN
  NEW.email = LOWER(TRIM(NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path TO 'public';

-- 2. Triggers on subscriptions and granted_access
CREATE TRIGGER trg_lowercase_subscription_email
  BEFORE INSERT OR UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION lowercase_subscription_email();

CREATE TRIGGER trg_lowercase_granted_access_email
  BEFORE INSERT OR UPDATE ON granted_access
  FOR EACH ROW
  EXECUTE FUNCTION lowercase_subscription_email();

-- 3. One-time data fix
UPDATE subscriptions SET email = LOWER(TRIM(email)) WHERE email != LOWER(TRIM(email));
UPDATE granted_access SET email = LOWER(TRIM(email)) WHERE email != LOWER(TRIM(email));

-- 4. webhook_events table
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL,
  stripe_event_id TEXT,
  email TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can read webhook_events" ON public.webhook_events
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role manages webhook_events" ON public.webhook_events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 5. Update report_missed_banner_with_html to clear stale AI skip entries
CREATE OR REPLACE FUNCTION public.report_missed_banner_with_html(
  _domain text,
  _page_url text DEFAULT NULL::text,
  _banner_html text DEFAULT NULL::text,
  _cmp_fingerprint text DEFAULT 'unknown'::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Clear stale AI skip entries when new HTML arrives
  IF _banner_html IS NOT NULL AND LENGTH(TRIM(_banner_html)) > 50 THEN
    DELETE FROM ai_generation_log
    WHERE domain = _domain
    AND status = 'skipped_no_html';

    -- Reset AI attempts so the domain becomes a candidate again
    UPDATE missed_banner_reports
    SET ai_attempts = 0, ai_processed_at = NULL
    WHERE domain = _domain
    AND ai_attempts > 0;
  END IF;
END;
$function$;
