-- 2026-10-17 — /status was flaky and /cookie-yeti/transparency had no live data at all.
--
-- Two production defects, one migration.
--
-- 1. get_public_status() (from 20260430010000) built its 90-day series with
--    `FROM external_health eh CROSS JOIN days d LEFT JOIN external_health_history ehh
--     ON ehh.service = eh.service AND ehh.recorded_at >= d.day AND ehh.recorded_at < d.day + 1`
--    and then `GROUP BY eh.service, d.day`. Postgres cannot use the
--    (service, recorded_at) index for a join whose range keys come from the
--    other side of the join, so it hash-joined and threw away 12.3M row pairs.
--    Measured 2026-10-17 with EXPLAIN ANALYZE on 137,763 history rows: 2,910 ms.
--    The `anon` role has statement_timeout = 3s, so /status returned
--    "canceling statement due to statement timeout" (57014) on most loads and
--    only succeeded when it happened to finish inside the cap. Rewritten to
--    aggregate once per (service, day) and then left-join the 90-day calendar
--    onto it: 142 ms, a 20x drop, comfortably inside the timeout even as
--    history keeps growing (the scan stays bounded by the 90-day filter).
--    Same output shape and the same numbers as before.
--
-- 2. get_cookie_yeti_public_stats() (20260529160000, corrected by 20260530000000)
--    was never applied to project rcqfqhguwpmaarseifqg. PostgREST answered
--    PGRST202 ("no matches were found in the schema cache") every time, so the
--    public dashboard at /cookie-yeti/transparency has fallen back to its
--    hardcoded last-known-good constants since it shipped in May. Both files
--    were committed; nobody ever ran them here. Re-applied below, latest
--    definition (union of domains across the four tables + CMP count).
--
-- Both functions are SECURITY DEFINER and granted to anon, so both are added to
-- security_public_rpcs in the same migration. Without that, Ares's Auto-Fixer
-- (security_autofix, hourly) revokes anon execute the next time the nightly
-- audit files an anon_rpc finding against them and the pages break again.

-- ---------------------------------------------------------------------------
-- 1. Fast, non-flaky public status
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_public_status()
RETURNS TABLE (
  service           text,
  current_status    text,
  last_checked      timestamptz,
  uptime_24h_pct    numeric,
  uptime_30d_pct    numeric,
  daily_uptime      jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH bounds AS (
    -- One scan window for every part of the answer. 89 days back so the
    -- calendar below ends up with exactly 90 boxes, same as before.
    SELECT (now() - interval '89 days')::date AS first_day
  ),
  per_day AS (
    SELECT h.service,
           h.recorded_at::date AS day,
           avg(CASE WHEN h.status = 'ok' THEN 1.0 ELSE 0.0 END) AS pct
    FROM public.external_health_history h, bounds b
    WHERE h.recorded_at >= b.first_day
    GROUP BY 1, 2
  ),
  windows AS (
    SELECT h.service,
           avg(CASE WHEN h.status = 'ok' THEN 1.0 ELSE 0.0 END)
             FILTER (WHERE h.recorded_at >= now() - interval '24 hours') AS pct24,
           avg(CASE WHEN h.status = 'ok' THEN 1.0 ELSE 0.0 END)
             FILTER (WHERE h.recorded_at >= now() - interval '30 days')  AS pct30
    FROM public.external_health_history h, bounds b
    WHERE h.recorded_at >= b.first_day
    GROUP BY 1
  ),
  days AS (
    SELECT generate_series(b.first_day, now()::date, '1 day'::interval)::date AS day
    FROM bounds b
  ),
  series AS (
    -- Every service gets all 90 boxes; a day with no samples stays null, which
    -- the page renders as "no data" rather than as downtime.
    SELECT eh.service,
           jsonb_agg(jsonb_build_object('day', d.day, 'pct', pd.pct) ORDER BY d.day) AS daily
    FROM public.external_health eh
    CROSS JOIN days d
    LEFT JOIN per_day pd ON pd.service = eh.service AND pd.day = d.day
    GROUP BY eh.service
  )
  SELECT eh.service,
         eh.status AS current_status,
         eh.last_checked,
         coalesce(round(w.pct24 * 100, 2), 0) AS uptime_24h_pct,
         coalesce(round(w.pct30 * 100, 2), 0) AS uptime_30d_pct,
         coalesce(s.daily, '[]'::jsonb) AS daily_uptime
  FROM public.external_health eh
  LEFT JOIN windows w ON w.service = eh.service
  LEFT JOIN series  s ON s.service = eh.service
  ORDER BY eh.service;
$$;

REVOKE ALL ON FUNCTION public.get_public_status() FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_status() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_status() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The Cookie Yeti public dashboard RPC that was never applied here
--    (verbatim latest definition from 20260530000000_cookie_yeti_sites_union_and_cmp_count.sql)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_cookie_yeti_public_stats()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT json_build_object(
    'sites_analyzed', (
      SELECT count(*) FROM (
        SELECT lower(domain) AS d FROM public.cookie_patterns        WHERE domain IS NOT NULL AND domain <> '_system'
        UNION
        SELECT lower(domain)      FROM public.dismissal_reports       WHERE domain IS NOT NULL AND domain <> '_system'
        UNION
        SELECT lower(domain)      FROM public.missed_banner_reports   WHERE domain IS NOT NULL AND domain <> '_system'
        UNION
        SELECT lower(domain)      FROM public.ai_generation_log       WHERE domain IS NOT NULL AND domain <> '_system'
      ) all_domains
    ),
    'cmp_platforms_recognized', 17,
    'ai_generations', (SELECT count(*) FROM public.ai_generation_log),
    'ai_success', (SELECT count(*) FROM public.ai_generation_log WHERE status = 'success'),
    'banners_dismissed', (SELECT count(*) FROM public.dismissal_reports),
    'devices_protected', (SELECT count(*) FROM public.device_registrations),
    'active_patterns', (SELECT count(*) FROM public.cookie_patterns),
    'offenders', (
      SELECT coalesce(json_agg(row_to_json(o)), '[]'::json)
      FROM (
        SELECT domain, report_count, cmp_fingerprint, has_working_pattern, resolved
        FROM public.missed_banner_reports
        ORDER BY report_count DESC
        LIMIT 10
      ) o
    ),
    'ai_status_breakdown', (
      SELECT coalesce(json_agg(row_to_json(s)), '[]'::json)
      FROM (
        SELECT status, count(*)::int AS count
        FROM public.ai_generation_log
        GROUP BY status
        ORDER BY count DESC
      ) s
    ),
    'ai_weekly', (
      SELECT coalesce(json_agg(row_to_json(w) ORDER BY w.week), '[]'::json)
      FROM (
        SELECT
          to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week,
          count(*)::int AS total,
          count(*) FILTER (WHERE status IN ('success', 'success_cmp_fallback'))::int AS success
        FROM public.ai_generation_log
        GROUP BY date_trunc('week', created_at)
      ) w
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_cookie_yeti_public_stats() FROM public;
GRANT EXECUTE ON FUNCTION public.get_cookie_yeti_public_stats() TO anon;
GRANT EXECUTE ON FUNCTION public.get_cookie_yeti_public_stats() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Keep both public on purpose
-- ---------------------------------------------------------------------------

INSERT INTO public.security_public_rpcs (fn, why) VALUES
  ('get_public_status',
   'bestly.tech/status reads it with the publishable key and no sign-in (added 2026-10-17). Returns only aggregate uptime per service, no rows.'),
  ('get_cookie_yeti_public_stats',
   'bestly.tech/cookie-yeti/transparency reads it with the publishable key and no sign-in (added 2026-10-17). Returns aggregate counts only; dismissal counts are otherwise admin-read-only.')
ON CONFLICT (fn) DO NOTHING;
