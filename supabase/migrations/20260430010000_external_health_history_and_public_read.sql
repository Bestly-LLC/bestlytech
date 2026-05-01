-- 2026-04-30 — public status page support.
-- Already applied via dashboard; mirrored here for repo parity.

CREATE TABLE IF NOT EXISTS public.external_health_history (
  id           bigserial PRIMARY KEY,
  service      text NOT NULL,
  status       text NOT NULL CHECK (status IN ('ok','warn','down','unknown')),
  http_code    integer,
  latency_ms   integer,
  recorded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_health_history_service_time
  ON public.external_health_history(service, recorded_at DESC);

ALTER TABLE public.external_health_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_read_history" ON public.external_health_history;
CREATE POLICY "admins_read_history"
  ON public.external_health_history
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.copy_external_health_to_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.external_health_history (
    service, status, http_code, latency_ms, recorded_at
  ) VALUES (
    NEW.service, NEW.status, NEW.http_code, NEW.latency_ms, NEW.last_checked
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_external_health_history ON public.external_health;
CREATE TRIGGER trg_external_health_history
  AFTER INSERT OR UPDATE ON public.external_health
  FOR EACH ROW
  EXECUTE FUNCTION public.copy_external_health_to_history();

CREATE OR REPLACE FUNCTION public.get_public_status()
RETURNS TABLE (
  service           text,
  current_status    text,
  last_checked      timestamptz,
  uptime_24h_pct    numeric,
  uptime_30d_pct    numeric,
  daily_uptime      jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH days AS (
    SELECT generate_series(
      (now() - interval '89 days')::date,
      now()::date,
      '1 day'::interval
    )::date AS day
  ),
  service_days AS (
    SELECT
      eh.service,
      d.day,
      coalesce(
        avg(case when ehh.status = 'ok' then 1.0 else 0.0 end),
        NULL
      ) AS pct
    FROM external_health eh
    CROSS JOIN days d
    LEFT JOIN external_health_history ehh
      ON ehh.service = eh.service
     AND ehh.recorded_at >= d.day
     AND ehh.recorded_at <  d.day + interval '1 day'
    GROUP BY eh.service, d.day
  ),
  agg AS (
    SELECT
      sd.service,
      jsonb_agg(jsonb_build_object('day', sd.day, 'pct', sd.pct) ORDER BY sd.day) AS daily,
      avg(sd.pct) FILTER (WHERE sd.day >= (now() - interval '30 days')::date) AS pct30,
      (SELECT avg(case when status='ok' then 1.0 else 0.0 end)
         FROM external_health_history h2
        WHERE h2.service = sd.service
          AND h2.recorded_at >= now() - interval '24 hours') AS pct24
    FROM service_days sd
    GROUP BY sd.service
  )
  SELECT
    eh.service,
    eh.status AS current_status,
    eh.last_checked,
    coalesce(round(agg.pct24 * 100, 2), 0) AS uptime_24h_pct,
    coalesce(round(agg.pct30 * 100, 2), 0) AS uptime_30d_pct,
    coalesce(agg.daily, '[]'::jsonb) AS daily_uptime
  FROM external_health eh
  LEFT JOIN agg ON agg.service = eh.service
  ORDER BY eh.service;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_status() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_status() TO authenticated;
