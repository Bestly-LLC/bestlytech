-- get_top_domains always returned the top N by pattern_count, but the Operations "Pattern coverage"
-- grid says "top domains by reports" and re-sorted those 50 client-side. Add p_order.
-- Based on the LIVE definition; default ('patterns') returns exactly what it did before.
-- The old one-argument version is dropped so named calls ({ p_limit }) are not ambiguous.
DROP FUNCTION IF EXISTS public.get_top_domains(integer);

CREATE OR REPLACE FUNCTION public.get_top_domains(p_limit integer DEFAULT 25, p_order text DEFAULT 'patterns')
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT domain,
           count(*) AS pattern_count,
           round(avg(confidence)::numeric, 3) AS avg_confidence,
           coalesce(sum(report_count), 0) AS total_reports,
           coalesce(sum(success_count), 0) AS total_successes,
           CASE WHEN sum(report_count) > 0
                THEN round((sum(success_count)::numeric / sum(report_count)::numeric) * 100, 1)
                ELSE 0 END AS success_rate,
           max(last_seen) AS last_active
    FROM cookie_patterns
    GROUP BY domain
    ORDER BY
      CASE WHEN p_order = 'reports' THEN coalesce(sum(report_count), 0) END DESC NULLS LAST,
      count(*) DESC
    LIMIT p_limit
  ) t;
$function$;

REVOKE ALL ON FUNCTION public.get_top_domains(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_top_domains(integer, text) TO authenticated, service_role;
