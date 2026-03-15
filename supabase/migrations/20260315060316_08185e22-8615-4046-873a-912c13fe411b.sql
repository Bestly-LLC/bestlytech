
CREATE TABLE activation_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  platform TEXT DEFAULT 'unknown',
  active BOOLEAN DEFAULT false,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  last_verified TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_activation_email_code ON activation_codes(email, code);
CREATE INDEX idx_activation_email_active ON activation_codes(email) WHERE active = true;

ALTER TABLE activation_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activation_codes_select" ON activation_codes FOR SELECT USING (true);
CREATE POLICY "activation_codes_service_insert" ON activation_codes FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "activation_codes_service_update" ON activation_codes FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "activation_codes_service_delete" ON activation_codes FOR DELETE USING (auth.role() = 'service_role');
