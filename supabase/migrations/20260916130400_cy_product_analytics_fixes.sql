-- Cookie Yeti Product Analytics. Idempotent; cy_dau is based on the LIVE definition.

-- 1) cy_dau only returned days that had events, so the chart drew a straight line across empty days
--    (and "today's DAU" on the admin home showed the last day with events). Zero-fill every day in
--    the range. Same signature, guard, return shape and ascending order.
CREATE OR REPLACE FUNCTION public.cy_dau(days integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result json; d int;
BEGIN
  PERFORM public._cy_analytics_guard();
  d := greatest(1, least(coalesce(days, 30), 365));
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.day), '[]'::json) INTO result
  FROM (
    SELECT g.day::date AS day,
           coalesce(e.dau, 0)::int AS dau,
           coalesce(e.events, 0)::int AS events
    FROM generate_series(
           (date_trunc('day', now() - make_interval(days => d)))::date,
           (date_trunc('day', now()))::date,
           interval '1 day'
         ) AS g(day)
    LEFT JOIN (
      SELECT (date_trunc('day', created_at))::date AS day,
             count(DISTINCT anon_id) AS dau,
             count(*) AS events
      FROM product_events
      WHERE created_at >= (now() - make_interval(days => d))
      GROUP BY 1
    ) e ON e.day = g.day::date
  ) t;
  RETURN result;
END;
$function$;

-- 2) Per-event activity so the admin can tell "nobody did it" from "the app never sends it".
CREATE OR REPLACE FUNCTION public.cy_event_activity(p_days integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result json; d int;
BEGIN
  PERFORM public._cy_analytics_guard();
  d := greatest(1, least(coalesce(p_days, 30), 365));
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.event), '[]'::json) INTO result
  FROM (
    SELECT event,
           count(DISTINCT anon_id)::int AS users,
           count(*) FILTER (WHERE created_at >= now() - make_interval(days => d))::int AS events_in_window,
           max(created_at) AS last_at
    FROM product_events
    GROUP BY event
  ) t;
  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.cy_event_activity(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cy_event_activity(integer) TO authenticated, service_role;
