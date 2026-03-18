CREATE OR REPLACE FUNCTION public.get_recently_learned(p_limit integer DEFAULT 50)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT id, domain, selector, action_type, cmp_fingerprint, confidence,
           report_count, success_count, source, is_active, created_at, last_seen, strategy
    FROM cookie_patterns
    ORDER BY created_at DESC
    LIMIT p_limit
  ) t;
$function$;