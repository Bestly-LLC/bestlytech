-- ============================================================================
-- COOKIE YETI PRODUCT ANALYTICS PIPELINE (2026-07-08)
--
-- Privacy-first, anonymous product-event ingestion + admin rollups.
-- Matches the "no tracking SDKs, ever" promise: append-only event log keyed by
-- a client-generated random anon_id (NEVER an email/device_id), coarse PII-free
-- props only, no URLs/IPs. RLS: anon may INSERT allowlisted events only; NO anon
-- SELECT. All reads go through SECURITY DEFINER rollup RPCs restricted to
-- service_role / admin.
--
-- Applied to prod (project rcqfqhguwpmaarseifqg) via the Supabase Management API;
-- mirrored here so `supabase db push` stays in sync.
-- ============================================================================

-- ---------- 1. Table ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  anon_id     uuid NOT NULL,
  platform    text NOT NULL,
  event       text NOT NULL,
  props       jsonb NOT NULL DEFAULT '{}'::jsonb,
  app_version text,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- Allowlist guards (defense-in-depth; the edge function validates too).
  CONSTRAINT product_events_platform_chk
    CHECK (platform IN ('ios','macos','chrome','safari')),
  CONSTRAINT product_events_event_chk
    CHECK (event IN (
      'install','onboarding_complete','extension_enabled','first_dismiss',
      'banner_handled_daily','daily_limit_hit','report_submitted',
      'paywall_viewed','upgrade_started','upgrade_completed',
      'notif_opt_in','notif_clicked','heartbeat'
    )),
  -- Lightweight size guards: keep props tiny and PII-free, cap app_version.
  CONSTRAINT product_events_props_size_chk CHECK (pg_column_size(props) <= 2048),
  CONSTRAINT product_events_app_version_len_chk CHECK (app_version IS NULL OR char_length(app_version) <= 32)
);

COMMENT ON TABLE public.product_events IS
  'Append-only anonymous product-analytics events. anon_id is a device-random UUID (NOT PII). props are coarse, PII-free. anon INSERT-only via RLS; reads only through cy_* SECURITY DEFINER RPCs.';

CREATE INDEX IF NOT EXISTS idx_product_events_event_created
  ON public.product_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_events_anon
  ON public.product_events (anon_id);
CREATE INDEX IF NOT EXISTS idx_product_events_platform_created
  ON public.product_events (platform, created_at DESC);

-- ---------- 2. RLS: anon INSERT-only, no SELECT ---------------------------
ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;

-- Idempotent: drop any prior policies so re-runs converge on the intended set.
DROP POLICY IF EXISTS product_events_anon_insert ON public.product_events;
DROP POLICY IF EXISTS product_events_service_all ON public.product_events;
DROP POLICY IF EXISTS "Anyone can read product events" ON public.product_events;

-- anon (and authenticated) may INSERT only allowlisted events/platforms.
-- No USING clause + no SELECT policy => rows can never be read back by anon.
CREATE POLICY product_events_anon_insert
  ON public.product_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    platform IN ('ios','macos','chrome','safari')
    AND event IN (
      'install','onboarding_complete','extension_enabled','first_dismiss',
      'banner_handled_daily','daily_limit_hit','report_submitted',
      'paywall_viewed','upgrade_started','upgrade_completed',
      'notif_opt_in','notif_clicked','heartbeat'
    )
  );

-- service_role: full access (edge function / rollups run as service_role).
CREATE POLICY product_events_service_all
  ON public.product_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Explicitly ensure anon/authenticated cannot SELECT/UPDATE/DELETE the raw log.
REVOKE SELECT, UPDATE, DELETE ON public.product_events FROM anon, authenticated;
GRANT INSERT ON public.product_events TO anon, authenticated;

-- ---------- 3. Rollup RPCs (SECURITY DEFINER, admin/service_role only) -----
-- All reads of product_events happen here. Each RPC self-guards so that only
-- service_role or an authenticated admin (has_role) can execute it, even if the
-- EXECUTE grant is ever loosened.

CREATE OR REPLACE FUNCTION public._cy_analytics_guard()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin'::app_role) THEN RETURN; END IF;
  RAISE EXCEPTION 'not authorized' USING errcode = '42501';
END;
$$;

-- Funnel: distinct anon_id at each core stage (install -> ... -> Pro).
CREATE OR REPLACE FUNCTION public.cy_funnel()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result json;
BEGIN
  PERFORM public._cy_analytics_guard();
  SELECT json_build_object(
    'install',              (SELECT count(DISTINCT anon_id) FROM product_events WHERE event = 'install'),
    'onboarding_complete',  (SELECT count(DISTINCT anon_id) FROM product_events WHERE event = 'onboarding_complete'),
    'extension_enabled',    (SELECT count(DISTINCT anon_id) FROM product_events WHERE event = 'extension_enabled'),
    'first_dismiss',        (SELECT count(DISTINCT anon_id) FROM product_events WHERE event = 'first_dismiss'),
    'daily_limit_hit',      (SELECT count(DISTINCT anon_id) FROM product_events WHERE event = 'daily_limit_hit'),
    'upgrade_completed',    (SELECT count(DISTINCT anon_id) FROM product_events WHERE event = 'upgrade_completed')
  ) INTO result;
  RETURN result;
END;
$$;

-- Daily active users (distinct anon_id per day) for the last _days days.
CREATE OR REPLACE FUNCTION public.cy_dau(days int DEFAULT 30)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result json; d int;
BEGIN
  PERFORM public._cy_analytics_guard();
  d := greatest(1, least(coalesce(days, 30), 365));
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.day), '[]'::json) INTO result
  FROM (
    SELECT (date_trunc('day', created_at))::date AS day,
           count(DISTINCT anon_id)::int AS dau,
           count(*)::int AS events
    FROM product_events
    WHERE created_at >= (now() - make_interval(days => d))
    GROUP BY 1
  ) t;
  RETURN result;
END;
$$;

-- Free -> Pro conversion across the intent path.
CREATE OR REPLACE FUNCTION public.cy_conversion()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_install int; v_paywall int; v_started int; v_completed int; result json;
BEGIN
  PERFORM public._cy_analytics_guard();
  SELECT count(DISTINCT anon_id) INTO v_install   FROM product_events WHERE event = 'install';
  SELECT count(DISTINCT anon_id) INTO v_paywall   FROM product_events WHERE event = 'paywall_viewed';
  SELECT count(DISTINCT anon_id) INTO v_started    FROM product_events WHERE event = 'upgrade_started';
  SELECT count(DISTINCT anon_id) INTO v_completed  FROM product_events WHERE event = 'upgrade_completed';
  result := json_build_object(
    'installs', v_install,
    'paywall_viewed', v_paywall,
    'upgrade_started', v_started,
    'upgrade_completed', v_completed,
    'install_to_pro_rate', CASE WHEN v_install  > 0 THEN round((v_completed::numeric / v_install)  * 100, 2) ELSE 0 END,
    'paywall_to_pro_rate', CASE WHEN v_paywall  > 0 THEN round((v_completed::numeric / v_paywall)  * 100, 2) ELSE 0 END
  );
  RETURN result;
END;
$$;

-- Per-platform breakdown: active users + key milestones.
CREATE OR REPLACE FUNCTION public.cy_platform_breakdown()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result json;
BEGIN
  PERFORM public._cy_analytics_guard();
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.active_users DESC), '[]'::json) INTO result
  FROM (
    SELECT
      platform,
      count(DISTINCT anon_id)::int AS active_users,
      count(DISTINCT anon_id) FILTER (WHERE event = 'install')::int AS installs,
      count(DISTINCT anon_id) FILTER (WHERE event = 'extension_enabled')::int AS activated,
      count(DISTINCT anon_id) FILTER (WHERE event = 'daily_limit_hit')::int AS limit_hits,
      count(DISTINCT anon_id) FILTER (WHERE event = 'upgrade_completed')::int AS upgrades,
      count(DISTINCT anon_id) FILTER (WHERE created_at >= now() - interval '1 day')::int AS dau
    FROM product_events
    GROUP BY platform
  ) t;
  RETURN result;
END;
$$;

-- Lock down execution: no anon/public; admin app (authenticated) + service_role.
REVOKE ALL ON FUNCTION public._cy_analytics_guard()        FROM public, anon;
REVOKE ALL ON FUNCTION public.cy_funnel()                  FROM public, anon;
REVOKE ALL ON FUNCTION public.cy_dau(int)                  FROM public, anon;
REVOKE ALL ON FUNCTION public.cy_conversion()              FROM public, anon;
REVOKE ALL ON FUNCTION public.cy_platform_breakdown()      FROM public, anon;

GRANT EXECUTE ON FUNCTION public.cy_funnel()             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cy_dau(int)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cy_conversion()         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cy_platform_breakdown() TO authenticated, service_role;
