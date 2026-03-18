
-- Create dismissal_reports table
CREATE TABLE public.dismissal_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  domain TEXT NOT NULL,
  clicked_selector TEXT NOT NULL,
  banner_selector TEXT,
  banner_html TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_dismissal_domain ON public.dismissal_reports(domain);

ALTER TABLE public.dismissal_reports ENABLE ROW LEVEL SECURITY;

-- Extension can insert (anon)
CREATE POLICY "Anyone can insert dismissal reports"
  ON public.dismissal_reports FOR INSERT
  TO public
  WITH CHECK (true);

-- Service role full access
CREATE POLICY "Service role manages dismissal_reports"
  ON public.dismissal_reports FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Admin can read
CREATE POLICY "Admin can read dismissal_reports"
  ON public.dismissal_reports FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Create consensus-finding RPC
CREATE OR REPLACE FUNCTION public.find_dismissal_consensus()
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT domain, clicked_selector, banner_selector, COUNT(*) as report_count
    FROM public.dismissal_reports
    WHERE domain NOT IN (
      SELECT DISTINCT domain FROM public.cookie_patterns
      WHERE confidence >= 0.5 AND source != 'user_consensus'
    )
    GROUP BY domain, clicked_selector, banner_selector
    HAVING COUNT(*) >= 3
    ORDER BY COUNT(*) DESC
    LIMIT 50
  ) t;
$$;
