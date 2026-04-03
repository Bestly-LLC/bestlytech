-- Create system_alert_state table for health check tracking
CREATE TABLE public.system_alert_state (
  id integer PRIMARY KEY DEFAULT 1,
  is_down boolean NOT NULL DEFAULT false,
  down_systems text[] NOT NULL DEFAULT '{}',
  last_checked timestamptz,
  last_alert_sent timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Constrain to single row
ALTER TABLE public.system_alert_state ADD CONSTRAINT single_row CHECK (id = 1);

-- Insert default row
INSERT INTO public.system_alert_state (id) VALUES (1);

-- Enable RLS
ALTER TABLE public.system_alert_state ENABLE ROW LEVEL SECURITY;

-- Only service role can access
CREATE POLICY "Service role manages system_alert_state"
  ON public.system_alert_state
  FOR ALL
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);
