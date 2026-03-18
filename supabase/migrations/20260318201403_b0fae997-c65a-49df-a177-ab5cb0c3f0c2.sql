
-- Add is_active column to cookie_patterns
ALTER TABLE public.cookie_patterns ADD COLUMN is_active boolean NOT NULL DEFAULT true;

-- Update find_dismissal_consensus function with is_active filter and threshold of 1
CREATE OR REPLACE FUNCTION public.find_dismissal_consensus()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT 
      dr.domain,
      dr.clicked_selector,
      dr.banner_selector,
      COUNT(*) as report_count
    FROM dismissal_reports dr
    WHERE dr.domain NOT IN (
      SELECT cp.domain FROM cookie_patterns cp 
      WHERE cp.is_active = true AND cp.confidence >= 5
      AND cp.source != 'user_consensus'
    )
    GROUP BY dr.domain, dr.clicked_selector, dr.banner_selector
    HAVING COUNT(*) >= 1
    ORDER BY COUNT(*) DESC
    LIMIT 50
  ) t;
$$;
