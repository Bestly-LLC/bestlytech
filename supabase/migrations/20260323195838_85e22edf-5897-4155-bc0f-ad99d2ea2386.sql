-- Delete dangerous bare structural selectors
DELETE FROM cookie_patterns WHERE selector IN ('body', 'html', 'head', 'body *', 'html *');

-- Update upsert_pattern to reject banned selectors and excluded domains
CREATE OR REPLACE FUNCTION public.upsert_pattern(_domain text, _selector text, _action_type text, _cmp_fingerprint text DEFAULT 'generic'::text, _source text DEFAULT 'community'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _trimmed_selector text;
  _trimmed_domain text;
BEGIN
  _trimmed_selector := lower(trim(_selector));
  _trimmed_domain := lower(trim(_domain));

  -- Reject dangerous bare structural selectors
  IF _trimmed_selector IN ('body', 'html', 'head', 'body *', 'html *', '*') THEN
    RAISE WARNING 'Rejected dangerous selector "%" for domain "%"', _selector, _domain;
    RETURN;
  END IF;

  -- Reject excluded domains (major web apps without standard cookie banners)
  IF _trimmed_domain IN (
    'icloud.com', 'mail.google.com', 'drive.google.com', 'docs.google.com',
    'outlook.live.com', 'outlook.office.com', 'teams.microsoft.com',
    'accounts.google.com', 'appleid.apple.com'
  ) THEN
    RAISE WARNING 'Rejected pattern for excluded domain "%"', _domain;
    RETURN;
  END IF;

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