CREATE TABLE public.device_registrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'chrome',
  user_agent TEXT,
  first_seen TIMESTAMPTZ DEFAULT now(),
  last_seen TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_device_reg_email_device ON public.device_registrations(email, device_id);
CREATE INDEX idx_device_reg_email ON public.device_registrations(email);

ALTER TABLE public.device_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "device_reg_read" ON public.device_registrations
  FOR SELECT USING (true);

CREATE POLICY "device_reg_insert" ON public.device_registrations
  FOR INSERT WITH CHECK (true);

CREATE POLICY "device_reg_update" ON public.device_registrations
  FOR UPDATE USING (true);

CREATE POLICY "device_reg_service" ON public.device_registrations
  FOR ALL USING (auth.role() = 'service_role');