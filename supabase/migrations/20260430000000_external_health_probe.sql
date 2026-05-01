-- 2026-04-30 — external service uptime probe.
-- See probe-external edge function. Migration already applied to project
-- rcqfqhguwpmaarseifqg via the dashboard; this file mirrors it for repo parity.

CREATE TABLE IF NOT EXISTS public.external_health (
  service       text PRIMARY KEY,
  url           text NOT NULL,
  status        text NOT NULL CHECK (status IN ('ok','warn','down','unknown')),
  http_code     integer,
  latency_ms    integer,
  error_message text,
  last_checked  timestamptz NOT NULL DEFAULT now(),
  last_ok       timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.external_health (service, url, status) VALUES
  ('cookieyeti.com',     'https://cookieyeti.com/',     'unknown'),
  ('hoascope.com',       'https://hoascope.com/',       'unknown'),
  ('app.hoascope.com',   'https://app.hoascope.com/',   'unknown'),
  ('cloud.bestly.tech',  'https://cloud.bestly.tech/',  'unknown'),
  ('bestly.tech',        'https://bestly.tech/',        'unknown')
ON CONFLICT (service) DO NOTHING;

ALTER TABLE public.external_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_read_external_health" ON public.external_health;
CREATE POLICY "admins_read_external_health"
  ON public.external_health
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_external_health_status
  ON public.external_health(status)
  WHERE status IN ('warn','down');

DO $$ BEGIN
  PERFORM cron.unschedule('probe-external');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'probe-external',
  '*/5 * * * *',
  $$ SELECT public.invoke_edge_function('probe-external'); $$
);
